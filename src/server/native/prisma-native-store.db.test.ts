import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NativePmsAdapter } from "@/core/pms/native-pms-adapter";
import { addDaysIso, todayInZone } from "@/core/native/native-time";
import { prisma } from "@/lib/prisma";
import { PrismaNativeStore } from "./prisma-native-store";

// Needs the native-booking migration applied. These talk to the real database, because the seat
// guarantees (no oversell under concurrency, holds that free themselves) can only be proven there.
// Tenants carry a UUID-suffixed slug, which the admin overview treats as a test fixture, and they
// are deleted afterwards (cascade removes trips, departures and bookings).
const run = randomUUID();
const slugA = `native-store-a-${run}`;
const slugB = `native-store-b-${run}`;
const ZONE = "America/Barbados";
const SEATS = 5;
const RACERS = 8;

let tripId = "";
let otherTripId = "";
let date = "";
const storeA = new PrismaNativeStore(slugA);
const storeB = new PrismaNativeStore(slugB);
const now = () => new Date();

async function makeTenantWithTrip(slug: string) {
  const tenant = await prisma.tenant.create({
    data: { slug, name: slug, widgetPublicKey: `pk_test_${randomUUID()}`, allowedOrigins: ["https://bluepass.co"] }
  });
  const trip = await prisma.nativeTrip.create({
    data: {
      tenantId: tenant.id,
      title: "Test Sail",
      durationMinutes: 120,
      currency: "BBD",
      timeZone: ZONE,
      status: "PUBLISHED",
      ticketTypes: { create: [{ label: "Adult", priceCents: 10000 }, { label: "Lunch", priceCents: 2000, kind: "EXTRA" }] },
      schedules: { create: [{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], localTime: "09:00", seats: SEATS }] }
    }
  });
  return trip.id;
}

beforeAll(async () => {
  tripId = await makeTenantWithTrip(slugA);
  otherTripId = await makeTenantWithTrip(slugB);
  date = addDaysIso(todayInZone(ZONE), 3);
});

afterAll(async () => {
  await prisma.tenant.deleteMany({ where: { slug: { in: [slugA, slugB] } } });
});

const traveller = { travellerName: "Test Traveller", travellerEmail: "test@example.com" };

describe("PrismaNativeStore", () => {
  it("creates the departures a schedule calls for, once, however often a date is asked about", async () => {
    const first = await storeA.departuresForDates(tripId, [date], now());
    const again = await storeA.departuresForDates(tripId, [date], now());
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ localDate: date, localTime: "09:00", seatsLeft: SEATS });
    expect(again[0].id).toBe(first[0].id);
    expect(await prisma.nativeDeparture.count({ where: { tripId, localDate: date } })).toBe(1);
  });

  it("sells exactly as many seats as exist when many travellers race for them", async () => {
    const adapter = new NativePmsAdapter({ store: storeA });
    const raceDate = addDaysIso(date, 1);
    const results = await Promise.all(
      Array.from({ length: RACERS }, () => adapter.createBooking({ productId: tripId, date: `${raceDate} 09:00:00`, guests: 1, ...traveller }))
    );

    expect(results.filter((result) => result.status === "PENDING")).toHaveLength(SEATS);
    expect(results.filter((result) => result.status === "FAILED")).toHaveLength(RACERS - SEATS);
    const [departure] = await storeA.departuresForDates(tripId, [raceDate], now());
    expect(departure.seatsLeft).toBe(0);
  }, 120_000);

  it("frees an abandoned hold's seats on its own once the hold expires", async () => {
    const holdDate = addDaysIso(date, 2);
    const [departure] = await storeA.departuresForDates(tripId, [holdDate], now());

    const held = await storeA.holdSeats({
      departureId: departure.id,
      seats: SEATS,
      ticketQuantities: [{ optionLabel: "Adult", quantity: SEATS }],
      extraQuantities: [],
      ...traveller,
      travellerPhone: null,
      totalCents: 50000,
      currency: "BBD",
      holdExpiresAt: new Date(Date.now() - 1000),
      now: new Date(Date.now() - 60_000)
    });
    expect(held.ok).toBe(true);

    const [after] = await storeA.departuresForDates(tripId, [holdDate], now());
    expect(after.seatsLeft).toBe(SEATS);
  });

  it("keeps a paid booking's seats while it waits for the operator, and releases them on cancel", async () => {
    const adapter = new NativePmsAdapter({ store: storeA });
    const waitDate = addDaysIso(date, 4);
    const { externalBookingId } = await adapter.createBooking({ productId: tripId, date: `${waitDate} 09:00:00`, guests: 2, ...traveller });
    expect((await adapter.confirmBooking(externalBookingId)).status).toBe("PENDING");
    expect((await adapter.confirmBooking(externalBookingId)).status).toBe("PENDING");

    const [waiting] = await storeA.departuresForDates(tripId, [waitDate], now());
    expect(waiting.seatsLeft).toBe(SEATS - 2);

    expect(await adapter.cancelBooking(externalBookingId)).toEqual({ cancelled: true });
    const [released] = await storeA.departuresForDates(tripId, [waitDate], now());
    expect(released.seatsLeft).toBe(SEATS);
  });

  it("leaves out blacked-out dates", async () => {
    const blockedDate = addDaysIso(date, 5);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: slugA } });
    await prisma.nativeBlackout.create({ data: { tenantId: tenant.id, tripId, fromDate: blockedDate, toDate: blockedDate, reason: "Maintenance" } });

    expect(await storeA.departuresForDates(tripId, [blockedDate], now())).toEqual([]);
  });

  it("keeps one operator out of another's trips and bookings", async () => {
    expect(await storeB.getPublishedTrip(tripId)).toBeNull();
    expect(await storeB.listPublishedTrips()).toHaveLength(1);
    expect(await storeB.departuresForDates(tripId, [date], now())).toEqual([]);

    const adapterA = new NativePmsAdapter({ store: storeA });
    const isolationDate = addDaysIso(date, 6);
    const { externalBookingId } = await adapterA.createBooking({ productId: tripId, date: `${isolationDate} 09:00:00`, guests: 1, ...traveller });

    expect(await storeB.getBooking(externalBookingId)).toBeNull();
    expect(await storeB.cancelBooking(externalBookingId)).toBe(false);
    expect((await new NativePmsAdapter({ store: storeB }).createBooking({ productId: tripId, date: `${isolationDate} 09:00:00`, guests: 1, ...traveller })).status).toBe("FAILED");
    expect(otherTripId).not.toBe(tripId);
  });
});
