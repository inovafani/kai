import type { BookingFlowState } from "@/core/booking/booking-state-machine";
import type { BookingOrchestratorResult } from "@/core/booking/booking-orchestrator";

export interface BookingFailureManualInquiry {
  state: BookingFlowState;
  travellerName: string | null;
  travellerEmail: string | null;
  travellerPhone: string | null;
}

export function buildBookingFailureManualInquiry(
  bookingResult: BookingOrchestratorResult
): BookingFailureManualInquiry | null {
  if (bookingResult.action !== "BOOKING_FAILED" || !bookingResult.bookingStatePatch) {
    return null;
  }

  const state = bookingResult.bookingStatePatch;
  if (!state.productTitle || !state.dateText || !state.guests) {
    return null;
  }

  return {
    state,
    travellerName: state.travellerName ?? null,
    travellerEmail: state.travellerEmail ?? null,
    travellerPhone: state.travellerPhone ?? null
  };
}
