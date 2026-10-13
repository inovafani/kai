import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NativePmsAdapter } from "@/core/pms/native-pms-adapter";
import { addDaysIso, todayInZone } from "@/core/native/native-time";
import { prisma } from "@/lib/prisma";
import { GET as listBookings } from "@/app/api/admin/[tenantSlug]/native-bookings/route";
import { POST as decide } from "@/app/api/admin/[tenantSlug]/native-bookings/[attemptId]/decision/route";
import { GET as listTrips, POST as createTrip } from "@/app/api/admin/[tenantSlug]/native-trips/route";
import { POST as publishTrip } from "@/app/api/admin/[tenantSlug]/native-trips/[tripId]/publish/route";
import { POST as createTenant } from "@/app/api/admin/native-tenants/route";
import { handlePmsBookingCheckoutSessionCompleted } from "@/server/payments/confirm-bluepass-pms-payment";
import { decideNativeBooking } from "@/server/payments/native-booking-decision";
import { PrismaNativeStore } from "./prisma-native-store";
import { handleNativeOperatorWhatsApp } from "./native-operator-whatsapp";

// The whole operator journey end to end, against the real database and Stripe's TEST mode:
// onboard an operator, publish a trip through the admin API, have a traveller hold seats and pay a
// real test-mode charge, then accept, decline (by dashboard and by WhatsApp reply) and let one expire,
// checking the real Stripe refund each time. WhatsApp is faked, so nothing is sent. Runs only when
// BLUEPASS_STRIPE_SECRET_KEY is a test key. Everything it creates is deleted afterwards.
vi.mock("@/server/whatsapp/client", () => ({ sendWhatsAppText: vi.fn(async () => undefined) }));
import { sendWhatsAppText } from "@/server/whatsapp/client";

const stripeKey = (process.env.BLUEPASS_STRIPE_SECRET_KEY ?? "").replace(/"/g, "").trim();
const hasTestKey = stripeKey.startsWith("sk_test_");
const ZONE = "America/Barbados";
const ADMIN_TOKEN = `e2e-${randomUUID()}`;
const OPERATOR_ID = `e2e-operator-${randomUUID()}`;
const OTHER_OPERATOR_ID = `e2e-other-${randomUUID()}`;
const PHONE = `1997${Math.floor(1000000 + Math.random() * 8999999)}`;

let stripe: Stripe;
let slug = "";
let otherSlug = "";
let tenantId = "";
let tripId = "";
let conversationId = "";
let dayOffset = 20;
const previousToken = process.env.KAI_ADMIN_TOKEN;

const headers = () => ({ authorization: `Bearer ${ADMIN_TOKEN}`, "content-type": "application/json" });
const json = (body: unknown) => JSON.stringify(body);

async function api<T = Record<string, any>>(handler: (request: Request, context: any) => Promise<Response>, method: string, params: Record<string, string>, body?: unknown) {
  const response = await handler(new Request("http://kai.test/api", { method, headers: headers(), ...(body === undefined ? {} : { body: json(body) }) }), {
    params: Promise.resolve(params)
  });
  return { status: response.status, data: (await response.json()) as T };
}

beforeAll(async () => {
  if (!hasTestKey) return;
  process.env.KAI_ADMIN_TOKEN = ADMIN_TOKEN;
  process.env.BLUEPASS_STRIPE_SECRET_KEY = stripeKey;
  stripe = new Stripe(stripeKey);

  const tenant = await api(createTenant as never, "POST", {}, { externalOperatorId: OPERATOR_ID, name: "E2E Blue Water Tours", adminWhatsAppPhone: PHONE, goLive: true });
  expect(tenant.status).toBe(201);
  slug = tenant.data.tenant.slug;
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug }, select: { id: true } })).id;
  conversationId = (await prisma.conversation.create({ data: { tenantId, channel: "WEB_WIDGET" } })).id;

  const other = await api(createTenant as never, "POST", {}, { externalOperatorId: OTHER_OPERATOR_ID, name: "E2E Other Tours" });
  otherSlug = other.data.tenant.slug;
});

afterAll(async () => {
  if (previousToken === undefined) delete process.env.KAI_ADMIN_TOKEN;
  else process.env.KAI_ADMIN_TOKEN = previousToken;
  const tenants = await prisma.tenant.findMany({ where: { externalOperatorId: { in: [OPERATOR_ID, OTHER_OPERATOR_ID] } }, select: { id: true } });
  for (const { id } of tenants) {
    await prisma.pmsBookingLedgerEntry.deleteMany({ where: { tenantId: id } });
    await prisma.pmsBookingPaymentAttempt.deleteMany({ where: { tenantId: id } });
  }
  await prisma.tenant.deleteMany({ where: { id: { in: tenants.map((t) => t.id) } } });
});

