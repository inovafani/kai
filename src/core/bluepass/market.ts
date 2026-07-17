// BluePass market + region gate. Kai now serves two markets - Australia and
// Indonesia - and asks country then region BEFORE the persona pitch, so every
// downstream reply can speak to the traveller/operator/partner's actual waters.

export type BluePassMarket = "AUSTRALIA" | "INDONESIA";

// Region-selection lists per market. Indonesia is Komodo/Raja Ampat live (more
// coming); Australia launches across the whole coast.
export const BLUEPASS_REGIONS: Record<BluePassMarket, readonly string[]> = {
  INDONESIA: ["Komodo", "Raja Ampat"],
  AUSTRALIA: [
    "Great Barrier Reef",
    "Whitsundays",
    "Ningaloo Reef",
    "Gold Coast",
    "Sydney",
    "Byron Bay",
    "Tasmania",
    "Rottnest & Perth"
  ]
};

// Signal -> market, in two tiers. An explicit country/nationality ("Indonesia",
// "Australian") is a STRONGER signal than a bare place name: a partner's residence
// city ("Gold Coast dive shop") must not outrank the destination country they name
// ("clients want Indonesia"). classifyBluePassMarket resolves the earliest COUNTRY
// token in a message first, and only falls back to place names when none is present.
const marketCountrySignals: Array<{ market: BluePassMarket; needles: string[] }> = [
  { market: "AUSTRALIA", needles: ["australia", "australian", "aussie"] },
  { market: "INDONESIA", needles: ["indonesia", "indonesian"] }
];

// A region or place name implies its country, so "I want Komodo" or "out of Cairns"
// still settles the market and can skip the gate. Deliberately excludes bare city
// names that are ALSO common personal names ("byron", "cairns", "perth", "sydney")
// and bare "raja" (a name / "maharaja") - those would mislock on ordinary intros.
// They still resolve a region once the market is known (see regionAliases below).
const marketPlaceSignals: Array<{ market: BluePassMarket; needles: string[] }> = [
  {
    market: "AUSTRALIA",
    needles: [
      "great barrier", "gbr", "whitsunday", "ningaloo", "exmouth", "gold coast",
      "byron bay", "port douglas", "rottnest", "tasmania", "tassie", "brisbane",
      "queensland", "airlie"
    ]
  },
  {
    market: "INDONESIA",
    needles: [
      "komodo", "raja ampat", "bali", "labuan bajo", "lombok", "gili",
      "flores", "sorong", "lembeh", "sulawesi"
    ]
  }
];

// Region aliases -> canonical region name, grouped by market.
const regionAliases: Record<BluePassMarket, Array<{ region: string; needles: string[] }>> = {
  AUSTRALIA: [
    { region: "Great Barrier Reef", needles: ["great barrier", "gbr", "cairns", "port douglas"] },
    { region: "Whitsundays", needles: ["whitsunday", "airlie"] },
    { region: "Ningaloo Reef", needles: ["ningaloo", "exmouth"] },
    { region: "Gold Coast", needles: ["gold coast"] },
    { region: "Sydney", needles: ["sydney"] },
    { region: "Byron Bay", needles: ["byron"] },
    { region: "Tasmania", needles: ["tasmania", "tassie", "hobart"] },
    { region: "Rottnest & Perth", needles: ["rottnest", "perth"] }
  ],
  INDONESIA: [
    { region: "Komodo", needles: ["komodo", "labuan bajo", "flores"] },
    { region: "Raja Ampat", needles: ["raja ampat", "raja", "sorong"] }
  ]
};

function isLetter(ch: string | undefined): boolean {
  return ch !== undefined && /[a-z]/i.test(ch);
}

/**
 * The char AFTER a needle match is a token boundary if it is a non-letter, OR a
 * trailing plural "s" that is itself followed by a non-letter - so needle
 * "whitsunday" still matches "the Whitsundays" while "bali" does not match
 * "Balikpapan" (followed by "k", not a boundary).
 */
