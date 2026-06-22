import type { BookingCaptureDetails } from "./booking-capture";
import type { PmsTicketOption, PmsTicketQuantity } from "@/core/pms/types";
import type { PmsProvider } from "@/core/tenant/types";

export type BookingFlowStatus =
  | "DRAFT"
  | "AVAILABILITY_CHECKED"
  | "CAPTURED"
  | "READY_TO_CONFIRM"
  | "EXTERNAL_BOOKING_PENDING"
  | "CONFIRMED"
  | "FAILED";

export interface BookingFlowState extends BookingCaptureDetails {
  bookingStatus: BookingFlowStatus;
  confirmationSummary: string | null;
  externalBookingId?: string | null;
  externalProvider?: PmsProvider | null;
  bookingError?: string | null;
  ticketOptions?: PmsTicketOption[] | null;
  ticketQuantities?: PmsTicketQuantity[] | null;
}

function formatGuestCount(guests: number | null) {
  return `${guests ?? 0} guest${guests === 1 ? "" : "s"}`;
}

function buildConfirmationSummary(details: BookingCaptureDetails) {
  const ticketSummary =
    "ticketQuantities" in details &&
    Array.isArray((details as BookingFlowState).ticketQuantities) &&
    (details as BookingFlowState).ticketQuantities!.length > 0
      ? ` with ${(details as BookingFlowState).ticketQuantities!
          .map((ticket) => `${ticket.quantity} ${ticket.optionLabel}`)
          .join(", ")}`
      : "";

  return `${details.productTitle} on ${details.dateText} for ${formatGuestCount(details.guests)}${ticketSummary} under ${
    details.travellerName
  }, ${details.travellerEmail}, ${details.travellerPhone}.`;
}

export function captureBookingDetails(details: BookingCaptureDetails): BookingFlowState {
  return {
    ...details,
    bookingStatus: "CAPTURED",
    confirmationSummary: null,
    externalBookingId: null,
    externalProvider: null,
    bookingError: null
  };
}

export function markBookingReadyToConfirm(state: BookingFlowState): BookingFlowState {
  if (state.bookingStatus !== "CAPTURED") {
    throw new Error("Booking must be captured before it can be ready to confirm.");
  }

  return {
    ...state,
    bookingStatus: "READY_TO_CONFIRM",
    confirmationSummary: buildConfirmationSummary(state)
  };
}

export function beginExternalBooking(state: BookingFlowState): BookingFlowState {
  if (state.bookingStatus !== "READY_TO_CONFIRM") {
    throw new Error("Booking must be ready to confirm before external booking starts.");
  }

  return {
    ...state,
    bookingStatus: "EXTERNAL_BOOKING_PENDING"
  };
}

export function markExternalBookingConfirmed(
  state: BookingFlowState,
  input: { externalBookingId: string; externalProvider: PmsProvider }
): BookingFlowState {
  if (state.bookingStatus !== "EXTERNAL_BOOKING_PENDING") {
    throw new Error("External booking must be pending before it can be confirmed.");
  }

  return {
    ...state,
    bookingStatus: "CONFIRMED",
    externalBookingId: input.externalBookingId,
    externalProvider: input.externalProvider,
    bookingError: null
  };
}

export function markExternalBookingFailed(state: BookingFlowState, bookingError: string): BookingFlowState {
  if (state.bookingStatus !== "EXTERNAL_BOOKING_PENDING") {
    throw new Error("External booking must be pending before it can fail.");
  }

  return {
    ...state,
    bookingStatus: "FAILED",
    bookingError
  };
}