/** A traveller holds seats through the booking engine, then pays a real Stripe test-mode charge. */
async function paidBooking(guests = 2) {
  dayOffset += 1;
  const date = addDaysIso(todayInZone(ZONE), dayOffset);
  const adapter = new NativePmsAdapter({ store: new PrismaNativeStore(slug) });
  const hold = await adapter.createBooking({ productId: tripId, date: `${date} 09:00:00`, guests, travellerName: "Ana Reyes", travellerEmail: "ana@example.com" });
  expect(hold.status).toBe("PENDING");

  const amount = 9500 * guests;
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: "usd",
    payment_method: "pm_card_visa",
    confirm: true,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },
    metadata: { kaiE2e: "true" }
  });
  expect(paymentIntent.status).toBe("succeeded");

  const sessionId = `cs_test_${randomUUID()}`;
  const attempt = await prisma.pmsBookingPaymentAttempt.create({
    data: {
      tenantId,
      conversationId,
      pmsProvider: "NATIVE",
      productExternalId: tripId,
      productTitle: "E2E Sunset Catamaran",
      dateText: `${date} 09:00:00`,
      guests,
      travellerName: "Ana Reyes",
      travellerEmail: "ana@example.com",
      grossAmountCents: amount,
      currency: "USD",
      externalBookingId: hold.externalBookingId,
      stripeCheckoutSessionId: sessionId
    }
  });
  await handlePmsBookingCheckoutSessionCompleted({ id: sessionId, payment_intent: paymentIntent.id } as Stripe.Checkout.Session);
  return { attemptId: attempt.id, bookingId: hold.externalBookingId, paymentIntentId: paymentIntent.id, amount };
}

const attemptOf = (id: string) => prisma.pmsBookingPaymentAttempt.findUniqueOrThrow({ where: { id } });
const bookingOf = (id: string) => prisma.nativeBooking.findUniqueOrThrow({ where: { id } });

async function expectRealRefund(attemptId: string, paymentIntentId: string, amount: number) {
  const attempt = await attemptOf(attemptId);
  expect(attempt.status).toBe("CONFIRM_FAILED_REFUNDED");
  expect(attempt.stripeRefundId).toMatch(/^re_/);
  const refund = await stripe.refunds.retrieve(attempt.stripeRefundId as string);
  expect(refund.status).toMatch(/succeeded|pending/);
  expect(refund.amount).toBe(amount);
  expect(refund.payment_intent).toBe(paymentIntentId);
}

