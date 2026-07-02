export const whatsappTemplateNames = {
  bookingInquiryOperator: "booking_inquiry_operator",
  bluePassInquiryUpdate: "bluepass_inquiry_update"
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

export type TravellerInquiryUpdateTemplateInput = {
  travellerName: string;
  tripSummary: string;
  operatorName: string;
  status: string;
};

export function buildTravellerInquiryUpdateParams(input: TravellerInquiryUpdateTemplateInput) {
  return [input.travellerName, input.tripSummary, input.operatorName, input.status];
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
