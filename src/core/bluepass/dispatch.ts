export type BluePassDispatchTextInput = {
  inquiryId: string;
  selectedYachtName?: string | null;
  travellerName?: string | null;
  travellerPhone?: string | null;
  destination?: string | null;
  dateWindow?: string | null;
  guests?: number | null;
  budget?: string | null;
  referralCode?: string | null;
};

export function buildBluePassDispatchText(input: BluePassDispatchTextInput) {
  return [
    `BluePass inquiry ${input.inquiryId}`,
    `Trip: ${input.selectedYachtName ?? input.destination ?? "BluePass ocean trip"}`,
    `Traveller: ${input.travellerName ?? "Not provided"}`,
    `Phone: ${input.travellerPhone ?? "Not provided"}`,
    `When: ${input.dateWindow ?? "Dates pending"}`,
    `Guests: ${input.guests ?? "Not provided"}`,
    `Budget: ${input.budget ?? "Quote requested"}`,
    input.referralCode ? `Referral: ${input.referralCode}` : undefined,
    "Please reply with accept, decline, or counter. This is an inquiry only; operator confirmation required before booking or payment."
  ]
    .filter(Boolean)
    .join("\n");
}
