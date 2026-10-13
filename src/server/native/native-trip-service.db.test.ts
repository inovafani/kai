import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createNativeTrip,
  deleteNativeTrip,
  getNativeTrip,
  listNativeBookings,
  listNativeTrips,
  NativeTripError,
  setNativeTripPublished,
  updateNativeTrip
} from "./native-trip-service";

// The operator-facing trip rules against the real database. The tenants (and with them every trip,
// departure and booking) are deleted afterwards.
const NATIVE_SLUG = `trip-svc-${randomUUID()}`;
const OTHER_SLUG = `trip-svc-other-${randomUUID()}`;
const REZDY_SLUG = `trip-svc-rezdy-${randomUUID()}`;

async function makeTenant(slug: string, pmsProvider: "NATIVE" | "REZDY") {
  return prisma.tenant.create({
    data: {
      slug,
      name: slug,
      widgetPublicKey: `pk_test_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      config: {
        create: { supportedChannels: ["WEB_WIDGET"], enabledFeatures: [], requiredSlots: {}, bookingMode: "AUTO_BOOKING", pmsProvider, escalationRules: [], responseGuardrails: [] }
      }
    }
  });
}

const trip = {
  title: "Sunset catamaran",
  description: "Two hours on the west coast.",
  durationMinutes: 120,
  meetingPoint: "Careenage",
  photoUrls: ["https://example.com/a.jpg"],
  currency: "USD",
  timeZone: "America/Barbados",
  tickets: [
    { label: "Adult", priceCents: 9500 },
    { label: "Child", priceCents: 5000 }
  ],
  schedules: [{ daysOfWeek: [1, 3, 5], localTime: "16:00", seats: 12 }],
  blackouts: [{ fromDate: "2026-12-24", toDate: "2026-12-26", reason: "Christmas" }]
};

let nativeTenantId = "";

beforeAll(async () => {
  nativeTenantId = (await makeTenant(NATIVE_SLUG, "NATIVE")).id;
  await makeTenant(OTHER_SLUG, "NATIVE");
  await makeTenant(REZDY_SLUG, "REZDY");
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: [NATIVE_SLUG, OTHER_SLUG, REZDY_SLUG] } } });
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as NativeTripError;
  }
  throw new Error("expected a rejection");
}

describe("native trip service", () => {
  it("creates a draft with tickets, times and blocked dates, and reads it back", async () => {
    const created = await createNativeTrip(NATIVE_SLUG, trip);
    expect(created.status).toBe("DRAFT");
    expect(created.tickets.map((ticket) => ticket.label)).toEqual(["Adult", "Child"]);
    expect(created.lowestTicketCents).toBe(5000);
    expect(created.blackouts).toEqual([{ fromDate: "2026-12-24", toDate: "2026-12-26", reason: "Christmas" }]);

    const fetched = await getNativeTrip(NATIVE_SLUG, created.id);
    expect(fetched.title).toBe("Sunset catamaran");
    expect(await listNativeTrips(NATIVE_SLUG)).toHaveLength(1);
  });

  it("refuses a tenant that is not on the native system, or does not exist", async () => {
    expect((await rejection(listNativeTrips(REZDY_SLUG))).code).toBe("NOT_NATIVE");
    expect((await rejection(createNativeTrip("no-such-tenant", trip))).code).toBe("TENANT_NOT_FOUND");
  });

  it("returns every problem with a bad trip, and creates nothing", async () => {
    const before = (await listNativeTrips(NATIVE_SLUG)).length;
    const error = await rejection(createNativeTrip(NATIVE_SLUG, { ...trip, currency: "BBD", tickets: [{ label: "", priceCents: -5 }] }));
    expect(error.code).toBe("INVALID_TRIP");
    expect(error.status).toBe(400);
    expect(error.issues.length).toBeGreaterThan(1);
    expect((await listNativeTrips(NATIVE_SLUG)).length).toBe(before);
  });

  it("never lets one operator read or change another operator's trip", async () => {
    const [mine] = await listNativeTrips(NATIVE_SLUG);
    expect((await rejection(getNativeTrip(OTHER_SLUG, mine.id))).code).toBe("TRIP_NOT_FOUND");
    expect((await rejection(updateNativeTrip(OTHER_SLUG, mine.id, trip))).code).toBe("TRIP_NOT_FOUND");
    expect((await rejection(setNativeTripPublished(OTHER_SLUG, mine.id, true))).code).toBe("TRIP_NOT_FOUND");
    expect((await rejection(deleteNativeTrip(OTHER_SLUG, mine.id))).code).toBe("TRIP_NOT_FOUND");
  });

  it("replaces tickets, times and blocked dates on update", async () => {
    const [mine] = await listNativeTrips(NATIVE_SLUG);
    const updated = await updateNativeTrip(NATIVE_SLUG, mine.id, {
      ...trip,
      title: "Sunset catamaran (new)",
      tickets: [{ label: "Adult", priceCents: 10000 }, { label: "Snorkel set", priceCents: 1500, kind: "EXTRA" }],
      schedules: [{ daysOfWeek: [0], localTime: "10:00", seats: 8 }],
      blackouts: []
    });
    expect(updated.title).toBe("Sunset catamaran (new)");
    expect(updated.tickets.map((ticket) => `${ticket.kind}:${ticket.label}`).sort()).toEqual(["EXTRA:Snorkel set", "TICKET:Adult"]);
    expect(updated.schedules).toHaveLength(1);
    expect(updated.schedules[0].localTime).toBe("10:00");
    expect(updated.blackouts).toEqual([]);
  });

  it("publishes only a trip with a priced ticket and a time, and unpublishes freely", async () => {
    const empty = await createNativeTrip(NATIVE_SLUG, { ...trip, title: "Empty trip", tickets: [], schedules: [] });
    const refused = await rejection(setNativeTripPublished(NATIVE_SLUG, empty.id, true));
    expect(refused.code).toBe("CANNOT_PUBLISH");
    expect(refused.issues).toHaveLength(2);
    expect((await getNativeTrip(NATIVE_SLUG, empty.id)).status).toBe("DRAFT");

    const [mine] = await listNativeTrips(NATIVE_SLUG);
    expect((await setNativeTripPublished(NATIVE_SLUG, mine.id, true)).status).toBe("PUBLISHED");
    expect((await setNativeTripPublished(NATIVE_SLUG, mine.id, false)).status).toBe("DRAFT");
  });

  it("does not let an edit strip a published trip of everything it sells", async () => {
    const [mine] = await listNativeTrips(NATIVE_SLUG);
    await setNativeTripPublished(NATIVE_SLUG, mine.id, true);
    const error = await rejection(updateNativeTrip(NATIVE_SLUG, mine.id, { ...trip, tickets: [] }));
    expect(error.code).toBe("CANNOT_PUBLISH");
    expect((await getNativeTrip(NATIVE_SLUG, mine.id)).tickets.length).toBeGreaterThan(0);
  });

  it("deletes a trip nobody booked, but keeps one with bookings", async () => {
    const unbooked = await createNativeTrip(NATIVE_SLUG, { ...trip, title: "Unbooked" });
    await deleteNativeTrip(NATIVE_SLUG, unbooked.id);
    expect((await rejection(getNativeTrip(NATIVE_SLUG, unbooked.id))).code).toBe("TRIP_NOT_FOUND");

    const booked = await createNativeTrip(NATIVE_SLUG, { ...trip, title: "Booked" });
    const departure = await prisma.nativeDeparture.create({
      data: { tenantId: nativeTenantId, tripId: booked.id, localDate: "2026-11-02", localTime: "16:00", startsAt: new Date("2026-11-02T20:00:00Z"), seats: 12 }
    });
    await prisma.nativeBooking.create({
      data: {
        tenantId: nativeTenantId,
        departureId: departure.id,
        seats: 2,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
        travellerName: "Sam",
        travellerEmail: "sam@example.com",
        totalCents: 19000,
        currency: "USD",
        status: "WAITING_OPERATOR",
        holdExpiresAt: new Date("2026-11-01T00:00:00Z"),
        operatorDeadlineAt: new Date("2026-11-02T00:00:00Z")
      }
    });
    const error = await rejection(deleteNativeTrip(NATIVE_SLUG, booked.id));
    expect(error.code).toBe("HAS_BOOKINGS");
    expect((await getNativeTrip(NATIVE_SLUG, booked.id)).title).toBe("Booked");
  });

  it("lists paid bookings, leaves out unpaid holds, and filters to pending", async () => {
    const booked = (await listNativeTrips(NATIVE_SLUG)).find((item) => item.title === "Booked")!;
    const departure = await prisma.nativeDeparture.findFirstOrThrow({ where: { tripId: booked.id } });
    await prisma.nativeBooking.create({
      data: {
        tenantId: nativeTenantId,
        departureId: departure.id,
        seats: 1,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 1 }],
        travellerName: "Abandoned",
        travellerEmail: "a@example.com",
        totalCents: 9500,
        currency: "USD",
        status: "HELD",
        holdExpiresAt: new Date("2026-11-01T00:00:00Z")
      }
    });
    await prisma.nativeBooking.create({
      data: {
        tenantId: nativeTenantId,
        departureId: departure.id,
        seats: 1,
        ticketQuantities: [{ optionLabel: "Adult", quantity: 1 }],
        travellerName: "Done",
        travellerEmail: "d@example.com",
        totalCents: 9500,
        currency: "USD",
        status: "CONFIRMED",
        holdExpiresAt: new Date("2026-11-01T00:00:00Z")
      }
    });

    const all = await listNativeBookings(NATIVE_SLUG);
    expect(all.map((booking) => booking.travellerName).sort()).toEqual(["Done", "Sam"]);
    expect(all.find((booking) => booking.travellerName === "Sam")).toMatchObject({
      tripTitle: "Booked",
      localDate: "2026-11-02",
      tickets: [{ optionLabel: "Adult", quantity: 2 }]
    });

    const pending = await listNativeBookings(NATIVE_SLUG, { scope: "pending" });
    expect(pending.map((booking) => booking.travellerName)).toEqual(["Sam"]);
    expect(await listNativeBookings(OTHER_SLUG)).toEqual([]);
  });
});
