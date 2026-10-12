import { describe, expect, it } from "vitest";
import { plannedDeparturesForDate } from "@/core/native/native-schedule";
import { claimsSeats, seatsLeft, type NativeBookingStatusValue } from "@/core/native/native-seats";
import type {
  ConfirmHoldResult,
  HoldSeatsInput,
  HoldSeatsResult,
  NativeBookingRecord,
  NativeDepartureView,
  NativeStore,
  NativeTripRecord
} from "@/core/native/native-store";
import { localToUtc } from "@/core/native/native-time";
import { NativePmsAdapter } from "./native-pms-adapter";

const NOW = new Date("2026-10-08T12:00:00Z");

const trip: NativeTripRecord = {
  id: "trip-snorkel",
  title: "Reef Snorkel",
  description: "Two hours on the reef.",
  currency: "BBD",
  timeZone: "America/Barbados",
  bookingMode: "AUTO_BOOKING",
  ticketTypes: [
    { label: "Adult", priceCents: 12000, kind: "TICKET", sortOrder: 0 },
    { label: "Child", priceCents: 6000, kind: "TICKET", sortOrder: 1 },
    { label: "Lunch box", priceCents: 2500, kind: "EXTRA", sortOrder: 0 }
  ]
};

/** A faithful in-memory store: same seat rules as the database one, minus the row lock (JS is single-threaded here). */
class MemoryStore implements NativeStore {
  bookings: (NativeBookingRecord & { status: NativeBookingStatusValue })[] = [];
  private counter = 0;
  constructor(
    private readonly seatsPerDeparture: number,
    private readonly times: string[] = ["09:00"],
    private readonly days = [0, 1, 2, 3, 4, 5, 6]
  ) {}

  async listPublishedTrips() {
    return [trip];
  }
  async getPublishedTrip(tripId: string) {
    return tripId === trip.id ? trip : null;
  }
  private departureId(date: string, time: string) {
    return `${date}@${time}`;
  }
  async departuresForDates(tripId: string, dates: string[], now: Date): Promise<NativeDepartureView[]> {
    if (tripId !== trip.id) return [];
    return dates.flatMap((date) =>
      plannedDeparturesForDate(
        this.times.map((localTime) => ({ daysOfWeek: this.days, localTime, seats: this.seatsPerDeparture, validFrom: null, validUntil: null, active: true })),
        date
      ).map((planned) => {
        const id = this.departureId(date, planned.localTime);
        return {
          id,
          localDate: date,
          localTime: planned.localTime,
          startsAt: localToUtc(date, planned.localTime, trip.timeZone),
          seatsLeft: seatsLeft(planned.seats, this.bookings.filter((booking) => booking.departureId === id), now)
        };
      })
    );
  }
  async holdSeats(input: HoldSeatsInput): Promise<HoldSeatsResult> {
    const left = seatsLeft(this.seatsPerDeparture, this.bookings.filter((booking) => booking.departureId === input.departureId), input.now);
    if (left < input.seats) return { ok: false, reason: "NO_SEATS" };
    const booking = {
      id: `nb-${(this.counter += 1)}`,
      departureId: input.departureId,
      status: "HELD" as const,
      seats: input.seats,
      totalCents: input.totalCents,
      currency: input.currency,
      holdExpiresAt: input.holdExpiresAt,
      operatorDeadlineAt: null
    };
    this.bookings.push(booking);
    return { ok: true, booking };
  }
  async moveHoldToWaitingForOperator(bookingId: string, now: Date): Promise<ConfirmHoldResult> {
    const booking = this.bookings.find((item) => item.id === bookingId);
    if (!booking) return { ok: false, reason: "NOT_FOUND" };
    if (booking.status === "HELD" && booking.holdExpiresAt.getTime() <= now.getTime()) {
      const others = this.bookings.filter((item) => item.departureId === booking.departureId && item.id !== booking.id);
      if (seatsLeft(this.seatsPerDeparture, others, now) < booking.seats) return { ok: false, reason: "NO_SEATS" };
    }
    if (booking.status === "HELD") booking.status = "WAITING_OPERATOR";
    return { ok: true, booking };
  }
  async cancelBooking(bookingId: string) {
    const booking = this.bookings.find((item) => item.id === bookingId);
    if (!booking) return false;
    booking.status = "CANCELLED";
    return true;
  }
  async getBooking(bookingId: string) {
    return this.bookings.find((item) => item.id === bookingId) ?? null;
  }
  live() {
    return this.bookings.filter((booking) => claimsSeats(booking, NOW));
  }
}

