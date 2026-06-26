import type { BluePassRequiredInquiryField } from "./intent";

const fieldLabels: Record<BluePassRequiredInquiryField, string> = {
  destination: "destination",
  dateWindow: "date window",
  guests: "guest count",
  travellerName: "name",
  travellerEmail: "email",
  travellerPhone: "phone"
};

export function buildBluePassMissingFieldsReply(input: {
  destination?: string;
  missingFields: BluePassRequiredInquiryField[];
}) {
  const missing = formatFieldList(input.missingFields);
  const context = input.destination ? ` for ${input.destination}` : "";

  return `I found BluePass preview yacht matches${context}. Please share your ${missing} so I can prepare the inquiry for operator confirmation.`;
}

export function buildBluePassInquiryReadyReply(input: {
  inquiryId: string;
  selectedYachtName?: string | null;
  dispatchQueued: boolean;
}) {
  const target = input.selectedYachtName ? ` for ${input.selectedYachtName}` : "";
  const dispatch = input.dispatchQueued
    ? "I also queued the operator WhatsApp follow-up."
    : "The inquiry is ready for BluePass operator routing.";

  return `I prepared BluePass inquiry ${input.inquiryId}${target}. ${dispatch} This is not a confirmed booking; availability, final price, and payment wait for operator confirmation.`;
}

function formatFieldList(fields: BluePassRequiredInquiryField[]) {
  const labels = fields.map((field) => fieldLabels[field]);
  if (labels.length <= 1) return labels[0] ?? "details";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}
