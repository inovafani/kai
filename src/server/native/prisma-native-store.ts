import { Prisma } from "@prisma/client";
import { plannedDeparturesForDate, isBlackedOut } from "@/core/native/native-schedule";
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
import { operatorDeadlineFrom } from "@/core/native/native-decision";
import { localToUtc } from "@/core/native/native-time";
import { prisma } from "@/lib/prisma";

const LIVE_STATUSES: NativeBookingStatusValue[] = ["HELD", "WAITING_OPERATOR", "CONFIRMED"];

// Buyers of the same departure queue on its row lock, so a transaction may wait for its turn behind
// several others. Prisma's defaults (2s to start, 5s to run) are too tight for that over a remote
// database; a queued buyer should wait a few seconds rather than fail.
const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 20_000 };

type Tx = Prisma.TransactionClient;

function toTripRecord(trip: {
  id: string;
  title: string;
  description: string;
  currency: string;
  timeZone: string;
  bookingMode: string;
  ticketTypes: { label: string; priceCents: number; kind: "TICKET" | "EXTRA"; sortOrder: number }[];
}): NativeTripRecord {
  return {
    id: trip.id,
    title: trip.title,
    description: trip.description,
    currency: trip.currency,
    timeZone: trip.timeZone,
    bookingMode: trip.bookingMode,
    ticketTypes: trip.ticketTypes.map(({ label, priceCents, kind, sortOrder }) => ({ label, priceCents, kind, sortOrder }))
  };
}

function toBookingRecord(booking: {
  id: string;
  departureId: string;
  status: NativeBookingStatusValue;
  seats: number;
  totalCents: number;
  currency: string;
  holdExpiresAt: Date;
  operatorDeadlineAt: Date | null;
}): NativeBookingRecord {
  return {
    id: booking.id,
    departureId: booking.departureId,
    status: booking.status,
    seats: booking.seats,
    totalCents: booking.totalCents,
    currency: booking.currency,
    holdExpiresAt: booking.holdExpiresAt,
    operatorDeadlineAt: booking.operatorDeadlineAt
  };
}

/** Serialises everything that changes one departure's seats, so two buyers cannot both take the last one. */
async function lockDeparture(tx: Tx, departureId: string, tenantId: string) {
  const rows = await tx.$queryRaw<{ id: string; seats: number; status: string }[]>(
    Prisma.sql`SELECT "id", "seats", "status"::text AS "status" FROM "NativeDeparture" WHERE "id" = ${departureId} AND "tenantId" = ${tenantId} FOR UPDATE`
  );
  return rows[0] ?? null;
}

export class PrismaNativeStore implements NativeStore {
  private tenantIdPromise: Promise<string | null> | null = null;

  constructor(private readonly tenantSlug: string) {}

  private tenantId() {
    this.tenantIdPromise ??= prisma.tenant.findUnique({ where: { slug: this.tenantSlug }, select: { id: true } }).then((tenant) => tenant?.id ?? null);
    return this.tenantIdPromise;
  }

  async listPublishedTrips(): Promise<NativeTripRecord[]> {
    const tenantId = await this.tenantId();
    if (!tenantId) return [];

    const trips = await prisma.nativeTrip.findMany({
      where: { tenantId, status: "PUBLISHED" },
      orderBy: { createdAt: "asc" },
      include: { ticketTypes: { where: { active: true } } }
    });
    return trips.map(toTripRecord);
  }

  async getPublishedTrip(tripId: string): Promise<NativeTripRecord | null> {
    const tenantId = await this.tenantId();
    if (!tenantId) return null;

    const trip = await prisma.nativeTrip.findFirst({
      where: { id: tripId, tenantId, status: "PUBLISHED" },
      include: { ticketTypes: { where: { active: true } } }
    });
    return trip ? toTripRecord(trip) : null;
  }

  async departuresForDates(tripId: string, dates: string[], now: Date): Promise<NativeDepartureView[]> {
    const tenantId = await this.tenantId();
    if (!tenantId || dates.length === 0) return [];

    const trip = await prisma.nativeTrip.findFirst({
      where: { id: tripId, tenantId, status: "PUBLISHED" },
      select: { timeZone: true, schedules: true }
    });
    if (!trip) return [];

    const sorted = [...dates].sort();
    const blackouts = await prisma.nativeBlackout.findMany({
      where: {
        tenantId,
        OR: [{ tripId: null }, { tripId }],
        fromDate: { lte: sorted[sorted.length - 1] },
        toDate: { gte: sorted[0] }
      },
      select: { tripId: true, fromDate: true, toDate: true }
    });

    // Create the departures the weekly schedules call for. Re-asking is harmless: the unique
    // (trip, date, time) key makes the insert skip rows that already exist.
    const planned = new Set<string>();
    const toCreate: Prisma.NativeDepartureCreateManyInput[] = [];
    for (const date of sorted) {
      if (isBlackedOut(blackouts, tripId, date)) continue;
      for (const departure of plannedDeparturesForDate(trip.schedules, date)) {
        planned.add(`${date} ${departure.localTime}`);
        toCreate.push({
          tenantId,
          tripId,
          localDate: date,
          localTime: departure.localTime,
          startsAt: localToUtc(date, departure.localTime, trip.timeZone),
          seats: departure.seats
        });
      }
    }
    if (toCreate.length > 0) {
      await prisma.nativeDeparture.createMany({ data: toCreate, skipDuplicates: true });
    }

    const rows = await prisma.nativeDeparture.findMany({
      where: { tripId, tenantId, localDate: { in: sorted }, status: "OPEN" },
      orderBy: [{ localDate: "asc" }, { localTime: "asc" }],
      include: { bookings: { where: { status: { in: LIVE_STATUSES } }, select: { status: true, seats: true, holdExpiresAt: true } } }
    });

    return rows
      .filter((row) => {
        const hasLiveBooking = row.bookings.some((booking) => claimsSeats(booking, now));
        // A departure the schedule no longer calls for (or a blacked-out date) only stays visible
        // when it already has paying travellers on it.
        return hasLiveBooking || (planned.has(`${row.localDate} ${row.localTime}`) && !isBlackedOut(blackouts, tripId, row.localDate));
      })
      .map((row) => ({
        id: row.id,
        localDate: row.localDate,
        localTime: row.localTime,
        startsAt: row.startsAt,
        seatsLeft: seatsLeft(row.seats, row.bookings, now)
      }));
  }