describe.skipIf(!hasTestKey)("native operator journey, end to end on Stripe test mode", () => {
  it("onboards the operator, publishes a trip through the admin API, and lists it", async () => {
    const draft = await api(createTrip as never, "POST", { tenantSlug: slug }, {
      title: "E2E Sunset Catamaran",
      description: "Two hours on the west coast.",
      durationMinutes: 120,
      meetingPoint: "The Careenage",
      photoUrls: ["https://example.com/a.jpg"],
      currency: "USD",
      timeZone: ZONE,
      tickets: [{ label: "Adult", priceCents: 9500 }],
      schedules: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], localTime: "09:00", seats: 4 }]
    });
    expect(draft.status).toBe(201);
    expect(draft.data.trip.status).toBe("DRAFT");
    tripId = draft.data.trip.id;

    const published = await api(publishTrip as never, "POST", { tenantSlug: slug, tripId }, { published: true });
    expect(published.data.trip.status).toBe("PUBLISHED");

    const listed = await api(listTrips as never, "GET", { tenantSlug: slug });
    expect(listed.data.trips.map((trip: { id: string }) => trip.id)).toEqual([tripId]);

    // Going live is what makes the operator visible to travellers' chat.
    const features = (await prisma.tenantConfig.findUniqueOrThrow({ where: { tenantId } })).enabledFeatures;
    expect(features).toContain("bluepass_stripe_pms_checkout");
  }, 180_000);

  it("a paid booking shows up waiting; accepting it confirms it and splits the money once, with no refund", async () => {
    vi.mocked(sendWhatsAppText).mockClear();
    const paid = await paidBooking(2);

    const pending = await api(listBookings as never, "GET", { tenantSlug: slug });
    const waiting = pending.data.bookings.find((booking: { id: string }) => booking.id === paid.bookingId);
    expect(waiting).toMatchObject({ status: "WAITING_OPERATOR", paymentAttemptId: paid.attemptId, seats: 2, totalCents: paid.amount, currency: "USD" });
    expect(vi.mocked(sendWhatsAppText)).toHaveBeenCalledTimes(1);

    const accepted = await api(decide as never, "POST", { tenantSlug: slug, attemptId: paid.attemptId }, { decision: "ACCEPT" });
    expect(accepted.data.outcome).toBe("CONFIRMED");
    expect((await bookingOf(paid.bookingId)).status).toBe("CONFIRMED");
    expect(await prisma.pmsBookingLedgerEntry.count({ where: { pmsBookingPaymentAttemptId: paid.attemptId } })).toBeGreaterThan(0);

    const charge = await stripe.paymentIntents.retrieve(paid.paymentIntentId, { expand: ["latest_charge"] });
    expect((charge.latest_charge as Stripe.Charge).amount_refunded).toBe(0);

    // A second click is a no-op, not an error and not a second ledger split.
    const ledgerBefore = await prisma.pmsBookingLedgerEntry.count({ where: { pmsBookingPaymentAttemptId: paid.attemptId } });
    const again = await api(decide as never, "POST", { tenantSlug: slug, attemptId: paid.attemptId }, { decision: "ACCEPT" });
    expect(again.status).toBe(409);
    expect(again.data.outcome).toBe("NOT_WAITING");
    expect(await prisma.pmsBookingLedgerEntry.count({ where: { pmsBookingPaymentAttemptId: paid.attemptId } })).toBe(ledgerBefore);
  }, 240_000);

  it("declining from the dashboard refunds the real charge in full and frees the seats", async () => {
    const paid = await paidBooking(3);
    const declined = await api(decide as never, "POST", { tenantSlug: slug, attemptId: paid.attemptId }, { decision: "DECLINE", note: "Boat in maintenance" });
    expect(declined.data.outcome).toBe("REFUNDED");

    expect(await bookingOf(paid.bookingId)).toMatchObject({ status: "DECLINED", decisionNote: "Boat in maintenance" });
    await expectRealRefund(paid.attemptId, paid.paymentIntentId, paid.amount);
    expect(await prisma.pmsBookingLedgerEntry.count({ where: { pmsBookingPaymentAttemptId: paid.attemptId } })).toBe(0);
  }, 240_000);

  it("declining by WhatsApp reply refunds the real charge too", async () => {
    const paid = await paidBooking(1);
    vi.mocked(sendWhatsAppText).mockClear();

    const answer = await handleNativeOperatorWhatsApp({ from: PHONE, body: `decline ${paid.bookingId}` });
    expect(answer.handled).toBe(true);
    expect((await bookingOf(paid.bookingId)).status).toBe("DECLINED");
    await expectRealRefund(paid.attemptId, paid.paymentIntentId, paid.amount);
    const texts = (vi.mocked(sendWhatsAppText).mock.calls as unknown as [{ body: string }][]).map(([message]) => message.body);
    expect(texts.some((text) => text.includes("refunded in full"))).toBe(true);
  }, 240_000);

  it("a booking nobody answers in 24 hours is refunded on its own", async () => {
    const paid = await paidBooking(2);
    await prisma.nativeBooking.update({ where: { id: paid.bookingId }, data: { operatorDeadlineAt: new Date(Date.now() - 60_000) } });

    const result = await decideNativeBooking({ attemptId: paid.attemptId, decision: "EXPIRE" });
    expect(result.outcome).toBe("REFUNDED");
    expect((await bookingOf(paid.bookingId)).status).toBe("EXPIRED");
    await expectRealRefund(paid.attemptId, paid.paymentIntentId, paid.amount);
  }, 240_000);

  it("another operator cannot see or decide this operator's booking", async () => {
    const paid = await paidBooking(1);

    const theirList = await api(listBookings as never, "GET", { tenantSlug: otherSlug });
    expect(theirList.data.bookings).toEqual([]);
    const theirDecision = await api(decide as never, "POST", { tenantSlug: otherSlug, attemptId: paid.attemptId }, { decision: "DECLINE" });
    expect(theirDecision.status).toBe(404);
    expect((await bookingOf(paid.bookingId)).status).toBe("WAITING_OPERATOR");

    // Clean up the real charge this left behind.
    await decideNativeBooking({ attemptId: paid.attemptId, decision: "DECLINE" });
    await expectRealRefund(paid.attemptId, paid.paymentIntentId, paid.amount);
  }, 240_000);
});
