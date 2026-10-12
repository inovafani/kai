import type { PmsProvider } from "@/core/tenant/types";

export interface PmsProduct {
  externalProductId: string;
  title: string;
  description: string;
  bookingMode: "MANUAL_INQUIRY" | "AUTO_BOOKING";
  productUrl?: string | null;
}

export interface PmsAvailabilityRequest {
  productId: string;
  date: string;
  guests: number;
}

export interface PmsAvailabilityResult {
  productId: string;
  date: string;
  available: boolean;
  remaining: number;
  currency: string;
  unitPriceCents: number;
  timeOptions?: PmsTimeOption[];
  ticketOptions?: PmsTicketOption[];
  extraOptions?: PmsExtraOption[];
}

export interface PmsTimeOption {
  label: string;
  startTimeLocal: string;
  remaining: number;
  checkoutItemKey?: string;
  checkoutSessionId?: string;
}

export interface PmsTicketOption {
  label: string;
  unitPriceCents: number;
  /** ISO currency of unitPriceCents when the PMS knows it. Adapters that omit it are read as AUD. */
  currency?: string;
}

export interface PmsTicketQuantity {
  optionLabel: string;
  quantity: number;
}

export interface PmsExtraOption {
  label: string;
  unitPriceCents: number;
  currency?: string;
}

export interface PmsExtraQuantity {
  optionLabel: string;
  quantity: number;
}

export interface PmsCreateBookingRequest {
  productId: string;
  date: string;
  guests: number;
  travellerName: string;
  travellerEmail: string;
  travellerPhone?: string | null;
  ticketQuantities?: PmsTicketQuantity[] | null;
  extraQuantities?: PmsExtraQuantity[] | null;
  paymentCardToken?: string | null;
  confirmationMode?: "CONFIRM_NOW" | "PAYMENT_HOLD";
}

export interface PmsCreateBookingResult {
  externalBookingId: string;
  provider: PmsProvider;
  status: "CONFIRMED" | "PENDING" | "FAILED";
  paymentUrl?: string | null;
}

export interface PmsAvailableDatesRequest {
  productId: string;
  guests: number;
  /** The search window starts here (inclusive) - an explicit ISO yyyy-mm-dd, or "today"/"tomorrow",
   * same loose text booking-orchestrator already carries as effectiveSlots.dateText. */
  fromDate: string;
  daysToSearch: number;
}

export interface PmsAvailableDatesResult {
  /** ISO yyyy-mm-dd, ascending, deduped - every date in the window with a session that seats
   * `guests`, not just the first few. A calendar needs the full set to grey out the rest. */
  dates: string[];
}

export interface PmsAdapter {
  provider: PmsProvider;
  listProducts(): Promise<PmsProduct[]>;
  getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult>;
  createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult>;
  cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }>;
  getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null>;
  /**
   * Optional capability: explicitly confirm a booking that was previously created in a held/pending
   * state (e.g. via createBooking's PAYMENT_HOLD mode) once payment has been collected elsewhere.
   * Only Rezdy implements this today. Rezdy's confirm call is a full PUT replace of the booking
   * resource, not a status-only patch - it rejects a request with no items ("Empty booking items"),
   * so callers must re-supply the same request details used for the original createBooking call.
   * Callers must feature-detect (`if (adapter.confirmBooking)`) before use.
   */
  confirmBooking?(externalBookingId: string, request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult>;
  /**
   * Optional capability: find which dates in a window actually have room, in one request rather
   * than one getAvailability call per candidate day. Only the Rezdy adapters implement this today -
   * callers must feature-detect (`if (adapter.findAvailableDates)`) before use, and degrade to no
   * date suggestions for every other PMS rather than fail the turn.
   */
  findAvailableDates?(request: PmsAvailableDatesRequest): Promise<PmsAvailableDatesResult>;
}
