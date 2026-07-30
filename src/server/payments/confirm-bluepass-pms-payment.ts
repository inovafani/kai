import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { calculateBluePassLedgerSplit, type BluePassLedgerCurrency } from "@/core/bluepass/ledger";
import { createAssistantMessage, upsertConversationBookingState } from "@/server/conversation/conversation-repository";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { handlePmsBookingConfirmFailureRefundAndAlert } from "./pms-booking-confirm-failure";

/**
 * Stripe webhook handler for a successful direct-PMS-booking checkout (e.g. boattime/Rezdy) - looks
 * up the PmsBookingPaymentAttempt by session id, confirms the PMS's own held reservation now that
 * payment has cleared, and only then posts the real (not estimated) commission/conservation split.
 * Idempotent: redelivery of the same Stripe event is a safe no-op once the attempt has moved past
 * AWAITING_PAYMENT.
 */
export async function handlePmsBookingCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const attempt = await prisma.pmsBookingPaymentAttempt.findUnique({
    where: { stripeCheckoutSessionId: session.id }
  });

  if (!attempt) {
    console.warn("pms_booking_checkout_webhook.unknown_session", { sessionId: session.id });
    return;
  }
  if (attempt.status !== "AWAITING_PAYMENT") {
    // Stripe can redeliver the same event - already processed, nothing more to do.
    return;
  }

  const stripePaymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : attempt.stripePaymentIntentId;

  const updated = await prisma.pmsBookingPaymentAttempt.update({
    where: { id: attempt.id },
    data: { status: "PAID_AWAITING_CONFIRM", stripePaymentIntentId }
  });

  const tenant = await prisma.tenant.findUnique({ where: { id: updated.tenantId }, include: { config: true } });
  if (!tenant) {
    console.error("pms_booking_checkout_webhook.tenant_not_found", { tenantId: updated.tenantId, attemptId: updated.id });
    return;
  }

  const tenantPmsEnv = await resolveTenantPmsEnv(tenant.id, updated.pmsProvider, process.env);
  const pmsAdapter = getPmsAdapter(updated.pmsProvider, tenantPmsEnv, fetch, tenant.slug);

  let confirmResult: { status: string } | null = null;
  let confirmError: unknown = null;

  try {
    if (!pmsAdapter.confirmBooking) {
      throw new Error(`${updated.pmsProvider} PMS adapter does not support confirmBooking.`);
    }
    confirmResult = await pmsAdapter.confirmBooking(updated.externalBookingId);
  } catch (error) {
    confirmError = error;
  }

  if (confirmError || confirmResult?.status !== "CONFIRMED") {
    await handlePmsBookingConfirmFailureRefundAndAlert({
      attempt: updated,
      tenant,
      confirmError: confirmError ?? new Error(`Rezdy confirm returned status ${confirmResult?.status ?? "unknown"}.`)
    });
    return;
  }

  const finalized = calculateBluePassLedgerSplit({
    inquiryId: updated.id,
    grossAmountCents: updated.grossAmountCents,
    currency: updated.currency as BluePassLedgerCurrency,
    status: "FINALIZED"
  });

  await prisma.pmsBookingLedgerEntry.createMany({
    data: finalized.map((entry) => ({
      tenantId: updated.tenantId,
      conversationId: updated.conversationId,
      pmsBookingPaymentAttemptId: updated.id,
      kind: entry.kind,
      amountCents: entry.amountCents,
      currency: entry.currency,
      status: entry.status,
      referralPartnerId: entry.referralPartnerId,
      referralLinkId: entry.referralLinkId,
      referralCode: entry.referralCode,
      referralRole: entry.referralRole,
      finalizedAt: new Date()
    }))
  });

  await prisma.pmsBookingPaymentAttempt.update({
    where: { id: updated.id },
    data: { status: "CONFIRMED" }
  });

  await upsertConversationBookingState({
    tenantId: updated.tenantId,
    conversationId: updated.conversationId,
    state: {
      productExternalId: updated.productExternalId,
      productTitle: updated.productTitle,
      dateText: updated.dateText,
      guests: updated.guests,
      travellerName: updated.travellerName,
      travellerEmail: updated.travellerEmail,
      travellerPhone: updated.travellerPhone,
      bookingStatus: "CONFIRMED",
      externalBookingId: updated.externalBookingId,
      externalProvider: updated.pmsProvider,
      bookingError: null
    }
  });

  await createAssistantMessage({
    tenantId: updated.tenantId,
    conversationId: updated.conversationId,
    content: `Payment received - your booking for ${updated.productTitle} on ${updated.dateText} for ${updated.guests} guest${
      updated.guests === 1 ? "" : "s"
    } is confirmed. Booking reference: ${updated.externalBookingId}.`
  });

  // Best-effort operator success alert, mirroring the failure path's own alert
  // (pms-booking-confirm-failure.ts) - a missing admin phone is a legitimate steady-state for some
  // tenants, so this never fails the webhook, just skips silently.
  const adminPhone = tenant.config?.adminWhatsAppPhone?.trim();
  if (adminPhone) {
    await sendWhatsAppText({
      to: adminPhone,
      role: "ops",
      body: `Kai alert: new booking confirmed - ${updated.productTitle} on ${updated.dateText} (${updated.guests} guest${
        updated.guests === 1 ? "" : "s"
      }, ${updated.travellerName}). Booking reference: ${updated.externalBookingId}.`
    });
    await prisma.pmsBookingPaymentAttempt.update({
      where: { id: updated.id },
      data: { adminAlertSentAt: new Date() }
    });
  }
}

/** Marks an unpaid direct-PMS checkout session's payment attempt PAYMENT_FAILED once Stripe reports
 * the session lapsed, and best-effort releases the PMS hold. */
export async function handlePmsBookingCheckoutSessionExpired(session: Stripe.Checkout.Session) {
  const attempt = await prisma.pmsBookingPaymentAttempt.findUnique({
    where: { stripeCheckoutSessionId: session.id }
  });

  if (!attempt || attempt.status !== "AWAITING_PAYMENT") return;

  await prisma.pmsBookingPaymentAttempt.update({
    where: { id: attempt.id },
    data: { status: "PAYMENT_FAILED", failureReason: "Stripe checkout session expired before payment." }
  });

  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(attempt.tenantId, attempt.pmsProvider, process.env);
    const tenant = await prisma.tenant.findUnique({ where: { id: attempt.tenantId } });
    const pmsAdapter = getPmsAdapter(attempt.pmsProvider, tenantPmsEnv, fetch, tenant?.slug);
    await pmsAdapter.cancelBooking(attempt.externalBookingId);
  } catch (error) {
    // Rezdy's cancelBooking is not implemented today (see RezdyPmsAdapter) - expected to throw;
    // the hold is left to expire on the PMS's own TTL. Log only, never surface to the traveller.
    console.warn("pms_booking_checkout_webhook.release_hold_failed", {
      attemptId: attempt.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  await createAssistantMessage({
    tenantId: attempt.tenantId,
    conversationId: attempt.conversationId,
    content: "Your secure payment link expired and nothing was charged. Would you like to try again?"
  });
}