const traveller = { travellerName: "Ana Reyes", travellerEmail: "ana@example.com" };

function adapterFor(store: NativeStore, now = NOW) {
  return new NativePmsAdapter({ store, now: () => now });
}

describe("NativePmsAdapter", () => {
  it("lists the operator's published trips as products", async () => {
    const products = await adapterFor(new MemoryStore(10)).listProducts();
    expect(products).toEqual([{ externalProductId: "trip-snorkel", title: "Reef Snorkel", description: "Two hours on the reef.", bookingMode: "AUTO_BOOKING" }]);
  });

  it("shows time options with seats left, tickets and extras", async () => {
    const result = await adapterFor(new MemoryStore(10, ["09:00", "14:00"])).getAvailability({ productId: trip.id, date: "2026-10-14", guests: 2 });
    expect(result.available).toBe(true);
    expect(result.currency).toBe("BBD");
    expect(result.unitPriceCents).toBe(12000);
    expect(result.timeOptions?.map((option) => [option.label, option.startTimeLocal, option.remaining])).toEqual([
      ["9:00 AM", "2026-10-14 09:00:00", 10],
      ["2:00 PM", "2026-10-14 14:00:00", 10]
    ]);
    expect(result.ticketOptions).toEqual([
      { label: "Adult", unitPriceCents: 12000, currency: "BBD" },
      { label: "Child", unitPriceCents: 6000, currency: "BBD" }
    ]);
    expect(result.extraOptions).toEqual([{ label: "Lunch box", unitPriceCents: 2500, currency: "BBD" }]);
  });

  it("hides sailings that cannot seat the group but still says how many seats are left", async () => {
    const store = new MemoryStore(4);
    const adapter = adapterFor(store);
    const held = await adapter.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 3, ...traveller });
    expect(held.status).toBe("PENDING");

    const result = await adapter.getAvailability({ productId: trip.id, date: "2026-10-14", guests: 2 });
    expect(result.available).toBe(false);
    expect(result.remaining).toBe(1);
    expect(result.timeOptions).toEqual([]);
  });

  it("does not offer a sailing that has already left", async () => {
    // 09:00 in Barbados on the 8th is 13:00Z, so at 14:00Z it is gone.
    const result = await adapterFor(new MemoryStore(10), new Date("2026-10-08T14:00:00Z")).getAvailability({
      productId: trip.id,
      date: "2026-10-08",
      guests: 1
    });
    expect(result.available).toBe(false);
  });

  it("reads 'tomorrow' in the trip's own zone", async () => {
    // 01:00Z on the 9th is still the 8th in Barbados, so tomorrow is the 9th there.
    const result = await adapterFor(new MemoryStore(10), new Date("2026-10-09T01:00:00Z")).getAvailability({
      productId: trip.id,
      date: "tomorrow",
      guests: 1
    });
    expect(result.timeOptions?.[0].startTimeLocal).toBe("2026-10-09 09:00:00");
  });

  it("holds seats, prices the booking and answers PENDING with the booking id", async () => {
    const store = new MemoryStore(10);
    const created = await adapterFor(store).createBooking({
      productId: trip.id,
      date: "2026-10-14 09:00:00",
      guests: 3,
      ...traveller,
      ticketQuantities: [
        { optionLabel: "adult", quantity: 2 },
        { optionLabel: "Child", quantity: 1 }
      ],
      extraQuantities: [{ optionLabel: "Lunch box", quantity: 2 }],
      confirmationMode: "PAYMENT_HOLD"
    });

    expect(created).toMatchObject({ provider: "NATIVE", status: "PENDING" });
    expect(created.externalBookingId).toBe("nb-1");
    expect(store.bookings[0]).toMatchObject({ seats: 3, totalCents: 2 * 12000 + 6000 + 2 * 2500, currency: "BBD" });
  });

  it("defaults to the first ticket type for everyone when no ticket breakdown is given", async () => {
    const store = new MemoryStore(10);
    await adapterFor(store).createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 2, ...traveller });
    expect(store.bookings[0].totalCents).toBe(24000);
  });

  it("books a day's only sailing when no time is given, and refuses to guess between several", async () => {
    const single = new MemoryStore(10);
    expect((await adapterFor(single).createBooking({ productId: trip.id, date: "2026-10-14", guests: 1, ...traveller })).status).toBe("PENDING");

    const several = new MemoryStore(10, ["09:00", "14:00"]);
    expect((await adapterFor(several).createBooking({ productId: trip.id, date: "2026-10-14", guests: 1, ...traveller })).status).toBe("FAILED");
  });

  it("fails on unknown tickets, a ticket count that is not the party size, and an unknown trip", async () => {
    const adapter = adapterFor(new MemoryStore(10));
    const common = { date: "2026-10-14 09:00:00", ...traveller };
    expect((await adapter.createBooking({ productId: trip.id, guests: 2, ...common, ticketQuantities: [{ optionLabel: "VIP", quantity: 2 }] })).status).toBe("FAILED");
    expect((await adapter.createBooking({ productId: trip.id, guests: 3, ...common, ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }] })).status).toBe("FAILED");
    expect((await adapter.createBooking({ productId: "nope", guests: 1, ...common })).status).toBe("FAILED");
  });

  it("never sells more seats than exist", async () => {
    const store = new MemoryStore(5);
    const adapter = adapterFor(store);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => adapter.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 1, ...traveller }))
    );
    expect(results.filter((result) => result.status === "PENDING")).toHaveLength(5);
    expect(results.filter((result) => result.status === "FAILED")).toHaveLength(7);
  });

  it("confirmBooking answers PENDING because only the operator can confirm a native booking", async () => {
    const store = new MemoryStore(10);
    const adapter = adapterFor(store);
    const { externalBookingId } = await adapter.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 2, ...traveller });

    const first = await adapter.confirmBooking(externalBookingId);
    expect(first.status).toBe("PENDING");
    expect(store.bookings[0].status).toBe("WAITING_OPERATOR");
    // A repeated payment event must not change the answer.
    expect((await adapter.confirmBooking(externalBookingId)).status).toBe("PENDING");
    expect((await adapter.confirmBooking("missing")).status).toBe("FAILED");
  });

  it("fails the confirm, so the payment is refunded, when the hold lapsed and the seats went to someone else", async () => {
    const store = new MemoryStore(2);
    const slow = adapterFor(store, new Date("2026-10-08T12:00:00Z"));
    const { externalBookingId } = await slow.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 2, ...traveller });

    // 45 minutes later the hold (30 minutes) has lapsed and another traveller takes the seats.
    const later = adapterFor(store, new Date("2026-10-08T12:45:00Z"));
    expect((await later.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 2, ...traveller })).status).toBe("PENDING");
    expect((await later.confirmBooking(externalBookingId)).status).toBe("FAILED");
  });

  it("releases the seats when a booking is cancelled", async () => {
    const store = new MemoryStore(2);
    const adapter = adapterFor(store);
    const { externalBookingId } = await adapter.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 2, ...traveller });
    expect((await adapter.getAvailability({ productId: trip.id, date: "2026-10-14", guests: 1 })).available).toBe(false);

    expect(await adapter.cancelBooking(externalBookingId)).toEqual({ cancelled: true });
    expect((await adapter.getAvailability({ productId: trip.id, date: "2026-10-14", guests: 2 })).available).toBe(true);
    expect(await adapter.cancelBooking("missing")).toEqual({ cancelled: false });
  });

  it("reports a booking's state in the shape other PMS adapters use", async () => {
    const store = new MemoryStore(10);
    const adapter = adapterFor(store);
    const { externalBookingId } = await adapter.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 1, ...traveller });
    expect((await adapter.getBooking(externalBookingId))?.status).toBe("PENDING");
    await adapter.cancelBooking(externalBookingId);
    expect((await adapter.getBooking(externalBookingId))?.status).toBe("FAILED");
    expect(await adapter.getBooking("missing")).toBeNull();
  });

  it("finds every date in the window that still seats the group", async () => {
    const store = new MemoryStore(4, ["09:00"], [1, 3]); // Mondays and Wednesdays
    const adapter = adapterFor(store);
    await adapter.createBooking({ productId: trip.id, date: "2026-10-14 09:00:00", guests: 4, ...traveller }); // fills Wed 14th

    const found = await adapter.findAvailableDates({ productId: trip.id, guests: 2, fromDate: "2026-10-12", daysToSearch: 10 });
    expect(found.dates).toEqual(["2026-10-12", "2026-10-19", "2026-10-21"]);
  });
});