function isBoundaryAfter(haystack: string, endIdx: number): boolean {
  const ch = haystack[endIdx];
  if (!isLetter(ch)) return true;
  return (ch === "s" || ch === "S") && !isLetter(haystack[endIdx + 1]);
}

/**
 * Index of the earliest needle that appears on TOKEN BOUNDARIES, or -1. The char
 * before the match must be a non-letter and the char after must clear
 * {@link isBoundaryAfter}, so short needles ("gbr", "bali") don't false-hit inside
 * longer words ("Balikpapan"). Multi-word needles ("raja ampat", "gold coast")
 * still match across their internal space.
 */
function firstIndexOfAny(haystack: string, needles: string[]): number {
  let best = -1;
  for (const needle of needles) {
    let from = 0;
    for (;;) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      const onBoundary = !isLetter(haystack[idx - 1]) && isBoundaryAfter(haystack, idx + needle.length);
      if (onBoundary) {
        if (best === -1 || idx < best) best = idx;
        break; // earliest boundary hit for this needle
      }
      from = idx + 1; // this occurrence was inside a word; keep scanning
    }
  }
  return best;
}

/** Market whose earliest needle appears first in `text`, or null if none match. */
function earliestMarket(
  text: string,
  signals: Array<{ market: BluePassMarket; needles: string[] }>
): BluePassMarket | null {
  let winner: BluePassMarket | null = null;
  let winnerIdx = -1;
  for (const { market, needles } of signals) {
    const idx = firstIndexOfAny(text, needles);
    if (idx !== -1 && (winnerIdx === -1 || idx < winnerIdx)) {
      winner = market;
      winnerIdx = idx;
    }
  }
  return winner;
}

/**
 * First market signal locks it (oldest message first). Within one message, an
 * explicit country/nationality outranks a bare place name (so a residence city
 * cannot outrank a named destination country - "Gold Coast agent, clients want
 * Indonesia" = INDONESIA); among tokens of the same tier the earliest wins.
 * Returns "UNKNOWN" until a signal appears.
 */
export function classifyBluePassMarket(messages: string[]): BluePassMarket | "UNKNOWN" {
  for (const message of messages) {
    const text = message.toLowerCase();
    const country = earliestMarket(text, marketCountrySignals);
    if (country) return country;
    const place = earliestMarket(text, marketPlaceSignals);
    if (place) return place;
  }
  return "UNKNOWN";
}

/**
 * Within a known market, resolve the region the traveller/operator names.
 * Returns the canonical region string or null if none is mentioned yet.
 */
export function classifyBluePassRegion(market: BluePassMarket, messages: string[]): string | null {
  for (const message of messages) {
    const text = message.toLowerCase();
    let region: string | null = null;
    let regionIdx = -1;
    for (const { region: canonical, needles } of regionAliases[market]) {
      const idx = firstIndexOfAny(text, needles);
      if (idx !== -1 && (regionIdx === -1 || idx < regionIdx)) {
        region = canonical;
        regionIdx = idx;
      }
    }
    if (region) return region;
  }
  return null;
}

// ─── Gate copy ────────────────────────────────────────────────────────────────

/** Step 1 - the very first thing Kai asks: which country. */
export function buildBluePassMarketGreeting(): string {
  return "Hey - Kai here, the BluePass ocean concierge. First up so I point you the right way: are you in Australia or Indonesia?";
}

/**
 * Market-aware "where we're live" sentence for the persona pitch. Australia is the
 * launch market, so it is the DEFAULT when the market is not yet known; Indonesia
 * only on an explicit INDONESIA selection behind the country gate.
 */
export function bluePassRegionsPitch(market?: BluePassMarket): string {
  if (market === "INDONESIA") {
    return "We're also live in Indonesia, with Komodo and Raja Ampat - two of the best reef destinations on the planet, through one link.";
  }
  return "In Australia we're live right across the coast - the Great Barrier Reef, Whitsundays, Ningaloo, Gold Coast, Sydney, Byron Bay, Tasmania and Rottnest, all through one link.";
}

/** Market-aware descriptor for the operator catalogue ("vetted X operators"). AU-default. */
export function bluePassOperatorsDescriptor(market?: BluePassMarket): string {
  if (market === "INDONESIA") return "vetted Indonesian liveaboards";
  return "vetted Australian reef and charter operators";
}

