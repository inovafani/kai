export type BluePassInquiryIntent = {
  destination?: string;
  tripType?: string;
  dateWindow?: string;
  guests?: number;
  budget?: string;
  travellerName?: string;
  travellerEmail?: string;
  travellerPhone?: string;
  selectedYachtSlug?: string;
  interests?: string[];
};

export type BluePassRequiredInquiryField =
  | "destination"
  | "dateWindow"
  | "guests"
  | "travellerName"
  | "travellerEmail"
  | "travellerPhone";

const requiredFields: BluePassRequiredInquiryField[] = [
  "destination",
  "dateWindow",
  "guests",
  "travellerName",
  "travellerEmail",
  "travellerPhone"
];

export function extractBluePassInquiryIntent(messages: string[]): BluePassInquiryIntent {
  const text = messages.join("\n");
  const lowerText = text.toLowerCase();
  const intent: BluePassInquiryIntent = {};

  if (/\bkomodo\b/i.test(text)) intent.destination = "Komodo";
  if (/\braja\s+ampat\b/i.test(text)) intent.destination = "Raja Ampat";
  if (/\b(dive|diving)\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "dive"]);
  if (/\b(private|charter)\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "private"]);
  if (/\bcabin\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "cabin"]);

  const guestMatch = text.match(/\b(\d{1,3})\s*(?:guests?|people|pax|travellers?|travelers?)\b/i);
  if (guestMatch) intent.guests = Number(guestMatch[1]);

  const dateWindow = extractDateWindow(text, lowerText);
  if (dateWindow) intent.dateWindow = dateWindow;

  const budgetMatch = text.match(/\b(?:USD\s*)?(\$?\s?\d{3,7}(?:,\d{3})?)(?:\s*USD)?\b/i);
  if (budgetMatch && /\b(?:budget|around|usd|\$)\b/i.test(text.slice(Math.max(0, budgetMatch.index ?? 0) - 20))) {
    const amount = budgetMatch[1].replace("$", "").trim();
    intent.budget = `USD ${amount}`;
  }

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) intent.travellerEmail = emailMatch[0];

  const phoneMatch = text.match(/\b(?:phone|whatsapp)\s*(?:is|:)?\s*([+\d][\d\s().-]{6,})/i);
  if (phoneMatch) intent.travellerPhone = phoneMatch[1].trim();

  const nameMatch = text.match(
    /\b(?:my name is|name is|i am|i'm)\s+([A-Za-z][A-Za-z' -]{1,60})(?=,|\.|$|\s+(?:email|phone|whatsapp)\b)/i
  );
  if (nameMatch) intent.travellerName = nameMatch[1].trim();

  return intent;
}

export function mergeBluePassInquiryIntent(
  previous: BluePassInquiryIntent | null | undefined,
  next: BluePassInquiryIntent
): BluePassInquiryIntent {
  return {
    ...(previous ?? {}),
    ...removeUndefined(next),
    interests: unique([...(previous?.interests ?? []), ...(next.interests ?? [])])
  };
}

export function getMissingBluePassInquiryFields(intent: BluePassInquiryIntent) {
  return requiredFields.filter((field) => {
    const value = intent[field];
    return value === undefined || value === null || value === "";
  });
}

function extractDateWindow(text: string, lowerText: string) {
  if (lowerText.includes("next month")) return "next month";
  if (lowerText.includes("tomorrow")) return "tomorrow";
  if (lowerText.includes("next week")) return "next week";

  const monthMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i
  );
  return monthMatch?.[0];
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
