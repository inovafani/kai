import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import type { PmsExtraQuantity, PmsTicketQuantity } from "@/core/pms/types";
import type { PmsProvider } from "@/core/tenant/types";
import { getBluePassStripeClient, type BluePassStripeEnv } from "./bluepass-stripe";

export const PMS_BOOKING_DIRECT_CHECKOUT_FLOW = "PMS_BOOKING_DIRECT";

export interface CreateBluePassCheckoutSessionForPmsBookingInput {
  tenantId: string;
  conversationId: string;
  pmsProvider: PmsProvider;
  productExternalId: string;
  productTitle: string;
  dateText: string;
  guests: number;
  travellerName: string;
  travellerEmail: string;
  travellerPhone?: string | null;
  ticketQuantities?: PmsTicketQuantity[] | null;
  extraQuantities?: PmsExtraQuantity[] | null;
  grossAmountCents: number;
  currency: string;
  externalBookingId: string;
}

// BluePass's own Stripe account collecting payment for a real-time, PMS-confirmed booking (e.g.
// boattime's Rezdy inventory) - distinct from createBluePassCheckoutSession (bluepass-stripe.ts),
// which is hard-tied to a BluePassInquiry/marketplace quote. This one requires no such row: the
// PMS's own PAYMENT_HOLD reservation (externalBookingId) is the source of truth for availability,
// BluePass only collects payment and later confirms that hold. The DB row is only created after
// Stripe confirms the session, so a Stripe failure never leaves an orphaned attempt record.
export async function createBluePassCheckoutSessionForPmsBooking(
  input: CreateBluePassCheckoutSessionForPmsBookingInput,
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
): Promise<{ checkoutUrl: string; sessionId: string; attemptId: string }> {
  const env = deps.env ?? process.env;
  const stripe = deps.stripeClient ?? getBluePassStripeClient(env);
  const appBaseUrl = (env.KAI_APP_URL ?? "http://localhost:3107").replace(/\/$/, "");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: input.currency.toLowerCase(),
          unit_amount: input.grossAmountCents,
          product_data: {
            name: `${input.productTitle} - ${input.dateText} (${input.guests} guest${input.guests === 1 ? "" : "s"})`
          }
        }
      }
    ],
    success_url: `${appBaseUrl}/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBaseUrl}/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}&cancelled=true`,
    // Stripe's own enforced floor (30min-24h). Rezdy's real PAYMENT_HOLD TTL is not surfaced
    // anywhere in this codebase - this is the tightest bound achievable without knowing it; needs
    // reassessing against a live Rezdy sandbox account (see the implementation plan's Phase 5).
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    metadata: {
      kaiFlow: PMS_BOOKING_DIRECT_CHECKOUT_FLOW,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      pmsProvider: input.pmsProvider
    }
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL for this session.");
  }

  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      pmsProvider: input.pmsProvider,
      productExternalId: input.productExternalId,
      productTitle: input.productTitle,
      dateText: input.dateText,
      guests: input.guests,
      travellerName: input.travellerName,
      travellerEmail: input.travellerEmail,
      travellerPhone: input.travellerPhone ?? null,
      ticketQuantities: (input.ticketQuantities ?? []) as unknown as object,
      extraQuantities: (input.extraQuantities ?? []) as unknown as object,
      grossAmountCents: input.grossAmountCents,
      currency: input.currency,
      externalBookingId: input.externalBookingId,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      status: "AWAITING_PAYMENT"
    }
  });

  return { checkoutUrl: session.url, sessionId: session.id, attemptId: attempt.id };
}
