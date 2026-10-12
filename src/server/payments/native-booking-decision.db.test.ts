import { randomUUID } from "node:crypto";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NativePmsAdapter } from "@/core/pms/native-pms-adapter";
import { addDaysIso, todayInZone } from "@/core/native/native-time";
import { prisma } from "@/lib/prisma";
import { PrismaNativeStore } from "@/server/native/prisma-native-store";
import { handlePmsBookingCheckoutSessionCompleted } from "./confirm-bluepass-pms-payment";
import { decideNativeBooking, runNativeOperatorExpirySweep } from "./native-booking-decision";

// The native money path end to end, against the real database, with Stripe and WhatsApp faked so
// nothing is charged, refunded or sent. Needs both native migrations applied. The tenant (and with
// it every trip, booking, attempt, ledger line and message) is deleted afterwards.
vi.mock("@/server/whatsapp/client", () => ({ sendWhatsAppText: vi.fn(async () => undefined) }));
import { sendWhatsAppText } from "@/server/whatsapp/client";

const SLUG = `native-pay-${randomUUID()}`;
const ZONE = "America/Barbados";
const ADMIN_PHONE = "12465550134";

let tenantId = "";
let tripId = "";
let conversationId = "";
let dayOffset = 10;

afterAll(async () => {
  // Payment attempts are not removed by deleting the tenant, so clear them (and their ledger
  // lines) first, otherwise every run would leave orphans behind.
  if (tenantId) {
    await prisma.pmsBookingLedgerEntry.deleteMany({ where: { tenantId } });
    await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { tenantId } });
  }
  await prisma.tenant.deleteMany({ where: { slug: SLUG } });
});

