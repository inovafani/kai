import type { PmsBookingPaymentAttempt, Tenant, TenantConfig } from "@prisma/client";
import type Stripe from "stripe";
import { isPastOperatorDeadline, operatorDeadlineFrom, type OperatorDecision } from "@/core/native/native-decision";
import { prisma } from "@/lib/prisma";
import { createAssistantMessage, upsertConversationBookingState } from "@/server/conversation/conversation-repository";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import type { BluePassStripeEnv } from "./bluepass-stripe";
import { finalizeConfirmedPmsBooking } from "./finalize-confirmed-pms-booking";
import { handlePmsBookingConfirmFailureRefundAndAlert } from "./pms-booking-confirm-failure";

type TenantWithConfig = Tenant & { config: TenantConfig | null };

export type NativeDecisionOutcome =
  | { outcome: "CONFIRMED"; attemptId: string }
  | { outcome: "REFUNDED"; attemptId: string }
  | { outcome: "REFUND_FAILED"; attemptId: string }
  /** Someone else already decided (or the booking is not a native one waiting on an operator). Nothing was changed. */
  | { outcome: "NOT_WAITING"; attemptId: string; status: string };

function guestsLabel(guests: number) {
  return `${guests} guest${guests === 1 ? "" : "s"}`;
}

/**
 * The traveller has paid for a native booking and its seats are held. It is not confirmed yet: the
 * operator has until the deadline to accept. Records that, tells the traveller plainly what happens
 * next, and asks the operator. Nothing is refunded and no ledger line is written here.
 */
export async function handleNativePaymentAwaitingOperator(attempt: PmsBookingPaymentAttempt, tenant: TenantWithConfig) {
  await prisma.pmsBookingPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "AWAITING_OPERATOR" } });

  // The booking id is the attempt's externalBookingId. Linking back lets the operator side find the
  // payment from the booking. A missing row would mean the hold vanished, which the adapter's
  // confirm would already have answered FAILED for.
  const booking = await prisma.nativeBooking
    .update({ where: { id: attempt.externalBookingId }, data: { paymentAttemptId: attempt.id } })
    .catch((error) => {
      console.error("native_booking.link_attempt_failed", { attemptId: attempt.id, error: String(error) });
      return null;
    });
  const deadline = booking?.operatorDeadlineAt ?? operatorDeadlineFrom(new Date());

  await upsertConversationBookingState({
    tenantId: attempt.tenantId,
    conversationId: attempt.conversationId,
    state: {
      productExternalId: attempt.productExternalId,
      productTitle: attempt.productTitle,
      dateText: attempt.dateText,
      guests: attempt.guests,
      travellerName: attempt.travellerName,
      travellerEmail: attempt.travellerEmail,
      travellerPhone: attempt.travellerPhone,
      bookingStatus: "EXTERNAL_BOOKING_PENDING",
      confirmationSummary: "Paid. Waiting for the operator to accept.",
      externalBookingId: attempt.externalBookingId,
      externalProvider: attempt.pmsProvider,
      bookingError: null
    }
  });

  await createAssistantMessage({
    tenantId: attempt.tenantId,
    conversationId: attempt.conversationId,
    content: `Payment received. Your seats for ${attempt.productTitle} on ${attempt.dateText} for ${guestsLabel(
      attempt.guests
    )} are held, and ${tenant.name} now has 24 hours to accept. If they can't take you, you're refunded in full automatically. Booking reference: ${attempt.externalBookingId}.`
  });

  const adminPhone = tenant.config?.adminWhatsAppPhone?.trim();
  if (adminPhone) {
    await sendWhatsAppText({
      to: adminPhone,
      role: "ops",
      body: `Kai: new booking request, already paid. ${attempt.productTitle} on ${attempt.dateText}, ${guestsLabel(
        attempt.guests
      )}, ${attempt.travellerName}. Reference ${attempt.externalBookingId}. Please accept or decline before ${deadline.toISOString()}. If there is no answer by then, the traveller is refunded in full.`
    }).catch((error) => console.error("native_booking.operator_alert_failed", { attemptId: attempt.id, error: String(error) }));
    await prisma.pmsBookingPaymentAttempt.update({ where: { id: attempt.id }, data: { adminAlertSentAt: new Date() } });
  } else {
    console.error("native_booking.no_admin_phone_configured", { tenantSlug: tenant.slug, attemptId: attempt.id });
  }
}

