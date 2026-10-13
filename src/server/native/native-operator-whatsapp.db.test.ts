import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { handleNativeOperatorWhatsApp, parseNativeOperatorAnswer } from "./native-operator-whatsapp";

// An operator answering paid native bookings from WhatsApp, against the real database with the
// decision and the reply faked, so nothing is refunded or sent. The tenants are deleted afterwards.
const SLUG = `wa-native-${randomUUID()}`;
const OTHER_SLUG = `wa-native-other-${randomUUID()}`;
// Phone numbers unique to this run, so a real operator's number can never match.
const PHONE = `1999${Math.floor(1000000 + Math.random() * 8999999)}`;
const OTHER_PHONE = `1998${Math.floor(1000000 + Math.random() * 8999999)}`;

let tenantId = "";
let otherTenantId = "";
let departureId = "";
const waitingIds: string[] = [];

async function makeTenant(slug: string, phone: string) {
  return prisma.tenant.create({
    data: {
      slug,
      name: slug,
      widgetPublicKey: `pk_test_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      config: {
        create: {
          supportedChannels: ["WEB_WIDGET"],
          enabledFeatures: [],
          requiredSlots: {},
          bookingMode: "AUTO_BOOKING",
          pmsProvider: "NATIVE",
          escalationRules: [],
          responseGuardrails: [],
          adminWhatsAppPhone: phone
        }
      }
    }
  });
}

async function booking(status: "WAITING_OPERATOR" | "CONFIRMED", name: string) {
  const row = await prisma.nativeBooking.create({
    data: {
      tenantId,
      departureId,
      seats: 2,
      ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
      travellerName: name,
      travellerEmail: `${name.toLowerCase()}@example.com`,
      totalCents: 19000,
      currency: "USD",
      status,
      holdExpiresAt: new Date("2026-11-01T00:00:00Z"),
      operatorDeadlineAt: new Date("2026-11-02T00:00:00Z"),
      paymentAttemptId: `attempt_${randomUUID()}`
    }
  });
  if (status === "WAITING_OPERATOR") waitingIds.push(row.id);
  return row;
}

beforeAll(async () => {
  tenantId = (await makeTenant(SLUG, PHONE)).id;
  otherTenantId = (await makeTenant(OTHER_SLUG, OTHER_PHONE)).id;
  const trip = await prisma.nativeTrip.create({
    data: { tenantId, title: "Sunset catamaran", durationMinutes: 120, currency: "USD", timeZone: "America/Barbados", status: "PUBLISHED" }
  });
  departureId = (
    await prisma.nativeDeparture.create({
      data: { tenantId, tripId: trip.id, localDate: "2026-11-02", localTime: "16:00", startsAt: new Date("2026-11-02T20:00:00Z"), seats: 12 }
    })
  ).id;
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherTenantId].filter(Boolean) } } });
});

function deps() {
  return {
    decide: vi.fn(async (input: { attemptId: string; decision: "ACCEPT" | "DECLINE"; tenantSlug: string }) => ({
      outcome: input.decision === "ACCEPT" ? ("CONFIRMED" as const) : ("REFUNDED" as const),
      attemptId: input.attemptId
    })),
    reply: vi.fn(async (_to: string, _body: string) => undefined as unknown)
  };
}

describe("parseNativeOperatorAnswer", () => {
  it("reads a bare answer, with or without the reference", () => {
    expect(parseNativeOperatorAnswer("ACCEPT")).toEqual({ decision: "ACCEPT", reference: null });
    expect(parseNativeOperatorAnswer(" decline. ")).toEqual({ decision: "DECLINE", reference: null });
    expect(parseNativeOperatorAnswer("Accept cmv65u05n0004fsg5e5bl130m")).toEqual({ decision: "ACCEPT", reference: "cmv65u05n0004fsg5e5bl130m" });
    expect(parseNativeOperatorAnswer("decline: cmv65u05n0004fsg5e5bl130m")).toEqual({ decision: "DECLINE", reference: "cmv65u05n0004fsg5e5bl130m" });
  });

  it("ignores anything that is not just an answer", () => {
    for (const text of ["accept the counter offer please", "we can accept 4 people", "hello", "decline payment ready", "yes", ""]) {
      expect(parseNativeOperatorAnswer(text)).toBeNull();
    }
  });
});

describe("handleNativeOperatorWhatsApp", () => {
  it("leaves a message alone when nothing is waiting on that phone", async () => {
    const d = deps();
    expect(await handleNativeOperatorWhatsApp({ from: PHONE, body: "accept" }, d)).toEqual({ handled: false });
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.reply).not.toHaveBeenCalled();
  });

  it("leaves a message from an unknown phone alone", async () => {
    await booking("WAITING_OPERATOR", "Sam");
    const d = deps();
    expect(await handleNativeOperatorWhatsApp({ from: "19990000000", body: "accept" }, d)).toEqual({ handled: false });
    expect(d.decide).not.toHaveBeenCalled();
  });

  it("answers the only waiting booking when the operator sends a bare accept", async () => {
    const d = deps();
    expect(await handleNativeOperatorWhatsApp({ from: PHONE, body: "Accept" }, d)).toEqual({ handled: true });
    expect(d.decide).toHaveBeenCalledOnce();
    expect(d.decide.mock.calls[0][0]).toMatchObject({ decision: "ACCEPT", tenantSlug: SLUG });
    expect(d.reply.mock.calls[0]).toEqual([PHONE, expect.stringContaining("Accepted: Sunset catamaran")]);
  });

  it("will not guess between two waiting bookings, and lists them", async () => {
    // Both rows stay WAITING: the fake decision above never changed the database.
    await booking("WAITING_OPERATOR", "Alex");
    const d = deps();
    expect(await handleNativeOperatorWhatsApp({ from: PHONE, body: "decline" }, d)).toEqual({ handled: true });
    expect(d.decide).not.toHaveBeenCalled();
    const [, text] = d.reply.mock.calls[0] as unknown as [string, string];
    for (const id of waitingIds) expect(text).toContain(id);
  });

  it("answers the booking named by the reference", async () => {
    const d = deps();
    const target = waitingIds[1];
    expect(await handleNativeOperatorWhatsApp({ from: PHONE, body: `decline ${target}` }, d)).toEqual({ handled: true });
    const attempt = (await prisma.nativeBooking.findUniqueOrThrow({ where: { id: target } })).paymentAttemptId;
    expect(d.decide).toHaveBeenCalledWith({ attemptId: attempt, decision: "DECLINE", tenantSlug: SLUG });
    expect(d.reply.mock.calls[0][1]).toContain("refunded in full");
  });

  it("says a settled booking is already answered, and one that is not theirs is left alone", async () => {
    const done = await booking("CONFIRMED", "Done");
    const d = deps();
    expect(await handleNativeOperatorWhatsApp({ from: PHONE, body: `accept ${done.id}` }, d)).toEqual({ handled: true });
    expect(d.decide).not.toHaveBeenCalled();
    expect(d.reply.mock.calls[0][1]).toContain("already answered");

    // The other operator's phone cannot answer, or even recognise, this tenant's booking.
    const d2 = deps();
    expect(await handleNativeOperatorWhatsApp({ from: OTHER_PHONE, body: `accept ${waitingIds[0]}` }, d2)).toEqual({ handled: false });
    expect(d2.decide).not.toHaveBeenCalled();
  });
});
