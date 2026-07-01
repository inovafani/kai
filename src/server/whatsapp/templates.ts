export const whatsappTemplateNames = {
  bookingInquiryOperator: "booking_inquiry_operator"
} as const;

export type OperatorInquiryTemplateInput = {
  to: string;
  bookingId: string;
  inquiryTitle: string;
  travellerName: string;
  travellerPhone: string;
  dateRange: string;
  guests: string;
  quote: string;
  tripTitle: string;
  notes: string;
};

export function buildOperatorInquiryParams(input: OperatorInquiryTemplateInput) {
  return [
    input.inquiryTitle,
    input.travellerName,
    input.travellerPhone,
    input.dateRange,
    input.guests,
    input.quote,
    input.tripTitle,
    input.notes
  ];
}

export function buildAcceptPayload(bookingId: string) {
  return `accept:${bookingId.trim()}`;
}

export function buildDeclinePayload(bookingId: string) {
  return `decline:${bookingId.trim()}`;
}

export function buildCounterPayload(bookingId: string) {
  return `counter:${bookingId.trim()}`;
}
