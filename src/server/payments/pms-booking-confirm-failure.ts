import type { PmsBookingPaymentAttempt, Tenant, TenantConfig } from "@prisma/client";
import type Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import { upsertConversationBookingState, createAssistantMessage } from "@/server/conversation/conversation-repository";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { getBluePassStripeClient, type BluePassStripeEnv } from "./bluepass-stripe";

/**
 * The two-phase-commit failure path: BluePass's own Stripe charge succeeded, but the PMS booking
 * could not then be confirmed (e.g. Rezdy hold lapsed, slot no longer available). Per the approved
 * decision: auto-refund the traveller in full, tell them honestly, and alert the tenant's own
 * admin/ops via WhatsApp so a human can follow up. The refund must never be gated on whether an
 * admin phone is configured - only the alert is.
 */
export async function handlePmsBookingConfirmFailureRefundAndAlert(
  input: {
    attempt: PmsBookingPaymentAttempt;
    tenant: Tenant & { config: TenantConfig | null };
    confirmError: unknown;
  },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
): Promise<void> {
  const env = deps.env ?? process.env;
  const reason = input.confirmError instanceof Error ? input.confirmError.message : String(input.confirmError);

  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(input.tenant.id, input.attempt.pmsProvider, process.env);
    const pmsAdapter = getPmsAdapter(input.attempt.pmsProvider, tenantPmsEnv, fetch, input.tenant.slug);
    await pmsAdapter.cancelBooking(input.attempt.externalBookingId);
  } catch (error) {
    // Rezdy's cancelBooking is not implemented today (see RezdyPmsAdapter) - expected to throw;
    // the hold is left to expire on the PMS's own TTL. Log only, never block the refund below.
    console.warn("pms_booking_confirm_failure.release_hold_failed", {
      attemptId: input.attempt.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  let refundSucceeded = false;
  if (input.attempt.stripePaymentIntentId) {
    try {
      const stripe = deps.stripeClient ?? getBluePassStripeClient(env);
      await stripe.refunds.create({ payment_intent: input.attempt.stripePaymentIntentId });
      refundSucceeded = true;
    } catch (error) {
      console.error("pms_booking_confirm_failure.refund_failed", {
        attemptId: input.attempt.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  } else {
    console.error("pms_booking_confirm_failure.no_payment_intent", { attemptId: input.attempt.id });
  }

  const updated = await prisma.pmsBookingPaymentAttempt.update({
    where: { id: input.attempt.id },
    data: {
      status: refundSucceeded ? "CONFIRM_FAILED_REFUNDED" : "REFUND_FAILED",
      failureReason: reason
    }
  });

  await upsertConversationBookingState({
    tenantId: input.attempt.tenantId,
    conversationId: input.attempt.conversationId,
    state: {
      productExternalId: input.attempt.productExternalId,
      productTitle: input.attempt.productTitle,
      dateText: input.attempt.dateText,
      guests: input.attempt.guests,
      travellerName: input.attempt.travellerName,
      travellerEmail: input.attempt.travellerEmail,
      travellerPhone: input.attempt.travellerPhone,
      bookingStatus: "FAILED",
      bookingError: reason
    }
  });

  await createAssistantMessage({
    tenantId: input.attempt.tenantId,
    conversationId: input.attempt.conversationId,
    content: refundSucceeded
      ? `I'm sorry - ${input.attempt.productTitle} on ${input.attempt.dateText} is no longer available, so your payment has been fully refunded. Nothing further is needed from you.`
      : `I'm sorry - ${input.attempt.productTitle} on ${input.attempt.dateText} is no longer available. Your refund is being processed manually by our team; you'll hear from us shortly.`
  });

  const adminPhone = input.tenant.config?.adminWhatsAppPhone?.trim() || env.BOATTIME_ADMIN_WHATSAPP_PHONE?.trim();
  if (!adminPhone) {
    console.error("pms_booking_confirm_failure.no_admin_phone_configured", {
      tenantSlug: input.tenant.slug,
      attemptId: input.attempt.id
    });
    return;
  }

  const alertBody = refundSucceeded
    ? `Kai alert: payment for ${input.attempt.productTitle} on ${input.attempt.dateText} (${input.attempt.guests} guests, ${input.attempt.travellerName}) succeeded but the booking could not be confirmed (${reason}). Traveller was auto-refunded. PMS hold reference: ${input.attempt.externalBookingId}.`
    : `Kai URGENT: payment for ${input.attempt.productTitle} on ${input.attempt.dateText} (${input.attempt.guests} guests, ${input.attempt.travellerName}) succeeded but the booking could not be confirmed (${reason}), AND the automatic refund also FAILED. The traveller has been charged with no booking - please refund manually right away. PMS hold reference: ${input.attempt.externalBookingId}.`;

  await sendWhatsAppText({ to: adminPhone, role: "ops", body: alertBody });
  await prisma.pmsBookingPaymentAttempt.update({
    where: { id: updated.id },
    data: { adminAlertSentAt: new Date() }
  });
}
