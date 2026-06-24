export type BookingBrainIntent =
  | "CHECK_AVAILABILITY"
  | "BOOKING_INQUIRY"
  | "PRODUCT_RECOMMENDATION"
  | "HUMAN_HANDOFF"
  | "GENERAL_QUESTION";

export type BookingBrainConfidence = "HIGH" | "MEDIUM" | "LOW";
export type BookingBrainMissingSlot = "product" | "date" | "guests";

export interface BookingBrainSlots {
  productHint: string | null;
  dateText: string | null;
  guests: number | null;
}

export interface BookingBrainResult {
  intent: BookingBrainIntent;
  confidence: BookingBrainConfidence;
  slots: BookingBrainSlots;
  missingSlots: BookingBrainMissingSlot[];
}

const PRODUCT_HINTS = [
  "Komodo Day Trip",
  "Private Charter",
  "Reef Day Snorkel",
  "Gold Coast Whale Escape",
  "Twilight Drift",
  "Broadwater Twilight Dining",
  "Coastal Lunch Escape",
  "Private Yacht Charter"
];
const MONTHS: Record<string, string> = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};
const MONTH_PATTERN = Object.keys(MONTHS)
  .sort((left, right) => right.length - left.length)
  .join("|");

function findProductHint(message: string) {
  const lowerMessage = message.toLowerCase();

  return (
    PRODUCT_HINTS.find((product) => lowerMessage.includes(product.toLowerCase())) ??
    (lowerMessage.includes("komodo") ? "Komodo Day Trip" : null)
  );
}

function findDateText(message: string) {
  const lowerMessage = message.toLowerCase();
  const relativeDate = lowerMessage.match(/\b(today|tomorrow|tonight)\b/);
  if (relativeDate) {
    return relativeDate[1];
  }

  const isoDate = lowerMessage.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoDate) {
    return isoDate[0];
  }

  const numericDayMonthDate = lowerMessage.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numericDayMonthDate) {
    const day = Number(numericDayMonthDate[1]);
    const month = Number(numericDayMonthDate[2]);
    const rawYear = numericDayMonthDate[3];
    const year = rawYear ? (rawYear.length === 2 ? `20${rawYear}` : rawYear) : "2026";

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const ordinalMonthDate = lowerMessage.match(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTH_PATTERN})\\b`)
  );
  if (ordinalMonthDate) {
    return `2026-${MONTHS[ordinalMonthDate[2]]}-${ordinalMonthDate[1].padStart(2, "0")}`;
  }

  return null;
}

function findGuests(message: string) {
  const guestCount = message.match(/\b(\d{1,2})\s*(guest|guests|pax|people|person|persons)\b/i);
  if (!guestCount) {
    return null;
  }

  return Number(guestCount[1]);
}

function classifyIntent(message: string): BookingBrainIntent {
  const lowerMessage = message.toLowerCase();
  const dateText = findDateText(message);
  const guests = findGuests(message);
  const productHint = findProductHint(message);

  if (/\b(human|agent|operator|staff|person|refund|complaint)\b/.test(lowerMessage)) {
    return "HUMAN_HANDOFF";
  }

  if (/\b(available|availability|check|slot|spots?)\b/.test(lowerMessage)) {
    return "CHECK_AVAILABILITY";
  }

  if (dateText && /\b(what about|how about|instead)\b/.test(lowerMessage)) {
    return "CHECK_AVAILABILITY";
  }

  if (productHint && dateText && guests) {
    return "CHECK_AVAILABILITY";
  }

  if (
    productHint &&
    /\b(what about|how about|instead|rather|actually|i mean|switch|change|another|other|different)\b/.test(lowerMessage)
  ) {
    return "PRODUCT_RECOMMENDATION";
  }

  if (
    /\b(yes please|sounds good|looks good|i want it|i want this|i want that|want it|want this|want that|take it|let'?s do it|continue|go ahead|proceed)\b/.test(
      lowerMessage
    )
  ) {
    return "BOOKING_INQUIRY";
  }

  if (
    /\b(recommend|recommendation|suggest|suggestion|options?|what should i do)\b/.test(lowerMessage) ||
    /\b(what do you have|what have you got|show me options|show me experiences|what can i do|what are my options)\b/.test(
      lowerMessage
    ) ||
    /\b(know about|learn about|tell me about|more about|info (about|on)|details? (about|on)|curious about|interested in|looking at)\b/.test(
      lowerMessage
    ) ||
    (Boolean(productHint) && /\b(see|view|look at|show me|let me see|open|page)\b/.test(lowerMessage))
  ) {
    return "PRODUCT_RECOMMENDATION";
  }

  if (/\b(book|booking|reserve|reservation|trips?|tours?|charters?|boats?)\b/.test(lowerMessage)) {
    return "BOOKING_INQUIRY";
  }

  if (dateText && guests) {
    return "CHECK_AVAILABILITY";
  }

  return "GENERAL_QUESTION";
}

function getMissingSlots(intent: BookingBrainIntent, slots: BookingBrainSlots) {
  if (intent === "HUMAN_HANDOFF" || intent === "GENERAL_QUESTION" || intent === "PRODUCT_RECOMMENDATION") {
    return [];
  }

  const missingSlots: BookingBrainMissingSlot[] = [];
  if (!slots.productHint) {
    missingSlots.push("product");
  }
  if (!slots.dateText) {
    missingSlots.push("date");
  }
  if (!slots.guests) {
    missingSlots.push("guests");
  }

  return missingSlots;
}

function getConfidence(intent: BookingBrainIntent, missingSlots: BookingBrainMissingSlot[]) {
  if (intent === "HUMAN_HANDOFF") {
    return "HIGH";
  }

  if (missingSlots.length === 0) {
    return "HIGH";
  }

  return missingSlots.length === 3 ? "LOW" : "MEDIUM";
}

export function analyzeTravellerBookingMessage(message: string): BookingBrainResult {
  const intent = classifyIntent(message);
  const slots = {
    productHint: findProductHint(message),
    dateText: findDateText(message),
    guests: findGuests(message)
  };
  const missingSlots = getMissingSlots(intent, slots);

  return {
    intent,
    confidence: getConfidence(intent, missingSlots),
    slots,
    missingSlots
  };
}

export function composeBookingBrainReply(analysis: BookingBrainResult) {
  if (analysis.intent === "HUMAN_HANDOFF") {
    return "I can hand this to the team. I will keep the booking details grounded and avoid making changes until an operator reviews it.";
  }

  if (analysis.intent === "GENERAL_QUESTION") {
    return "I can help with this tenant's experiences, availability checks, booking inquiries, or handoff to the team.";
  }

  if (analysis.missingSlots.length > 0) {
    const missing = analysis.missingSlots;

    if (missing.join(",") === "product,date,guests") {
      return "I can help with that. Which tour, date, and number of guests should I check first?";
    }

    return `I can help with that. Please share the ${missing.join(", ")} so I can check safely.`;
  }

  return `I can check ${analysis.slots.productHint} for ${analysis.slots.guests} guest${
    analysis.slots.guests === 1 ? "" : "s"
  } on ${analysis.slots.dateText}. Next I will use the tenant PMS adapter before confirming anything.`;
}
