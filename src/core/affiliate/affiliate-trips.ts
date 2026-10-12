/**
 * Trips BluePass resells as a FareHarbor affiliate or a Rezdy agent (Australia, 2026-10). The
 * traveller books them on the platform's own booking page, which shows live times, takes the payment
 * and sends the confirmation. Kai cannot see any of that (no API, and the platforms share no
 * traveller details with affiliates), so for these trips Kai's job is honest: recommend, answer from
 * the listing, and hand over the booking link. It never states availability, never takes a payment
 * and never collects details for an operator enquiry.
 */

export type AffiliatePlatform = "FAREHARBOR" | "REZDY";

export type AffiliateTrip = {
  slug: string;
  title: string;
  operatorName: string;
  region: string;
  category: string;
  description: string;
  priceSignal: string | null;
  bookingPlatform: AffiliatePlatform;
  bookingUrl: string;
};

const PLATFORM_HOSTS: Record<AffiliatePlatform, RegExp> = {
  FAREHARBOR: /^(?:[a-z0-9-]+\.)*fareharbor\.com$/i,
  REZDY: /^(?:[a-z0-9-]+\.)*rezdy\.com$/i
};

const PLATFORM_NAMES: Record<AffiliatePlatform, string> = {
  FAREHARBOR: "FareHarbor",
  REZDY: "Rezdy"
};

/** Only an https link on the platform's own domain is ever sent to a traveller. */
export function isAffiliateBookingUrl(platform: unknown, url: unknown): platform is AffiliatePlatform {
  if (platform !== "FAREHARBOR" && platform !== "REZDY") return false;
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === "https:" && PLATFORM_HOSTS[platform].test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Keeps only well-formed trips from whatever the BluePass app sent. */
export function parseAffiliateTrips(value: unknown): AffiliateTrip[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const text = (key: string) => (typeof record[key] === "string" ? (record[key] as string).trim() : "");
    const trip: AffiliateTrip = {
      slug: text("slug"),
      title: text("title"),
      operatorName: text("operatorName"),
      region: text("region"),
      category: text("category"),
      description: text("description"),
      priceSignal: text("priceSignal") || null,
      bookingPlatform: record.bookingPlatform as AffiliatePlatform,
      bookingUrl: text("bookingUrl")
    };
    if (!trip.slug || !trip.title || !isAffiliateBookingUrl(trip.bookingPlatform, trip.bookingUrl)) return [];
    return [{ ...trip, operatorName: trip.operatorName || trip.title }];
  });
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The trip the traveller names, by its full title (or its slug). Partial words are not enough. */
export function findNamedAffiliateTrip(message: string, trips: AffiliateTrip[]): AffiliateTrip | null {
  const content = ` ${normalize(message)} `;
  const named = trips
    .filter((trip) => {
      const title = normalize(trip.title);
      return (title.length > 0 && content.includes(` ${title} `)) || content.includes(` ${normalize(trip.slug)} `);
    })
    .sort((a, b) => b.title.length - a.title.length);
  return named[0] ?? null;
}

const STOP_WORDS = new Set(["and", "the", "of", "a", "to", "in", "on", "for", "with", "tour", "tours", "trip", "trips", "day", "cruise"]);

