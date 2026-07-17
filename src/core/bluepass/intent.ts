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

// Komodo/Raja Ampat keep their existing spelling-variant synonyms; any other known region (e.g.
// an Australian region from a live catalog) matches on its own exact name, case-insensitively.
const regionSynonymPatterns: Record<string, RegExp> = {
  Komodo: /\b(?:komodo|labuan\s+bajo|flores)\b/gi,
  "Raja Ampat": /\braja\s+ampat\b/gi
};

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function regionPattern(region: string) {
  return regionSynonymPatterns[region] ?? new RegExp(`\\b${escapeRegExp(region)}\\b`, "gi");
}

export function isRegionMentioned(text: string, region: string): boolean {
  // matchAll (not .test()) deliberately: regionPattern's regex objects are module-level and
  // shared, and a /g-flagged regex's .test() is stateful across calls via lastIndex - matchAll
  // always starts fresh regardless of prior calls on the same pattern.
  return [...text.matchAll(regionPattern(region))].length > 0;
}

export function extractKnownDestination(text: string, knownRegions: string[]): string | undefined {
  let bestRegion: string | undefined;
  let bestIndex = -1;

  for (const region of knownRegions) {
    const mentions = [...text.matchAll(regionPattern(region))];
    const lastIndex = mentions.length > 0 ? mentions[mentions.length - 1].index ?? -1 : -1;

    if (lastIndex > bestIndex) {
      bestIndex = lastIndex;
      bestRegion = region;
    }
  }

  return bestRegion;
}

export function extractBluePassInquiryIntent(
  messages: string[],
  knownRegions: string[] = ["Komodo", "Raja Ampat"]
): BluePassInquiryIntent {
  const text = messages.join("\n");
  const lowerText = text.toLowerCase();
  const intent: BluePassInquiryIntent = {};

  const destination = extractKnownDestination(text, knownRegions);
  if (destination) intent.destination = destination;
  if (/\b(dive|diving)\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "dive"]);
  if (/\b(private|charter)\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "private"]);
  if (/\bcabin\b/i.test(text)) intent.interests = unique([...(intent.interests ?? []), "cabin"]);

  const guestMatch = text.match(/\b(\d{1,3})\s*(?:guests?|people|pax|travellers?|travelers?)\b/i);
  if (guestMatch) intent.guests = Number(guestMatch[1]);

  const dateWindow = extractDateWindow(text, lowerText);
  if (dateWindow) intent.dateWindow = dateWindow;

  // An explicit currency code (prefix or suffix) is preserved as stated; only genuinely ambiguous
  // amounts (no currency mentioned at all) fall back to the existing USD default.
  const budgetMatch = text.match(/\b(USD|IDR|EUR|AUD)?\s*(\$?\s?\d{3,7}(?:,\d{3})?)(?:\s*(USD|IDR|EUR|AUD))?\b/i);
  if (
    budgetMatch &&
    // Pre-existing bug fixed in passing: this used to be Math.max(0, index) - 20, which for a
    // short string with index < 20 produces a NEGATIVE slice start (e.g. index 13 -> -7), and
    // a negative slice start counts from the END of the string, not "20 chars before the match" -
    // silently checking the wrong substring entirely. Only went unnoticed because the one existing
    // test's string was long enough for the (wrong) slice to still contain a trigger word by luck.
    /\b(?:budget|around|usd|aud|idr|eur|\$)\b/i.test(text.slice(Math.max(0, (budgetMatch.index ?? 0) - 20)))
  ) {
    const amount = budgetMatch[2].replace("$", "").trim();
    const currency = (budgetMatch[1] ?? budgetMatch[3])?.toUpperCase() ?? "USD";
    intent.budget = `${currency} ${amount}`;
  }

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) intent.travellerEmail = emailMatch[0];

  const phoneMatch = text.match(/\b(?:phone|whatsapp|wa)(?:\s+number)?\s*(?:is|:)?\s*([+\d][\d\s().-]{6,})/i);
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

  const fullDayMonthMatch = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (fullDayMonthMatch) {
    return formatDayMonthDate(fullDayMonthMatch[1], fullDayMonthMatch[2], fullDayMonthMatch[3]);
  }

  const fullMonthDayMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i
  );
  if (fullMonthDayMatch) {
    return formatDayMonthDate(fullMonthDayMatch[2], fullMonthDayMatch[1], fullMonthDayMatch[3]);
  }

  const monthMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i
  );
  return monthMatch ? titleCaseMonth(monthMatch[0]) : undefined;
}

function formatDayMonthDate(day: string, month: string, year?: string) {
  return [String(Number(day)), titleCaseMonth(month), year].filter(Boolean).join(" ");
}

function titleCaseMonth(month: string) {
  return month.slice(0, 1).toUpperCase() + month.slice(1).toLowerCase();
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function removeUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}