beforeAll(async () => {
  const tenant = await prisma.tenant.create({
    data: {
      slug: SLUG,
      name: "Blue Water Tours",
      widgetPublicKey: `pk_test_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: ["bluepass_stripe_pms_checkout"],
          requiredSlots: {},
          bookingMode: "AUTO_BOOKING",
          bookingWriteEnabled: true,
          pmsProvider: "NATIVE",
          escalationRules: [],
          responseGuardrails: [],
          adminWhatsAppPhone: ADMIN_PHONE
        }
      }
    }
  });
  tenantId = tenant.id;
  const trip = await prisma.nativeTrip.create({
    data: {
      tenantId,
      title: "Reef Snorkel",
      durationMinutes: 120,
      currency: "USD",
      timeZone: ZONE,
      status: "PUBLISHED",
      ticketTypes: { create: [{ label: "Adult", priceCents: 10000 }] },
      schedules: { create: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], localTime: "09:00", seats: 4 }] }
    }
  });
  tripId = trip.id;
  conversationId = (await prisma.conversation.create({ data: { tenantId, channel: "WEB_WIDGET" } })).id;
});

function fakeStripe(refund: () => Promise<{ id: string }> = async () => ({ id: `re_${randomUUID()}` })) {
  const create = vi.fn(async (_params: Stripe.RefundCreateParams) => refund());
  return { stripe: { refunds: { create } } as unknown as Stripe, create };
}

/** A traveller who held seats and has just paid: the state the payment webhook finds. */
async function paidBooking(guests = 2) {
  dayOffset += 1;
  const date = addDaysIso(todayInZone(ZONE), dayOffset);
  const adapter = new NativePmsAdapter({ store: new PrismaNativeStore(SLUG) });
  const hold = await adapter.createBooking({
    productId: tripId,
    date: `${date} 09:00:00`,
    guests,
    travellerName: "Ana Reyes",
    travellerEmail: "ana@example.com"
  });
  expect(hold.status).toBe("PENDING");

  const sessionId = `cs_test_${randomUUID()}`;
  const paymentIntent = `pi_${randomUUID()}`;
  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId,
      conversationId,
      pmsProvider: "NATIVE",
      productExternalId: tripId,
      productTitle: "Reef Snorkel",
      dateText: `${date} 09:00:00`,
      guests,
      travellerName: "Ana Reyes",
      travellerEmail: "ana@example.com",
      grossAmountCents: 10000 * guests,
      currency: "USD",
      externalBookingId: hold.externalBookingId,
      stripeCheckoutSessionId: sessionId
    }
  });
  await handlePmsBookingCheckoutSessionCompleted({ id: sessionId, payment_intent: paymentIntent } as Stripe.Checkout.Session);
  return { attemptId: attempt.id, bookingId: hold.externalBookingId, date, sessionId };
}

const attemptOf = (id: string) => prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id } });
const bookingOf = (id: string) => prisma.nativeBooking.findUniqueOrThrow({ where: { id } });
const ledgerOf = (attemptId: string) => prisma.pmsBookingLedgerEntry.findMany({ where: { pmsBookingPaymentAttemptId: attemptId } });
const lastMessage = async () => (await prisma.message.findFirst({ where: { conversationId }, orderBy: { createdAt: "desc" } }))?.content ?? "";

describe("native booking: paid, waiting for the operator", () => {
  it("holds the seats, starts a 24 hour clock, tells both sides, and books nothing yet", async () => {
    vi.mocked(sendWhatsAppText).mockClear();
    const paid = await paidBooking(2);

    const attempt = await attemptOf(paid.attemptId);
    expect(attempt.status).toBe("AWAITING_OPERATOR");
    expect(attempt.stripeRefundId).toBeNull();

    const booking = await bookingOf(paid.bookingId);
    expect(booking.status).toBe("WAITING_OPERATOR");
    expect(booking.paymentAttemptId).toBe(paid.attemptId);
    const hoursLeft = ((booking.operatorDeadlineAt as Date).getTime() - Date.now()) / 3_600_000;
    expect(hoursLeft).toBeGreaterThan(23.9);
    expect(hoursLeft).toBeLessThanOrEqual(24);

    // No money is split until the operator accepts.
    expect(await ledgerOf(paid.attemptId)).toHaveLength(0);

    expect(await lastMessage()).toContain("24 hours to accept");
    expect(await lastMessage()).toContain("refunded in full");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    const alert = (vi.mocked(sendWhatsAppText).mock.calls as unknown as [{ to: string; role: string; body: string }][])[0][0];
    expect(alert).toMatchObject({ to: ADMIN_PHONE, role: "ops" });
    expect(alert.body).toContain(paid.bookingId);

    // A redelivered Stripe event changes nothing.
    await handlePmsBookingCheckoutSessionCompleted({ id: paid.sessionId, payment_intent: "pi_again" } as Stripe.Checkout.Session);
    expect((await attemptOf(paid.attemptId)).status).toBe("AWAITING_OPERATOR");
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
  }, 180_000);

  it("accepting confirms it: the ledger is split once and the traveller is told", async () => {
    const paid = await paidBooking(2);
    const { stripe, create } = fakeStripe();

    const result = await decideNativeBooking({ attemptId: paid.attemptId, decision: "ACCEPT" }, { stripeClient: stripe });
    expect(result.outcome).toBe("CONFIRMED");

    expect((await attemptOf(paid.attemptId)).status).toBe("CONFIRMED");
    const booking = await bookingOf(paid.bookingId);
    expect(booking.status).toBe("CONFIRMED");
    expect(booking.decidedAt).not.toBeNull();

    const ledger = await ledgerOf(paid.attemptId);
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger.every((entry) => entry.status === "FINALIZED")).toBe(true);
    expect(await lastMessage()).toContain("is confirmed");
    expect(create).not.toHaveBeenCalled();

    // Accepting again must not write the ledger twice or refund anything.
    const again = await decideNativeBooking({ attemptId: paid.attemptId, decision: "ACCEPT" }, { stripeClient: stripe });
    expect(again).toMatchObject({ outcome: "NOT_WAITING", status: "CONFIRMED" });
    expect(await ledgerOf(paid.attemptId)).toHaveLength(ledger.length);
  }, 180_000);

  it("declining refunds in full, frees the seats and leaves nothing in the ledger", async () => {
    const paid = await paidBooking(3);
    const { stripe, create } = fakeStripe();
    const store = new PrismaNativeStore(SLUG);
    const before = (await store.departuresForDates(tripId, [paid.date], new Date()))[0];
    expect(before.seatsLeft).toBe(1);

    const result = await decideNativeBooking({ attemptId: paid.attemptId, decision: "DECLINE", note: "Boat in maintenance" }, { stripeClient: stripe });
    expect(result.outcome).toBe("REFUNDED");

    const attempt = await attemptOf(paid.attemptId);
    expect(attempt.status).toBe("CONFIRM_FAILED_REFUNDED");
    expect(attempt.failureReason).toContain("Operator declined");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0]).toMatchObject({ payment_intent: expect.stringMatching(/^pi_/) });
    // A full refund: no amount is passed, so Stripe returns everything.
    expect(create.mock.calls[0][0]).not.toHaveProperty("amount");

    const booking = await bookingOf(paid.bookingId);
    expect(booking.status).toBe("DECLINED");
    expect(booking.decisionNote).toBe("Boat in maintenance");
    expect((await store.departuresForDates(tripId, [paid.date], new Date()))[0].seatsLeft).toBe(4);
    expect(await ledgerOf(paid.attemptId)).toHaveLength(0);
    expect(await lastMessage()).toContain("fully refunded");

    const again = await decideNativeBooking({ attemptId: paid.attemptId, decision: "DECLINE" }, { stripeClient: stripe });
    expect(again.outcome).toBe("NOT_WAITING");
    expect(create).toHaveBeenCalledTimes(1);
  }, 180_000);

  it("refunds after 24 hours of silence, and leaves bookings that are still inside their window alone", async () => {
    const late = await paidBooking(1);
    const early = await paidBooking(1);
    await prisma.nativeBooking.update({ where: { id: late.bookingId }, data: { operatorDeadlineAt: new Date(Date.now() - 60_000) } });
    const { stripe, create } = fakeStripe();

    const sweep = await runNativeOperatorExpirySweep(new Date(), { stripeClient: stripe });
    expect(sweep.expired).toContain(late.attemptId);
    expect(sweep.expired).not.toContain(early.attemptId);

    expect((await attemptOf(late.attemptId)).status).toBe("CONFIRM_FAILED_REFUNDED");
    expect((await attemptOf(late.attemptId)).failureReason).toContain("did not respond");
    expect((await bookingOf(late.bookingId)).status).toBe("EXPIRED");
    expect((await attemptOf(early.attemptId)).status).toBe("AWAITING_OPERATOR");
    expect((await bookingOf(early.bookingId)).status).toBe("WAITING_OPERATOR");
    expect(create).toHaveBeenCalledTimes(1);

    // Running the job again is harmless.
    const second = await runNativeOperatorExpirySweep(new Date(), { stripeClient: stripe });
    expect(second.expired).not.toContain(late.attemptId);
    expect(create).toHaveBeenCalledTimes(1);
  }, 240_000);

  it("lets only one answer win when an accept and a decline arrive together", async () => {
    const paid = await paidBooking(1);
    const { stripe, create } = fakeStripe();

    const [accept, decline] = await Promise.all([
      decideNativeBooking({ attemptId: paid.attemptId, decision: "ACCEPT" }, { stripeClient: stripe }),
      decideNativeBooking({ attemptId: paid.attemptId, decision: "DECLINE" }, { stripeClient: stripe })
    ]);

    const outcomes = [accept.outcome, decline.outcome].sort();
    expect(outcomes.filter((outcome) => outcome === "NOT_WAITING")).toHaveLength(1);
    const status = (await attemptOf(paid.attemptId)).status;
    if (accept.outcome === "CONFIRMED") {
      expect(status).toBe("CONFIRMED");
      expect(create).not.toHaveBeenCalled();
      expect((await ledgerOf(paid.attemptId)).length).toBeGreaterThan(0);
    } else {
      expect(status).toBe("CONFIRM_FAILED_REFUNDED");
      expect(create).toHaveBeenCalledTimes(1);
      expect(await ledgerOf(paid.attemptId)).toHaveLength(0);
    }
  }, 180_000);

  it("flags a refund that fails instead of pretending it worked", async () => {
    const paid = await paidBooking(1);
    const { stripe } = fakeStripe(async () => {
      throw new Error("Stripe is down");
    });

    const result = await decideNativeBooking({ attemptId: paid.attemptId, decision: "DECLINE" }, { stripeClient: stripe });
    expect(result.outcome).toBe("REFUND_FAILED");
    expect((await attemptOf(paid.attemptId)).status).toBe("REFUND_FAILED");
    expect(await lastMessage()).toContain("processed manually");
  }, 180_000);

  it("will not decide a booking through another operator's slug", async () => {
    const paid = await paidBooking(1);
    const { stripe, create } = fakeStripe();

    await expect(decideNativeBooking({ attemptId: paid.attemptId, decision: "DECLINE", tenantSlug: "some-other-operator" }, { stripeClient: stripe })).rejects.toThrow(
      "was not found"
    );
    expect((await attemptOf(paid.attemptId)).status).toBe("AWAITING_OPERATOR");
    expect(create).not.toHaveBeenCalled();

    // The right slug works.
    const ok = await decideNativeBooking({ attemptId: paid.attemptId, decision: "DECLINE", tenantSlug: SLUG }, { stripeClient: stripe });
    expect(ok.outcome).toBe("REFUNDED");
  }, 180_000);
});