function keywords(text: string) {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/**
 * Trips that fit what the traveller asked for, best first. A trip scores for each word of its
 * region, category or title that the message contains. No match returns nothing rather than a
 * guess, so Kai falls back to its usual conversation.
 */
export function matchAffiliateTrips(message: string, trips: AffiliateTrip[], limit = 3): AffiliateTrip[] {
  const words = new Set(normalize(message).split(" "));
  return trips
    .map((trip, index) => {
      const regionHits = keywords(trip.region).filter((word) => words.has(word)).length;
      const categoryHits = keywords(trip.category).filter((word) => words.has(word)).length;
      const titleHits = keywords(trip.title).filter((word) => words.has(word)).length;
      return { trip, index, score: regionHits * 3 + categoryHits * 2 + titleHits };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.trip);
}

/** Asking to book, or asking what there is to do. Questions about one trip are left to the usual flow. */
export function wantsToBook(message: string) {
  return /\b(?:book|booking|reserve|buy|tickets?|pay|sign me up|how do i (?:book|get))\b/i.test(message);
}

export function wantsTripIdeas(message: string) {
  return /\b(?:what|which|any|recommend|suggest|ideas?|options?|things to do|looking for|want to|keen|interested)\b/i.test(message);
}

/** One trip, ready to book: what it is, who runs it, and the link. Nothing about availability. */
export function buildAffiliateTripReply(trip: AffiliateTrip) {
  const platform = PLATFORM_NAMES[trip.bookingPlatform];
  const price = trip.priceSignal ? ` ${trip.priceSignal} per guest.` : "";
  const about = trip.description ? `\n\n${firstSentences(trip.description, 2)}` : "";
  return (
    `${trip.title} is run by ${trip.operatorName} (${trip.region}).${price}${about}\n\n` +
    `Book it here: ${trip.bookingUrl}\n\n` +
    `That's ${trip.operatorName}'s own booking page on ${platform}: pick a date to see live times and seats, then pay securely there. ` +
    `Your confirmation and booking reference come from ${trip.operatorName} by email.`
  );
}

/** A short list of trips that fit, each with its link. */
export function buildAffiliateTripListReply(trips: AffiliateTrip[]) {
  const rows = trips
    .map((trip, index) => {
      const price = trip.priceSignal ? `, ${trip.priceSignal}` : "";
      return `${index + 1}. ${trip.title} with ${trip.operatorName} (${trip.region}${price})\n   Book: ${trip.bookingUrl}`;
    })
    .join("\n");
  return (
    `Here's what I'd look at:\n${rows}\n\n` +
    `Each link opens the operator's own booking page, with live times and secure checkout. ` +
    `Ask me about any of them and I'll tell you more.`
  );
}

function firstSentences(text: string, count: number) {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]+/g);
  if (!sentences) return text.trim();
  return sentences
    .slice(0, count)
    .map((sentence) => sentence.trim())
    .join(" ");
}

const LIST_MARKER = "here's what i'd look at:";

export type AffiliateTurn =
  /** NAMED: the traveller named it. PICKED: chose its number from Kai's list. MATCHED: the one trip that fit a request. */
  | { kind: "TRIP"; trip: AffiliateTrip; via: "NAMED" | "PICKED" | "MATCHED" }
  | { kind: "LIST"; trips: AffiliateTrip[] }
  | { kind: "NONE" };

/**
 * What Kai should do with this message for the resold trips, if anything:
 * - the traveller names a trip: that trip and its link;
 * - they pick a number from the list Kai just sent: that trip;
 * - they ask to book, or for ideas, and some trips fit: those trips (one goes straight to its link);
 * - otherwise nothing, and the usual conversation carries on.
 */
export function decideAffiliateTurn(input: {
  message: string;
  trips: AffiliateTrip[];
  lastAssistantMessage?: string | null;
}): AffiliateTurn {
  if (input.trips.length === 0) return { kind: "NONE" };

  const named = findNamedAffiliateTrip(input.message, input.trips);
  if (named) return { kind: "TRIP", trip: named, via: "NAMED" };

  const last = input.lastAssistantMessage ?? "";
  const pick = input.message.trim().toLowerCase().match(/^(?:option|number|no\.?|#)?\s*(\d{1,2})[.!]?$/);
  if (pick && last.toLowerCase().includes(LIST_MARKER)) {
    const listed = input.trips
      .map((trip) => ({ trip, at: last.indexOf(`${trip.title} with ${trip.operatorName}`) }))
      .filter((entry) => entry.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((entry) => entry.trip);
    const chosen = listed[Number(pick[1]) - 1];
    if (chosen) return { kind: "TRIP", trip: chosen, via: "PICKED" };
  }

  if (!wantsToBook(input.message) && !wantsTripIdeas(input.message)) return { kind: "NONE" };
  const matches = matchAffiliateTrips(input.message, input.trips);
  if (matches.length === 1) return { kind: "TRIP", trip: matches[0], via: "MATCHED" };
  if (matches.length > 1) return { kind: "LIST", trips: matches };
  return { kind: "NONE" };
}

export function buildAffiliateTurnReply(turn: Exclude<AffiliateTurn, { kind: "NONE" }>) {
  return turn.kind === "TRIP" ? buildAffiliateTripReply(turn.trip) : buildAffiliateTripListReply(turn.trips);
}
