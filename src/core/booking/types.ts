export type InquiryStatus = "OPEN" | "OPERATOR_NOTIFIED" | "ACCEPTED" | "DECLINED" | "CLOSED";

export type BookingStatus =
  | "DRAFT"
  | "AVAILABILITY_CHECKED"
  | "PAYMENT_PENDING"
  | "PAYMENT_AUTHORIZED"
  | "EXTERNAL_BOOKING_PENDING"
  | "CONFIRMED"
  | "RECONCILIATION_REQUIRED"
  | "CANCELLED"
  | "FAILED";

export type PaymentStatus = "NOT_REQUIRED" | "PENDING" | "AUTHORIZED" | "CAPTURED" | "FAILED" | "REFUNDED";

export interface BookingState {
  tenantId: string;
  bookingId: string;
  status: BookingStatus;
  paymentStatus: PaymentStatus;
  externalBookingId: string | null;
  externalProvider: string | null;
}

export function isConfirmedBooking(state: BookingState) {
  return state.status === "CONFIRMED" && state.externalBookingId !== null;
}
