import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runGenericBookingTurn, type GenericBookingTurnTenant } from "./generic-booking-turn";
import type { BluePassPmsCheckoutClient } from "@/server/payments/bluepass-pms-checkout-client";

const TENANT_SLUG_PREFIX = "generic-turn-";

// No test DB exists in this repo - these tests write real rows to the same Supabase instance
// production reads from. Deleting the tenant is enough: every FK this test touches (Conversation,
// and whatever booking/ledger rows a real turn creates off it) is declared onDelete: Cascade in the
// schema, so Postgres removes them for free.
afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: TENANT_SLUG_PREFIX } } });
});

async function createTestConversation() {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `${TENANT_SLUG_PREFIX}${randomUUID()}`,
      name: "Boattime Yacht Charters",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://boattime.example"],
      status: "ACTIVE"
    }
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId: tenant.id, channel: "WEB_WIDGET" }
  });

  return { tenantId: tenant.id, conversationId: conversation.id };
}

function baseTenant(
  tenantId: string,
  overrides: Partial<GenericBookingTurnTenant["config"]> = {}
): GenericBookingTurnTenant {
  return {
    id: tenantId,
    slug: "boattime",
    name: "Boattime Yacht Charters",
    config: {
      pmsProvider: "MOCK",
      publicProductCatalog: [],
      bookingWriteEnabled: true,
      ...overrides
    },
    branding: { brandVoice: null }
  };
}

const previousBookingState = {
  productExternalId: "boattime-whale-escape",
  productTitle: "Gold Coast Whale Escape",
  dateText: "2026-06-26 13:30:00",
  guests: 2,
  travellerName: "Test",
  travellerEmail: "test@gmail.com",
  travellerPhone: "086775428176",
  ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }],
  ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
  extraQuantities: []
};

describe("runGenericBookingTurn - BluePass Stripe PMS checkout", () => {
  it("does not call the checkout client or set pmsCheckoutHold when the tenant feature flag is off (regression guard)", async () => {
    const { tenantId, conversationId } = await createTestConversation();
    const checkoutClient: BluePassPmsCheckoutClient = {
      createCheckoutSession: vi.fn()
    };

    const result = await runGenericBookingTurn({
      tenant: baseTenant(tenantId, { enabledFeatures: [] }),
      conversationId,
      content: "confirmed",
      previousBookingState,
      priorTravellerMessages: [],
      priorConversationMessages: [],
      bluePassPmsCheckoutClient: checkoutClient
    });

    expect(checkoutClient.createCheckoutSession).not.toHaveBeenCalled();
    expect(result.bookingResult?.pmsCheckoutHold).toBeUndefined();
    expect(result.paymentRequest?.checkoutUrl).toBeNull();
  });

  it("calls the checkout client and uses its real checkout URL when the tenant feature flag is on", async () => {
    const { tenantId, conversationId } = await createTestConversation();
    const checkoutClient: BluePassPmsCheckoutClient = {
      createCheckoutSession: vi.fn(async () => ({
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_real",
        sessionId: "cs_test_real",
        attemptId: "attempt_1"
      }))
    };
    // Never actually hit bluepass.co - a real checkoutUrl means the cancellation-policy disclosure
    // lookup fires too, which without this would be a genuine network call to production.
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ cancellationPolicyTiers: null }), { status: 200 }));

    const result = await runGenericBookingTurn({
      tenant: baseTenant(tenantId, { enabledFeatures: ["bluepass_stripe_pms_checkout"] }),
      conversationId,
      content: "confirmed",
      previousBookingState,
      priorTravellerMessages: [],
      priorConversationMessages: [],
      bluePassPmsCheckoutClient: checkoutClient,
      fetcher: fetcher as unknown as typeof fetch
    });

    expect(checkoutClient.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        conversationId,
        productTitle: "Gold Coast Whale Escape",
        grossAmountCents: 10000,
        currency: "AUD"
      })
    );
    expect(result.paymentRequest?.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_real");
    expect(result.assistantContent).toContain("https://checkout.stripe.com/c/pay/cs_test_real");
    expect(result.assistantContent).toContain("never see or store your card details");
    // No operator-specific tiers were mocked, so this is the platform default - proves the
    // disclosure is present at all before the next test proves it reflects a real operator's tiers.
    expect(result.assistantContent).toContain(
      "Cancellation policy: Full refund 14+ days before departure, 50% refund 3-13 days before, no refund within 3 days."
    );
    // grossAmountCents is 10000 (2 x A$50 adult tickets, see previousBookingState above) - 5% of
    // that is A$5. Generic partner phrasing, deliberately: a real PMS booking has no per-trip
    // named conservation partner recorded anywhere server-side (see the comment on this block in
    // generic-booking-turn.ts).
    expect(result.assistantContent).toContain(
      "A$5 of this fare funds ocean and reef conservation - built into the price you see, never added to it."
    );
  });

  it("discloses the operator's own saved cancellation tiers, not the platform default", async () => {
    const { tenantId, conversationId } = await createTestConversation();
    const checkoutClient: BluePassPmsCheckoutClient = {
      createCheckoutSession: vi.fn(async () => ({
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_custom",
        sessionId: "cs_test_custom",
        attemptId: "attempt_2"
      }))
    };
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            cancellationPolicyTiers: [
              { minDaysBeforeDeparture: 7, refundPercent: 100 },
              { minDaysBeforeDeparture: 0, refundPercent: 50 }
            ]
          }),
          { status: 200 }
        )
    );

    const result = await runGenericBookingTurn({
      tenant: baseTenant(tenantId, { enabledFeatures: ["bluepass_stripe_pms_checkout"] }),
      conversationId,
      content: "confirmed",
      previousBookingState,
      priorTravellerMessages: [],
      priorConversationMessages: [],
      bluePassPmsCheckoutClient: checkoutClient,
      fetcher: fetcher as unknown as typeof fetch
    });

    expect(result.assistantContent).toContain(
      "Cancellation policy: Full refund 7+ days before departure, 50% refund within 7 days."
    );
  });

  it("falls back to safe lead-saved messaging with a null checkoutUrl when the checkout client throws", async () => {
    const { tenantId, conversationId } = await createTestConversation();
    const checkoutClient: BluePassPmsCheckoutClient = {
      createCheckoutSession: vi.fn(async () => {
        throw new Error("Stripe unavailable");
      })
    };

    const result = await runGenericBookingTurn({
      tenant: baseTenant(tenantId, { enabledFeatures: ["bluepass_stripe_pms_checkout"] }),
      conversationId,
      content: "confirmed",
      previousBookingState,
      priorTravellerMessages: [],
      priorConversationMessages: [],
      bluePassPmsCheckoutClient: checkoutClient
    });

    expect(result.paymentRequest?.checkoutUrl).toBeNull();
    expect(result.assistantContent).toContain("I couldn't set up the secure payment link just now");
    // Same guard as the cancellation disclosure - nothing is actually payable here, so neither
    // disclosure should fire.
    expect(result.assistantContent).not.toContain("funds ocean and reef conservation");
  }, 30000);
});

