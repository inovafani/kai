import type { NativeBookingStatusValue } from "./native-seats";

/**
 * What the native adapter needs from storage. The adapter holds the booking rules; a store (Prisma in
 * production, an in-memory one in tests) only reads and writes rows. A store is always scoped to one
 * tenant, so an adapter can never see or touch another operator's trips.
 */

export interface NativeTicketTypeRecord {
  label: string;
  priceCents: number;
  kind: "TICKET" | "EXTRA";
  sortOrder: number;
}

export interface NativeTripRecord {
  id: string;
  title: string;
  description: string;
  currency: string;
  timeZone: string;
  bookingMode: string;
  ticketTypes: NativeTicketTypeRecord[];
}

/** A bookable departure with its live seat count. */
export interface NativeDepartureView {
  id: string;
  localDate: string;
  localTime: string;
  startsAt: Date;
  seatsLeft: number;
}

export interface NativeQuantity {
  optionLabel: string;
  quantity: number;
}

export interface NativeBookingRecord {
  id: string;
  departureId: string;
  status: NativeBookingStatusValue;
  seats: number;
  totalCents: number;
  currency: string;
  holdExpiresAt: Date;
  /** Set once the paid booking starts waiting for the operator. */
  operatorDeadlineAt: Date | null;
}

export interface HoldSeatsInput {
  departureId: string;
  seats: number;
  ticketQuantities: NativeQuantity[];
  extraQuantities: NativeQuantity[];
  travellerName: string;
  travellerEmail: string;
  travellerPhone: string | null;
  totalCents: number;
  currency: string;
  holdExpiresAt: Date;
  now: Date;
}

export type HoldSeatsResult =
  | { ok: true; booking: NativeBookingRecord }
  | { ok: false; reason: "NO_SEATS" | "DEPARTURE_NOT_FOUND" };

export type ConfirmHoldResult = { ok: true; booking: NativeBookingRecord } | { ok: false; reason: "NOT_FOUND" | "NOT_HOLDABLE" | "NO_SEATS" };

export interface NativeStore {
  listPublishedTrips(): Promise<NativeTripRecord[]>;
  getPublishedTrip(tripId: string): Promise<NativeTripRecord | null>;
  /**
   * Departures of a trip on the given local dates, creating any that the weekly schedules call for
   * but do not exist yet. Blacked-out dates and closed departures are left out.
   */
  departuresForDates(tripId: string, dates: string[], now: Date): Promise<NativeDepartureView[]>;
  /** Takes the seats in one transaction. Many callers racing for the last seats: exactly as many win as seats exist. */
  holdSeats(input: HoldSeatsInput): Promise<HoldSeatsResult>;
  /** Paid: HELD becomes WAITING_OPERATOR. Safe to call twice. */
  moveHoldToWaitingForOperator(bookingId: string, now: Date): Promise<ConfirmHoldResult>;
  /** Releases the seats. Returns false when the booking does not exist for this tenant. */
  cancelBooking(bookingId: string): Promise<boolean>;
  getBooking(bookingId: string): Promise<NativeBookingRecord | null>;
}
