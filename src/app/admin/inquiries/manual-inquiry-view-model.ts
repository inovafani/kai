type ManualInquiryStatus = "OPEN" | "OPERATOR_NOTIFIED" | "CLOSED";

export interface ManualInquiryViewModelInput {
  id: string;
  conversationId: string;
  status: ManualInquiryStatus;
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
  travellerName: string | null;
  travellerEmail: string | null;
  travellerPhone: string | null;
  travellerMessage: string;
  createdAt: Date;
  tenant: {
    name: string;
  };
  conversation: {
    bookingState: {
      bookingStatus: string;
      confirmationSummary: string | null;
      bookingError: string | null;
      externalBookingId?: string | null;
      externalProvider?: string | null;
    } | null;
  };
}

function formatGuestCount(guests: number | null) {
  return guests === 1 ? "1 guest" : String(guests ?? "Unknown") + " guests";
}

export function toManualInquiryViewModel(inquiry: ManualInquiryViewModelInput) {
  const bookingState = inquiry.conversation.bookingState;
  const isFailedBooking = bookingState?.bookingStatus === "FAILED";
  const isPaymentPending = bookingState?.bookingStatus === "PAYMENT_PENDING";
  const customerLine = [inquiry.travellerName, inquiry.travellerEmail, inquiry.travellerPhone]
    .filter(Boolean)
    .join(" · ");
  const externalBookingId = bookingState?.externalBookingId ?? null;
  const externalProvider = bookingState?.externalProvider ?? null;
  const operatorReason = isFailedBooking
    ? "PMS booking failed"
    : isPaymentPending
      ? "Payment follow-up required"
      : "Manual review required";
  const operatorNextStep = isFailedBooking
    ? "Auto-booking failed. Retry PMS booking or create it manually, then notify the traveller."
    : isPaymentPending && externalBookingId
      ? `Search Rezdy order ${externalBookingId}, then send the secure payment link or follow up with the traveller.`
      : isPaymentPending
        ? "Check the PMS pending cart, then send the secure payment link or follow up with the traveller."
        : "Review the conversation, contact the traveller if needed, then mark the inquiry notified or closed.";

  return {
    id: inquiry.id,
    conversationId: inquiry.conversationId,
    status: inquiry.status,
    productTitle: inquiry.productTitle ?? "Unknown product",
    requestLine: `${inquiry.dateText ?? "Date unknown"} · ${formatGuestCount(inquiry.guests)} · ${inquiry.tenant.name}`,
    customerLine: customerLine.length > 0 ? customerLine : null,
    travellerMessage: inquiry.travellerMessage,
    createdAt: inquiry.createdAt,
    bookingStatus: bookingState?.bookingStatus ?? null,
    confirmationSummary: bookingState?.confirmationSummary ?? null,
    bookingError: bookingState?.bookingError ?? null,
    externalBookingId,
    externalProvider,
    operatorReason,
    operatorNextStep
  };
}