describe("runGenericBookingTurn - hand the payment to the operator's Rezdy page", () => {
  const withTime = {
    ...previousBookingState,
    timeOptions: [{ label: "1:30 PM", startTimeLocal: "2026-06-26 13:30:00", remaining: 6, checkoutItemKey: "item-431872-480938442" }]
  };

  it("sends the traveller to Rezdy for the chosen time instead of BluePass Stripe, even if the Stripe flag is still on", async () => {
    const { tenantId, conversationId } = await createTestConversation();
    const checkoutClient: BluePassPmsCheckoutClient = { createCheckoutSession: vi.fn() };
    // Nothing may be fetched: BluePass's refund tiers are not quoted for a Rezdy booking.
    const fetcher = vi.fn(async () => {
      throw new Error("No lookup is expected for a Rezdy hand-off.");
    });

    const result = await runGenericBookingTurn({
      tenant: baseTenant(tenantId, { enabledFeatures: ["bluepass_stripe_pms_checkout", "rezdy_checkout_handoff"] }),
      conversationId,
      content: "confirmed",
      previousBookingState: withTime,
      priorTravellerMessages: [],
      priorConversationMessages: [],
      bluePassPmsCheckoutClient: checkoutClient,
      fetcher: fetcher as unknown as typeof fetch
    });

    const expectedUrl = "https://boattimeyachtcharters.rezdy.com/services/431872?itemKey=item-431872-480938442&useTransparentSessions=1";
    expect(checkoutClient.createCheckoutSession).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.bookingResult?.rezdyHandoff).toBe(true);
    expect(result.bookingResult?.pmsCheckoutHold).toBeUndefined();
    expect(result.paymentRequest?.checkoutUrl).toBe(expectedUrl);
    expect(result.assistantContent).toContain(expectedUrl);
    expect(result.assistantContent).toContain("never see or store your card details");
    expect(result.assistantContent).not.toContain("Cancellation policy:");
    expect(result.assistantContent).not.toContain("conservation");
    // The traveller carries on in Rezdy, so nothing is left waiting for a person in Kai.
    expect(await prisma.manualInquiry.count({ where: { conversationId } })).toBe(0);
  });
});
