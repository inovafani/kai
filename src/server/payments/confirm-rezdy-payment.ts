import {
  beginPaidExternalBooking,
  markExternalBookingConfirmed,
  markExternalBookingFailed,
  type BookingFlowState
} from "@/core/booking/booking-state-machine";
import type { PmsAdapter } from "@/core/pms/types";

export async function confirmRezdyPaymentBooking({
  pmsAdapter,
  state,
  cardToken
}: {
  pmsAdapter: PmsAdapter;
  state: BookingFlowState;
  cardToken: string;
}) {
  const pendingState = beginPaidExternalBooking(state);
  if (
    !pendingState.productExternalId ||
    !pendingState.dateText ||
    !pendingState.guests ||
    !pendingState.travellerName ||
    !pendingState.travellerEmail
  ) {
    throw new Error("Booking details are incomplete for secure payment confirmation.");
  }

  const result = await pmsAdapter.createBooking({
    productId: pendingState.productExternalId,
    date: pendingState.dateText,
    guests: pendingState.guests,
    travellerName: pendingState.travellerName,
    travellerEmail: pendingState.travellerEmail,
    travellerPhone: pendingState.travellerPhone,
    ticketQuantities: pendingState.ticketQuantities,
    extraQuantities: pendingState.extraQuantities,
    paymentCardToken: cardToken,
    confirmationMode: "CONFIRM_NOW"
  });

  if (result.status !== "CONFIRMED" || !result.externalBookingId) {
    return {
      state: markExternalBookingFailed(
        pendingState,
        "Rezdy payment booking did not return a confirmed booking reference."
      ),
      result
    };
  }

  return {
    state: markExternalBookingConfirmed(pendingState, {
      externalBookingId: result.externalBookingId,
      externalProvider: result.provider
    }),
    result
  };
}