/**
 * The operator's answer to a paid native booking, or the 24-hour timeout. ACCEPT confirms it (ledger,
 * traveller message, the same steps a Rezdy booking runs). DECLINE and EXPIRE release the seats and
 * refund the traveller in full through the existing refund path.
 *
 * Whoever claims the attempt first wins: it moves AWAITING_OPERATOR -> PAID_AWAITING_CONFIRM in one
 * conditional update, so an accept, a decline and the timeout racing each other can only ever run
 * one outcome, and a repeated click or webhook is a no-op that reports NOT_WAITING.
 */
export async function decideNativeBooking(
  input: { attemptId: string; decision: OperatorDecision; note?: string; tenantSlug?: string },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
): Promise<NativeDecisionOutcome> {
  const current = await prisma.pmsBookingPaymentAttempt.findUnique({ where: { id: input.attemptId } });
  if (!current) throw new Error(`Payment attempt ${input.attemptId} was not found.`);

  if (input.tenantSlug) {
    const owner = await prisma.tenant.findUnique({ where: { id: current.tenantId }, select: { slug: true } });
    // Same answer as a missing attempt, so one operator cannot probe for another's booking ids.
    if (owner?.slug !== input.tenantSlug) throw new Error(`Payment attempt ${input.attemptId} was not found.`);
  }
  if (current.pmsProvider !== "NATIVE") {
    return { outcome: "NOT_WAITING", attemptId: current.id, status: current.status };
  }

  const claim = await prisma.pmsBookingPaymentAttempt.updateMany({
    where: { id: current.id, status: "AWAITING_OPERATOR" },
    data: { status: "PAID_AWAITING_CONFIRM" }
  });
  if (claim.count !== 1) {
    const latest = await prisma.pmsBookingPaymentAttempt.findUnique({ where: { id: current.id }, select: { status: true } });
    return { outcome: "NOT_WAITING", attemptId: current.id, status: latest?.status ?? current.status };
  }

  const attempt = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: current.id } });
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: attempt.tenantId }, include: { config: true } });
  const now = new Date();

  if (input.decision === "ACCEPT") {
    const accepted = await prisma.nativeBooking.updateMany({
      where: { id: attempt.externalBookingId, tenantId: attempt.tenantId, status: "WAITING_OPERATOR" },
      data: { status: "CONFIRMED", decidedAt: now, decisionNote: input.note ?? null }
    });
    if (accepted.count === 1) {
      await finalizeConfirmedPmsBooking(attempt, tenant);
      return { outcome: "CONFIRMED", attemptId: attempt.id };
    }
    // The booking is no longer waiting (an admin cancelled it, say). The traveller has paid, so
    // they are refunded rather than left charged for a booking that does not exist.
    return refundNativeBooking(attempt, tenant, "DECLINE", "The booking was no longer waiting for the operator.", deps);
  }

  const status = input.decision === "DECLINE" ? "DECLINED" : "EXPIRED";
  await prisma.nativeBooking.updateMany({
    where: { id: attempt.externalBookingId, tenantId: attempt.tenantId, status: "WAITING_OPERATOR" },
    data: { status, decidedAt: now, decisionNote: input.note ?? (input.decision === "EXPIRE" ? "No answer within 24 hours." : null) }
  });
  const reason = input.decision === "DECLINE" ? `Operator declined${input.note ? `: ${input.note}` : "."}` : "Operator did not respond within 24 hours.";
  return refundNativeBooking(attempt, tenant, input.decision, reason, deps);
}

