import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { runGenericBookingTurn, type GenericBookingTurnTenant } from "./generic-booking-turn";
import type { BluePassPmsCheckoutClient } from "@/server/payments/bluepass-pms-checkout-client";

async function createTestConversation() {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `generic-turn-${randomUUID()}`,
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

    const result = await runGenericBookingTurn({
      tenant: baseTenant(tenantId, { enabledFeatures: ["bluepass_stripe_pms_checkout"] }),
      conversationId,
      content: "confirmed",
      previousBookingState,
      priorTravellerMessages: [],
      priorConversationMessages: [],
      bluePassPmsCheckoutClient: checkoutClient
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
    expect(result.assistantContent).toContain("never sees or stores your card details");
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
    expect(result.assistantContent).toContain("could not prepare the secure payment link");
  }, 30000);
});
