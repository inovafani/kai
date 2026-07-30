import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createBluePassCheckoutSessionForPmsBooking } from "./bluepass-pms-stripe";

function fakeStripeClient(sessionId: string) {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: sessionId,
          url: `https://checkout.stripe.com/c/pay/${sessionId}`,
          payment_intent: null
        }))
      }
    }
  };
}

describe("createBluePassCheckoutSessionForPmsBooking", () => {
  it("creates a Stripe Checkout Session with the correct amount/currency/metadata and persists an AWAITING_PAYMENT attempt", async () => {
    const sessionId = `cs_test_${randomUUID()}`;
    const stripeClient = fakeStripeClient(sessionId);
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conv_${randomUUID()}`;

    const result = await createBluePassCheckoutSessionForPmsBooking(
      {
        tenantId,
        conversationId,
        pmsProvider: "REZDY",
        productExternalId: "boattime-whale-escape",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-26 13:30:00",
        guests: 2,
        travellerName: "Test",
        travellerEmail: "test@gmail.com",
        travellerPhone: "086775428176",
        ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
        extraQuantities: [],
        grossAmountCents: 10000,
        currency: "AUD",
        externalBookingId: "RZ-HOLD-1"
      },
      { stripeClient: stripeClient as never, env: { BLUEPASS_STRIPE_SECRET_KEY: "sk_test_x", KAI_APP_URL: "https://kai.example" } }
    );

    expect(result.checkoutUrl).toBe(`https://checkout.stripe.com/c/pay/${sessionId}`);
    expect(result.sessionId).toBe(sessionId);

    expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        line_items: [
          expect.objectContaining({
            quantity: 1,
            price_data: expect.objectContaining({
              currency: "aud",
              unit_amount: 10000
            })
          })
        ],
        success_url: "https://kai.example/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://kai.example/embed/kai/payment-return?session_id={CHECKOUT_SESSION_ID}&cancelled=true",
        metadata: {
          kaiFlow: "PMS_BOOKING_DIRECT",
          tenantId,
          conversationId,
          pmsProvider: "REZDY"
        }
      })
    );

    const attempt = await prisma.pmsBookingPaymentAttempt.findUnique({
      where: { id: result.attemptId }
    });

    expect(attempt).toMatchObject({
      tenantId,
      conversationId,
      pmsProvider: "REZDY",
      productTitle: "Gold Coast Whale Escape",
      grossAmountCents: 10000,
      currency: "AUD",
      externalBookingId: "RZ-HOLD-1",
      stripeCheckoutSessionId: sessionId,
      status: "AWAITING_PAYMENT"
    });
  });

  it("throws and does not create an attempt row when Stripe does not return a checkout URL", async () => {
    const stripeClient = {
      checkout: {
        sessions: {
          create: vi.fn(async () => ({ id: "cs_no_url", url: null, payment_intent: null }))
        }
      }
    } as never;

    await expect(
      createBluePassCheckoutSessionForPmsBooking(
        {
          tenantId: `tenant_${randomUUID()}`,
          conversationId: `conv_${randomUUID()}`,
          pmsProvider: "REZDY",
          productExternalId: "boattime-whale-escape",
          productTitle: "Gold Coast Whale Escape",
          dateText: "2026-06-26 13:30:00",
          guests: 2,
          travellerName: "Test",
          travellerEmail: "test@gmail.com",
          grossAmountCents: 10000,
          currency: "AUD",
          externalBookingId: "RZ-HOLD-2"
        },
        { stripeClient, env: { BLUEPASS_STRIPE_SECRET_KEY: "sk_test_x" } }
      )
    ).rejects.toThrow("Stripe did not return a checkout URL for this session.");

    const attempt = await prisma.pmsBookingPaymentAttempt.findUnique({
      where: { stripeCheckoutSessionId: "cs_no_url" }
    });
    expect(attempt).toBeNull();
  });
});