async function refundNativeBooking(
  attempt: PmsBookingPaymentAttempt,
  tenant: TenantWithConfig,
  decision: "DECLINE" | "EXPIRE",
  reason: string,
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv }
): Promise<NativeDecisionOutcome> {
  const trip = `${attempt.productTitle} on ${attempt.dateText}`;
  const why = decision === "EXPIRE" ? `${tenant.name} didn't confirm in time` : `${tenant.name} couldn't take your booking`;

  await handlePmsBookingConfirmFailureRefundAndAlert(
    {
      attempt,
      tenant,
      confirmError: new Error(reason),
      wording: {
        travellerRefunded: `I'm sorry - ${why} for ${trip}, so your payment has been fully refunded. Nothing further is needed from you.`,
        travellerManualRefund: `I'm sorry - ${why} for ${trip}. Your refund is being processed manually by our team; you'll hear from us shortly.`,
        operatorAlert: (refundSucceeded) =>
          refundSucceeded
            ? decision === "EXPIRE"
              ? `Kai: the booking request for ${trip} (reference ${attempt.externalBookingId}) was not answered within 24 hours, so the seats were released and the traveller was refunded in full.`
              : null
            : `Kai URGENT: the booking request for ${trip} (reference ${attempt.externalBookingId}) could not be kept (${reason}) and the automatic refund FAILED. The traveller has been charged with no booking. Please refund manually right away.`
      }
    },
    deps
  );

  const after = await prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id: attempt.id }, select: { status: true } });
  if (after.status === "REFUND_FAILED") {
    // The worst outcome: charged, no booking. Make sure BluePass hears about it, not only the operator.
    const teamPhone = process.env.KAI_TEAM_ALERT_WHATSAPP?.trim();
    if (teamPhone) {
      await sendWhatsAppText({
        to: teamPhone,
        role: "ops",
        body: `Kai URGENT: automatic refund FAILED for ${trip} (${tenant.name}, attempt ${attempt.id}, ${attempt.grossAmountCents} ${attempt.currency}). Refund the traveller manually in Stripe.`
      }).catch((error) => console.error("native_booking.team_alert_failed", { attemptId: attempt.id, error: String(error) }));
    }
    return { outcome: "REFUND_FAILED", attemptId: attempt.id };
  }
  return { outcome: "REFUNDED", attemptId: attempt.id };
}

export interface NativeExpirySweepResult {
  checked: number;
  expired: string[];
  skipped: { attemptId: string; reason: string }[];
}

/**
 * Refunds every paid native booking whose operator did not answer by the deadline. Safe to run as
 * often as wanted: a booking someone already decided is skipped by the claim in decideNativeBooking.
 */
export async function runNativeOperatorExpirySweep(
  now: Date = new Date(),
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
): Promise<NativeExpirySweepResult> {
  const waiting = await prisma.nativeBooking.findMany({
    where: { status: "WAITING_OPERATOR", operatorDeadlineAt: { lte: now }, paymentAttemptId: { not: null } },
    select: { paymentAttemptId: true, operatorDeadlineAt: true }
  });

  const expired: string[] = [];
  const skipped: { attemptId: string; reason: string }[] = [];

  for (const booking of waiting) {
    const attemptId = booking.paymentAttemptId as string;
    if (!isPastOperatorDeadline(booking.operatorDeadlineAt, now)) continue;
    try {
      const result = await decideNativeBooking({ attemptId, decision: "EXPIRE" }, deps);
      if (result.outcome === "REFUNDED") expired.push(attemptId);
      else skipped.push({ attemptId, reason: result.outcome === "NOT_WAITING" ? `Already ${result.status}.` : "Refund failed, needs a manual refund." });
    } catch (error) {
      skipped.push({ attemptId, reason: error instanceof Error ? error.message : "Unknown error." });
    }
  }

  return { checked: waiting.length, expired, skipped };
}
