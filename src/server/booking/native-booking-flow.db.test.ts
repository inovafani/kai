import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { NativePmsAdapter } from "@/core/pms/native-pms-adapter";
import { addDaysIso, todayInZone } from "@/core/native/native-time";
import { prisma } from "@/lib/prisma";
import { findConversationBookingState } from "@/server/conversation/conversation-repository";
import { PrismaNativeStore } from "@/server/native/prisma-native-store";
import type { BluePassPmsCheckoutClient } from "@/server/payments/bluepass-pms-checkout-client";
import { runGenericBookingTurn, type GenericBookingTurnTenant } from "./generic-booking-turn";

// End to end through Kai's real booking brain for a native operator: chat -> live trip list -> real
// availability -> seat hold -> checkout request. Needs the native-booking migration applied. Stripe
// and the cross-repo payout lookup are faked, so nothing is charged and nothing leaves this machine.
// Deleting the tenant cascades to the conversation, trips, departures and bookings.
const SLUG_PREFIX = "native-flow-";
const ZONE = "America/Barbados";

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { startsWith: SLUG_PREFIX } } });
});

async function setUpOperator() {
  const slug = `${SLUG_PREFIX}${randomUUID()}`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name: "Blue Water Tours",
      widgetPublicKey: `pk_test_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE",
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: ["bluepass_stripe_pms_checkout"],
          requiredSlots: {},
          bookingMode: "AUTO_BOOKING",
          bookingWriteEnabled: true,
          pmsProvider: "NATIVE",
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
  const trip = await prisma.nativeTrip.create({
    data: {
      tenantId: tenant.id,
      title: "Reef Snorkel",
      description: "Two hours on the reef with a guide.",
      durationMinutes: 120,
      currency: "USD",
      timeZone: ZONE,
      status: "PUBLISHED",
      ticketTypes: { create: [{ label: "Adult", priceCents: 12000 }, { label: "Child", priceCents: 6000, sortOrder: 1 }] },
      schedules: { create: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], localTime: "09:00", seats: 6 }] }
    }
  });
  const conversation = await prisma.conversation.create({ data: { tenantId: tenant.id, channel: "WEB_WIDGET" } });
  const turnTenant: GenericBookingTurnTenant = {
    id: tenant.id,
    slug,
    name: tenant.name,
    config: {
      pmsProvider: "NATIVE",
      publicProductCatalog: [],
      bookingWriteEnabled: true,
      enabledFeatures: ["bluepass_stripe_pms_checkout"]
    },
    branding: { brandVoice: null }
  };
  return { tenant: turnTenant, tenantId: tenant.id, tripId: trip.id, conversationId: conversation.id };
}

function chat(setup: Awaited<ReturnType<typeof setUpOperator>>, checkoutClient: BluePassPmsCheckoutClient) {
  const travellerMessages: string[] = [];
  const history: { role: "traveller" | "assistant"; content: string }[] = [];
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ cancellationPolicyTiers: null }), { status: 200 }));

  return {
    transcript: history,
    async say(content: string) {
      const previousBookingState = await findConversationBookingState({ tenantId: setup.tenantId, conversationId: setup.conversationId });
      const result = await runGenericBookingTurn({
        tenant: setup.tenant,
        conversationId: setup.conversationId,
        content,
        previousBookingState,
        priorTravellerMessages: [...travellerMessages],
        priorConversationMessages: [...history],
        bluePassPmsCheckoutClient: checkoutClient,
        fetcher: fetcher as unknown as typeof fetch
      });
      travellerMessages.push(content);
      history.push({ role: "traveller", content }, { role: "assistant", content: result.assistantContent });
      return result;
    }
  };
}

describe("native operator booking through Kai", () => {
  it("takes a traveller from first message to a seat hold and a checkout request in the trip's own currency", async () => {
    const setup = await setUpOperator();
    const date = addDaysIso(todayInZone(ZONE), 3);
    const createCheckoutSession = vi.fn(async () => ({
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_native",
      sessionId: "cs_test_native",
      attemptId: "attempt_native"
    }));
    const conversation = chat(setup, { createCheckoutSession });

    const first = await conversation.say(`Hi, I'd like to book the Reef Snorkel for 2 people on ${date}`);
    expect(first.bookingResult?.action).toBe("BOOKING_TICKET_SELECTION_REQUIRED");
    expect(first.assistantContent).toContain("6 seats available");
    expect(first.assistantContent).toContain("9:00 AM");
    expect(first.assistantContent).toContain("Adult - US$120");
    expect(first.assistantContent).toContain("Child - US$60");

    const second = await conversation.say("2 adults");
    expect(second.bookingResult?.action).toBe("BOOKING_DETAILS_REQUIRED");
    expect(await prisma.nativeBooking.count({ where: { tenantId: setup.tenantId } })).toBe(0);

    const third = await conversation.say("My name is Ana Reyes, email ana@example.com, phone +12465550134");
    expect(third.bookingResult?.action).toBe("BOOKING_PAYMENT_REQUIRED");
    expect(third.paymentRequest?.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_native");
    // The fare is US$240 for two adults, so the conservation line must say US$, not A$.
    expect(third.assistantContent).toContain("US$12 of this fare funds ocean and reef conservation");

    const bookings = await prisma.nativeBooking.findMany({ where: { tenantId: setup.tenantId } });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      status: "HELD",
      seats: 2,
      totalCents: 24000,
      currency: "USD",
      travellerName: "Ana Reyes",
      travellerEmail: "ana@example.com"
    });
    expect(createCheckoutSession).toHaveBeenCalledTimes(1);
    expect(createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: setup.tenantId,
        pmsProvider: "NATIVE",
        externalBookingId: bookings[0].id,
        grossAmountCents: 24000,
        currency: "USD"
      })
    );
  }, 240_000);

  it("keeps the paid seats while the operator decides, so the next traveller sees fewer seats", async () => {
    const setup = await setUpOperator();
    const date = addDaysIso(todayInZone(ZONE), 3);
    const adapter = new NativePmsAdapter({ store: new PrismaNativeStore(setup.tenant.slug) });

    const { externalBookingId } = await adapter.createBooking({
      productId: setup.tripId,
      date: `${date} 09:00:00`,
      guests: 4,
      travellerName: "Ana Reyes",
      travellerEmail: "ana@example.com"
    });
    expect((await adapter.confirmBooking(externalBookingId)).status).toBe("PENDING");
    expect((await prisma.nativeBooking.findUniqueOrThrow({ where: { id: externalBookingId } })).status).toBe("WAITING_OPERATOR");

    const conversation = chat(setup, { createCheckoutSession: vi.fn() });
    const reply = await conversation.say(`I'd like the Reef Snorkel for 5 people on ${date}`);
    expect(reply.assistantContent).not.toContain("has room for 5 guests");
  }, 240_000);
});
