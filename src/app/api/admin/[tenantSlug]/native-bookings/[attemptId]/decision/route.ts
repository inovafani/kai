import { NextResponse } from "next/server";
import { decideNativeBooking } from "@/server/payments/native-booking-decision";

export const runtime = "nodejs";

type DecisionRouteProps = {
  params: Promise<{ tenantSlug: string; attemptId: string }>;
};

/**
 * Accept or decline a paid native booking that is waiting for its operator. Accept confirms it;
 * decline releases the seats and refunds the traveller in full. The attempt must belong to the
 * tenant in the URL, so one operator can never decide another's booking. Same KAI_ADMIN_TOKEN
 * bearer/cookie auth as the other admin endpoints; the BluePass operator screens call this on the
 * operator's behalf. Safe to repeat: a second call reports NOT_WAITING and changes nothing.
 */
export async function POST(request: Request, { params }: DecisionRouteProps) {
  const expectedToken = process.env.KAI_ADMIN_TOKEN;
  const authorization = request.headers.get("authorization") ?? "";
  const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const cookieToken = readCookie(request.headers.get("cookie"), "kai_admin_token");

  if (!expectedToken || (bearerToken !== expectedToken && cookieToken !== expectedToken)) {
    return NextResponse.json(
      { error: { code: "ADMIN_TOKEN_REQUIRED", message: "Admin access is required." } },
      { status: 401 }
    );
  }

  const { tenantSlug, attemptId } = await params;
  const body = await request.json().catch(() => null);
  const decision = typeof body?.decision === "string" ? body.decision.trim().toUpperCase() : "";
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : undefined;

  if (decision !== "ACCEPT" && decision !== "DECLINE") {
    return NextResponse.json(
      { error: { code: "INVALID_DECISION", message: "decision must be ACCEPT or DECLINE." } },
      { status: 400 }
    );
  }

  try {
    const result = await decideNativeBooking({ attemptId, decision, note, tenantSlug });
    // NOT_WAITING is a normal answer to a repeated click, not an error: someone already decided.
    return NextResponse.json(result, { status: result.outcome === "NOT_WAITING" ? 409 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to record this decision.";
    const notFound = /was not found/.test(message);
    return NextResponse.json({ error: { code: notFound ? "NOT_FOUND" : "DECISION_FAILED", message } }, { status: notFound ? 404 : 400 });
  }
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return undefined;
  }

  const prefix = `${name}=`;
  return cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix))
    ?.slice(prefix.length);
}
