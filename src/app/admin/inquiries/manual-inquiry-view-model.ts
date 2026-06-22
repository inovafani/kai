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
    } | null;
  };
}

function formatGuestCount(guests: number | null) {
  return guests === 1 ? "1 guest" : String(guests ?? "Unknown") + " guests";
}

export function toManualInquiryViewModel(inquiry: ManualInquiryViewModelInput) {
  const bookingState = inquiry.conversation.bookingState;
  const isFailedBooking = bookingState?.bookingStatus === "FAILED";
  const customerLine = [inquiry.travellerName, inquiry.travellerEmail, inquiry.travellerPhone]
    .filter(Boolean)
    .join(" · ");

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
    operatorReason: isFailedBooking ? "PMS booking failed" : "Manual review required",
    operatorNextStep: isFailedBooking
      ? "Auto-booking failed. Retry PMS booking or create it manually, then notify the traveller."
      : "Review the conversation, contact the traveller if needed, then mark the inquiry notified or closed."
  };
}