  async holdSeats(input: HoldSeatsInput): Promise<HoldSeatsResult> {
    const tenantId = await this.tenantId();
    if (!tenantId) return { ok: false, reason: "DEPARTURE_NOT_FOUND" };

    return prisma.$transaction(async (tx) => {
      const departure = await lockDeparture(tx, input.departureId, tenantId);
      if (!departure || departure.status !== "OPEN") return { ok: false, reason: "DEPARTURE_NOT_FOUND" } as const;

      const live = await tx.nativeBooking.findMany({
        where: { departureId: input.departureId, status: { in: LIVE_STATUSES } },
        select: { status: true, seats: true, holdExpiresAt: true }
      });
      if (seatsLeft(departure.seats, live, input.now) < input.seats) return { ok: false, reason: "NO_SEATS" } as const;

      const booking = await tx.nativeBooking.create({
        data: {
          tenantId,
          departureId: input.departureId,
          seats: input.seats,
          ticketQuantities: input.ticketQuantities.map(({ optionLabel, quantity }) => ({ optionLabel, quantity })),
          extraQuantities:
            input.extraQuantities.length > 0 ? input.extraQuantities.map(({ optionLabel, quantity }) => ({ optionLabel, quantity })) : undefined,
          travellerName: input.travellerName,
          travellerEmail: input.travellerEmail,
          travellerPhone: input.travellerPhone,
          totalCents: input.totalCents,
          currency: input.currency,
          status: "HELD",
          holdExpiresAt: input.holdExpiresAt
        }
      });
      return { ok: true, booking: toBookingRecord(booking) } as const;
    }, TRANSACTION_OPTIONS);
  }

  async moveHoldToWaitingForOperator(bookingId: string, now: Date): Promise<ConfirmHoldResult> {
    const tenantId = await this.tenantId();
    if (!tenantId) return { ok: false, reason: "NOT_FOUND" };

    return prisma.$transaction(async (tx) => {
      const found = await tx.nativeBooking.findFirst({ where: { id: bookingId, tenantId } });
      if (!found) return { ok: false, reason: "NOT_FOUND" } as const;

      const departure = await lockDeparture(tx, found.departureId, tenantId);
      // Re-read under the lock: another request may have changed this booking while we waited.
      const booking = await tx.nativeBooking.findFirst({ where: { id: bookingId, tenantId } });
      if (!booking || !departure) return { ok: false, reason: "NOT_FOUND" } as const;

      if (booking.status === "WAITING_OPERATOR" || booking.status === "CONFIRMED") {
        return { ok: true, booking: toBookingRecord(booking) } as const;
      }
      if (booking.status !== "HELD" && booking.status !== "EXPIRED") return { ok: false, reason: "NOT_HOLDABLE" } as const;

      // The traveller paid after the hold lapsed: honour it only if the seats are still free.
      if (booking.status === "EXPIRED" || booking.holdExpiresAt.getTime() <= now.getTime()) {
        const others = await tx.nativeBooking.findMany({
          where: { departureId: booking.departureId, status: { in: LIVE_STATUSES }, NOT: { id: booking.id } },
          select: { status: true, seats: true, holdExpiresAt: true }
        });
        if (seatsLeft(departure.seats, others, now) < booking.seats) {
          await tx.nativeBooking.update({ where: { id: booking.id }, data: { status: "EXPIRED" } });
          return { ok: false, reason: "NO_SEATS" } as const;
        }
      }

      const updated = await tx.nativeBooking.update({
        where: { id: booking.id },
        data: { status: "WAITING_OPERATOR", operatorDeadlineAt: operatorDeadlineFrom(now) }
      });
      return { ok: true, booking: toBookingRecord(updated) } as const;
    }, TRANSACTION_OPTIONS);
  }

  async cancelBooking(bookingId: string): Promise<boolean> {
    const tenantId = await this.tenantId();
    if (!tenantId) return false;

    const result = await prisma.nativeBooking.updateMany({
      where: { id: bookingId, tenantId, status: { in: ["HELD", "WAITING_OPERATOR", "CONFIRMED"] } },
      data: { status: "CANCELLED" }
    });
    if (result.count > 0) return true;

    // Already cancelled counts as cancelled, so a repeated call is not an error.
    const existing = await prisma.nativeBooking.findFirst({ where: { id: bookingId, tenantId }, select: { status: true } });
    return existing?.status === "CANCELLED";
  }

  async getBooking(bookingId: string): Promise<NativeBookingRecord | null> {
    const tenantId = await this.tenantId();
    if (!tenantId) return null;

    const booking = await prisma.nativeBooking.findFirst({ where: { id: bookingId, tenantId } });
    return booking ? toBookingRecord(booking) : null;
  }
}
