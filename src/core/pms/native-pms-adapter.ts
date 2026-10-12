import type { NativeDepartureView, NativeQuantity, NativeStore, NativeTripRecord } from "@/core/native/native-store";
import { dateRange, formatTimeLabel, resolveRequestedDate, toStartTimeLocal } from "@/core/native/native-time";
import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsAvailableDatesRequest,
  PmsAvailableDatesResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct
} from "./types";

const HOLD_MINUTES = 30;
/** A search window longer than this is cut, so one question never generates a year of departures. */
const MAX_SEARCH_DAYS = 120;

export interface NativePmsAdapterOptions {
  store: NativeStore;
  now?: () => Date;
  holdMinutes?: number;
}

function ticketOptionsOf(trip: NativeTripRecord, kind: "TICKET" | "EXTRA") {
  return trip.ticketTypes
    .filter((ticketType) => ticketType.kind === kind)
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
}

function priceQuantities(
  trip: NativeTripRecord,
  kind: "TICKET" | "EXTRA",
  quantities: NativeQuantity[] | null | undefined
): { ok: true; cents: number; count: number; clean: NativeQuantity[] } | { ok: false } {
  const options = ticketOptionsOf(trip, kind);
  let cents = 0;
  let count = 0;
  const clean: NativeQuantity[] = [];

  for (const item of quantities ?? []) {
    if (!Number.isInteger(item.quantity) || item.quantity < 0) return { ok: false };
    if (item.quantity === 0) continue;
    const option = options.find((candidate) => candidate.label.toLowerCase() === item.optionLabel.trim().toLowerCase());
    if (!option) return { ok: false };
    cents += option.priceCents * item.quantity;
    count += item.quantity;
    clean.push({ optionLabel: option.label, quantity: item.quantity });
  }

  return { ok: true, cents, count, clean };
}

/**
 * BluePass's own booking system as a PMS adapter (PmsProvider NATIVE): trips, ticket prices, weekly
 * schedules and seats that operators keep on Kai instead of in Rezdy or FareHarbor. Scoped to one
 * tenant through its store.
 *
 * Booking works like the other direct-PMS adapters: createBooking holds the seats and returns the
 * booking id, the traveller pays through BluePass checkout, then confirmBooking runs. Unlike Rezdy,
 * a native booking is not confirmed by payment alone, the operator accepts it, so confirmBooking
 * answers PENDING ("paid, waiting for the operator"). The payment pipeline learns that third answer
 * in a later step; until then it treats PENDING as a failed confirm and refunds in full, which is
 * the safe direction.
 */
export class NativePmsAdapter implements PmsAdapter {
  provider = "NATIVE" as const;

  private readonly store: NativeStore;
  private readonly now: () => Date;
  private readonly holdMinutes: number;

  constructor(options: NativePmsAdapterOptions) {
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.holdMinutes = options.holdMinutes ?? HOLD_MINUTES;
  }

  async listProducts(): Promise<PmsProduct[]> {
    const trips = await this.store.listPublishedTrips();
    return trips.map((trip) => ({
      externalProductId: trip.id,
      title: trip.title,
      description: trip.description,
      bookingMode: trip.bookingMode === "MANUAL_INQUIRY" ? "MANUAL_INQUIRY" : "AUTO_BOOKING"
    }));
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    const trip = await this.store.getPublishedTrip(request.productId);
    if (!trip) {
      return { productId: request.productId, date: request.date, available: false, remaining: 0, currency: "USD", unitPriceCents: 0 };
    }

    const now = this.now();
    const requested = resolveRequestedDate(request.date, trip.timeZone, now);
    const tickets = ticketOptionsOf(trip, "TICKET");
    const extras = ticketOptionsOf(trip, "EXTRA");
    const unitPriceCents = tickets[0]?.priceCents ?? 0;

    if (!requested) {
      return { productId: trip.id, date: request.date, available: false, remaining: 0, currency: trip.currency, unitPriceCents };
    }

    const departures = (await this.store.departuresForDates(trip.id, [requested.date], now)).filter(
      (departure) => departure.startsAt.getTime() > now.getTime()
    );
    const guests = Math.max(1, request.guests);
    const fitting = departures.filter((departure) => departure.seatsLeft >= guests);
    const picked = requested.time ? fitting.find((departure) => departure.localTime === requested.time) : undefined;
    const lead = picked ?? fitting[0];
    const mostSeatsLeft = departures.reduce((most, departure) => Math.max(most, departure.seatsLeft), 0);

    return {
      productId: trip.id,
      date: lead ? toStartTimeLocal(lead.localDate, lead.localTime) : `${requested.date} 00:00:00`,
      available: Boolean(lead),
      remaining: lead ? lead.seatsLeft : mostSeatsLeft,
      currency: trip.currency,
      unitPriceCents,
      timeOptions: fitting.map((departure) => ({
        label: formatTimeLabel(departure.localTime),
        startTimeLocal: toStartTimeLocal(departure.localDate, departure.localTime),
        remaining: departure.seatsLeft
      })),
      ticketOptions: tickets.map((ticket) => ({ label: ticket.label, unitPriceCents: ticket.priceCents, currency: trip.currency })),
      ...(extras.length > 0 ? { extraOptions: extras.map((extra) => ({ label: extra.label, unitPriceCents: extra.priceCents, currency: trip.currency })) } : {})
    };
  }

