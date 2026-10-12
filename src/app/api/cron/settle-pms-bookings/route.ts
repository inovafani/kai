import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { runNativeOperatorExpirySweep, type NativeExpirySweepResult } from "@/server/payments/native-booking-decision";
import { runSettlementSweep } from "@/server/payments/settlement-cron";

export const runtime = "nodejs";

const JOB_NAME = "settle-pms-bookings";

/**
 * Milestone 2 (payment-settlement plan): daily automatic trigger for settlePmsBookingPaymentAttempt
 * (see settlement-cron.ts). Unlike bluepass-redesign's /api/cron/rezdy-agent-sync, CRON_SECRET is
 * required here rather than optional - this endpoint moves real operator payouts, so a missing
 * secret must fail closed (401), never silently run unauthenticated.
 */
function isAuthorized(request: Request): boolean {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) return false;
  const receivedSecret = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return receivedSecret === expectedSecret;
}

async function handleSettlementSweep(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const startedAt = new Date();
  try {
    const result = await runSettlementSweep();
    // Paid native bookings whose operator did not answer within 24 hours are refunded here too, on
    // the same daily schedule (the hosting plan runs jobs once a day, so an unanswered booking is
    // refunded within a day of its deadline, never earlier). A failure here must not hide the
    // settlement result above, so it is reported inside the summary instead of thrown.
    const nativeOperatorExpiry: NativeExpirySweepResult | { error: string } = await runNativeOperatorExpirySweep().catch((error) => ({
      error: error instanceof Error ? error.message : String(error)
    }));
    const nativeProblem = "error" in nativeOperatorExpiry || nativeOperatorExpiry.skipped.length > 0;
    // Milestone 3.5: persist every run so a job that silently stops firing or starts failing leaves
    // a queryable trail (see CronRunLog's schema comment) - best-effort, never lets a logging hiccup
    // turn a real, already-succeeded sweep into an apparent failure.
    await prisma.cronRunLog
      .create({
        data: {
          jobName: JOB_NAME,
          status: result.skipped.length > 0 || nativeProblem ? "PARTIAL" : "SUCCESS",
          summary: { ...result, nativeOperatorExpiry } as object,
          startedAt,
          finishedAt: new Date()
        }
      })
      .catch((error) => console.error("cron_run_log.write_failed", { jobName: JOB_NAME, error }));
    return NextResponse.json({ ok: true, ...result, nativeOperatorExpiry });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await prisma.cronRunLog
      .create({ data: { jobName: JOB_NAME, status: "FAILURE", errorMessage, startedAt, finishedAt: new Date() } })
      .catch((logError) => console.error("cron_run_log.write_failed", { jobName: JOB_NAME, logError }));
    throw error;
  }
}

// Vercel's native Cron Jobs send a GET request (see vercel.json's crons entry for this path) - POST
// is kept too so this can also be triggered manually for verification, same dual-support pattern
// bluepass-redesign's /api/cron/rezdy-agent-sync already uses.
export async function GET(request: Request) {
  return handleSettlementSweep(request);
}

export async function POST(request: Request) {
  return handleSettlementSweep(request);
}