/**
 * Vessel noun for a yacht/boat in `region`. "phinisi" is a specifically Indonesian
 * traditional vessel, so it applies only to Indonesian waters; Australian (and unknown)
 * regions get the neutral "boat" - an AU reef/charter vessel is not a phinisi.
 */
export function bluePassVesselNoun(region?: string): string {
  return region && classifyBluePassMarket([region]) === "INDONESIA" ? "phinisi" : "boat";
}

/**
 * Short inline region fragment for partner prompts that ask the partner to choose a
 * destination ("... which region - X?"). AU-default (launch market); the AU form names
 * two flagship reefs plus an open invite so the whole coast is welcome without an
 * eight-item list blowing the 320-char budget. Question ("or") form.
 */
export function bluePassRegionChoice(market?: BluePassMarket): string {
  if (market === "INDONESIA") return "Komodo or Raja Ampat";
  return "the Great Barrier Reef, Ningaloo, or another stretch of coast";
}

/** Statement ("and") form of {@link bluePassRegionChoice} ("... operators across X"). AU-default. */
export function bluePassRegionSpan(market?: BluePassMarket): string {
  if (market === "INDONESIA") return "Komodo and Raja Ampat";
  return "the Great Barrier Reef, Ningaloo and beyond";
}

/** Market-aware "flagship X" phrase for catalogue copy. AU-default. */
export function bluePassFlagshipVessel(market?: BluePassMarket): string {
  if (market === "INDONESIA") return "flagship phinisi";
  return "premium charter boats";
}

export type BluePassGateStep = "MARKET" | "REGION" | "READY";

export type BluePassGate = {
  step: BluePassGateStep;
  market: BluePassMarket | null;
  region: string | null;
  /** The next question to ask, or null once READY (proceed to the persona flow). */
  prompt: string | null;
};

/**
 * The hard country -> region gate as a pure state machine. The server flow
 * calls this with the conversation so far, BEFORE the persona pitch:
 *   - market unknown  -> ask "Australia or Indonesia?" (step MARKET)
 *   - market known, region unknown -> ask the region for that coast (step REGION)
 *   - both known      -> READY; pass `market` into buildBluePassOperator/PartnerReply.
 * A place name (e.g. "Cairns", "Komodo") settles both at once and skips ahead.
 */
export function resolveBluePassGate(messages: string[]): BluePassGate {
  let market = classifyBluePassMarket(messages);
  if (market === "UNKNOWN") {
    return { step: "MARKET", market: null, region: null, prompt: buildBluePassMarketGreeting() };
  }
  let region = classifyBluePassRegion(market, messages);
  if (!region) {
    // The locked market has no region match - the user may have named a region in
    // the OTHER market (e.g. locked AUSTRALIA via nationality, then names Komodo).
    // A concrete region name disambiguates the country, so flip rather than loop
    // forever asking for a region that will never be given.
    const other: BluePassMarket = market === "AUSTRALIA" ? "INDONESIA" : "AUSTRALIA";
    const otherRegion = classifyBluePassRegion(other, messages);
    if (otherRegion) {
      market = other;
      region = otherRegion;
    }
  }
  if (!region) {
    return { step: "REGION", market, region: null, prompt: buildBluePassRegionPrompt(market) };
  }
  return { step: "READY", market, region, prompt: null };
}

/** Step 2 - once the market is known, ask which region, listing that market's coast. */
export function buildBluePassRegionPrompt(market: BluePassMarket): string {
  const regions = BLUEPASS_REGIONS[market];
  const last = regions[regions.length - 1];
  const list =
    regions.length <= 2
      ? regions.join(" or ")
      : `${regions.slice(0, -1).join(", ")}, or ${last}`;
  if (market === "AUSTRALIA") {
    return `Australia - welcome. Which stretch of coast are you on: ${list}?`;
  }
  return `Indonesia it is. Komodo and Raja Ampat are live, more waters coming - which one: ${list}?`;
}
