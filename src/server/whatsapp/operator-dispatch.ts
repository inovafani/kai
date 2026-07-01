import {
  buildAcceptPayload,
  buildCounterPayload,
  buildDeclinePayload,
  buildOperatorInquiryParams,
  type OperatorInquiryTemplateInput,
  whatsappTemplateNames
} from "./templates";

export type WhatsAppTemplateComponent =
  | {
      type: "body";
      parameters: Array<{ type: "text"; text: string }>;
    }
  | {
      type: "button";
      sub_type: "quick_reply";
      index: "0" | "1" | "2";
      parameters: [{ type: "payload"; payload: string }];
    };

export type WhatsAppTemplatePayload = {
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: "en" };
    components: WhatsAppTemplateComponent[];
  };
};

export function buildOperatorInquiryTemplatePayload(input: OperatorInquiryTemplateInput): WhatsAppTemplatePayload {
  return {
    to: input.to,
    type: "template",
    template: {
      name: whatsappTemplateNames.bookingInquiryOperator,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: buildOperatorInquiryParams(input).map((text) => ({
            type: "text",
            text
          }))
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "0",
          parameters: [{ type: "payload", payload: buildAcceptPayload(input.bookingId) }]
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "1",
          parameters: [{ type: "payload", payload: buildDeclinePayload(input.bookingId) }]
        },
        {
          type: "button",
          sub_type: "quick_reply",
          index: "2",
          parameters: [{ type: "payload", payload: buildCounterPayload(input.bookingId) }]
        }
      ]
    }
  };
}

export function buildOperatorInquiryFreeText(input: OperatorInquiryTemplateInput) {
  return [
    "New BluePass inquiry",
    "",
    `Inquiry: ${input.inquiryTitle}`,
    `Traveller: ${input.travellerName}`,
    `Traveller WhatsApp: ${input.travellerPhone}`,
    `Dates: ${input.dateRange}`,
    `Guests: ${input.guests}`,
    `Budget / quote signal: ${input.quote}`,
    `Trip: ${input.tripTitle}`,
    `Notes: ${input.notes}`,
    "",
    `Reply accept:${input.bookingId}, decline:${input.bookingId}, or counter:${input.bookingId}.`
  ].join("\n");
}