  async findAvailableDates(request: PmsAvailableDatesRequest): Promise<PmsAvailableDatesResult> {
    const trip = await this.store.getPublishedTrip(request.productId);
    if (!trip) return { dates: [] };

    const now = this.now();
    const start = resolveRequestedDate(request.fromDate, trip.timeZone, now);
    if (!start) return { dates: [] };

    const days = Math.min(Math.max(0, request.daysToSearch), MAX_SEARCH_DAYS);
    const departures = await this.store.departuresForDates(trip.id, dateRange(start.date, days), now);
    const guests = Math.max(1, request.guests);
    const dates = new Set<string>();

    for (const departure of departures) {
      if (departure.startsAt.getTime() > now.getTime() && departure.seatsLeft >= guests) dates.add(departure.localDate);
    }

    return { dates: [...dates].sort() };
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    const failed: PmsCreateBookingResult = { externalBookingId: "", provider: "NATIVE", status: "FAILED" };
    const trip = await this.store.getPublishedTrip(request.productId);
    if (!trip || request.guests < 1) return failed;

    const now = this.now();
    const requested = resolveRequestedDate(request.date, trip.timeZone, now);
    if (!requested) return failed;

    const departure = await this.pickDeparture(trip, requested.date, requested.time, request.guests, now);
    if (!departure) return failed;

    const priced = this.priceBooking(trip, request);
    if (!priced) return failed;

    const held = await this.store.holdSeats({
      departureId: departure.id,
      seats: request.guests,
      ticketQuantities: priced.tickets,
      extraQuantities: priced.extras,
      travellerName: request.travellerName,
      travellerEmail: request.travellerEmail,
      travellerPhone: request.travellerPhone ?? null,
      totalCents: priced.totalCents,
      currency: trip.currency,
      holdExpiresAt: new Date(now.getTime() + this.holdMinutes * 60_000),
      now
    });

    if (!held.ok) return failed;
    return { externalBookingId: held.booking.id, provider: "NATIVE", status: "PENDING" };
  }

  /**
   * Called once payment has been collected. Moves the held seats to "waiting for the operator" and
   * answers PENDING, because only the operator's acceptance makes a native booking CONFIRMED. If the
   * hold lapsed and the seats were taken meanwhile, answers FAILED so the payment is refunded.
   */
  async confirmBooking(externalBookingId: string): Promise<PmsCreateBookingResult> {
    const result = await this.store.moveHoldToWaitingForOperator(externalBookingId, this.now());
    if (!result.ok) return { externalBookingId, provider: "NATIVE", status: "FAILED" };
    return { externalBookingId, provider: "NATIVE", status: result.booking.status === "CONFIRMED" ? "CONFIRMED" : "PENDING" };
  }

  async cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }> {
    return { cancelled: await this.store.cancelBooking(externalBookingId) };
  }

  async getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null> {
    const booking = await this.store.getBooking(externalBookingId);
    if (!booking) return null;

    const status = booking.status === "CONFIRMED" ? "CONFIRMED" : booking.status === "HELD" || booking.status === "WAITING_OPERATOR" ? "PENDING" : "FAILED";
    return { externalBookingId: booking.id, provider: "NATIVE", status };
  }

  /** The requested departure, or the only one that day when no time was given. Ambiguity fails rather than guesses. */
  private async pickDeparture(
    trip: NativeTripRecord,
    date: string,
    time: string | null,
    guests: number,
    now: Date
  ): Promise<NativeDepartureView | null> {
    const departures = (await this.store.departuresForDates(trip.id, [date], now)).filter(
      (departure) => departure.startsAt.getTime() > now.getTime()
    );

    if (time) return departures.find((departure) => departure.localTime === time && departure.seatsLeft >= guests) ?? null;
    return departures.length === 1 && departures[0].seatsLeft >= guests ? departures[0] : null;
  }

  private priceBooking(trip: NativeTripRecord, request: PmsCreateBookingRequest) {
    const tickets = ticketOptionsOf(trip, "TICKET");
    const requestedTickets = request.ticketQuantities?.length
      ? request.ticketQuantities
      : tickets[0]
        ? [{ optionLabel: tickets[0].label, quantity: request.guests }]
        : [];

    const ticketPrice = priceQuantities(trip, "TICKET", requestedTickets);
    const extraPrice = priceQuantities(trip, "EXTRA", request.extraQuantities);
    if (!ticketPrice.ok || !extraPrice.ok) return null;
    // Every ticket is a seat, so the ticket count has to match the party size.
    if (ticketPrice.count !== request.guests) return null;

    return { tickets: ticketPrice.clean, extras: extraPrice.clean, totalCents: ticketPrice.cents + extraPrice.cents };
  }
}
