import type { PmsProduct } from "@/core/pms/types";

export type ProductMatchResult =
  | {
      status: "MATCHED";
      product: PmsProduct;
      // Count of distinctive overlapping tokens behind this match. Within-tenant callers
      // (booking-orchestrator.ts, booking-memory.ts) intentionally accept any score > 0 - a
      // traveller already talking to one known tenant saying "the whale escape" should match on a
      // single distinctive word. Cross-tenant identification (generic-tenant-router.ts) needs a
      // higher bar, since a single coincidental token overlap is a real false-positive risk once
      // many tenants' catalogs are all being checked against unrelated messages.
      score: number;
    }
  | {
      status: "AMBIGUOUS";
      products: PmsProduct[];
    }
  | {
      status: "NO_MATCH";
      products: PmsProduct[];
    };

const GENERIC_PRODUCT_WORDS = new Set([
  "a",
  "an",
  "and",
  "day",
  "for",
  "guided",
  "sites",
  "the",
  "tour",
  "tours",
  "trip",
  "with"
]);

const ALIASES: Record<string, string[]> = {
  boat: ["charter"],
  boating: ["charter"],
  komodo: ["komodo"],
  private: ["private", "charter"],
  reef: ["reef", "snorkel"],
  snorkeling: ["snorkel"],
  snorkelling: ["snorkel"],
  snorkel: ["snorkel"],
  // Australia trip types
  sail: ["sailing", "charter"],
  sailing: ["sailing", "charter"],
  dive: ["dive", "reef"],
  diving: ["dive", "reef"],
  whale: ["whale"],
  whales: ["whale"],
  gbr: ["reef"],
  barrier: ["reef"],
  whitsundays: ["whitsundays", "sailing"]
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function getTokens(value: string) {
  return normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function getMeaningfulProductTokens(product: PmsProduct) {
  return new Set(
    getTokens(`${product.title} ${product.description}`).filter(
      (token) => !GENERIC_PRODUCT_WORDS.has(token)
    )
  );
}

function getMeaningfulTitleTokens(product: PmsProduct) {
  return [...new Set(getTokens(product.title).filter((token) => !GENERIC_PRODUCT_WORDS.has(token)))];
}

function getMessageSignals(message: string) {
  const signals = new Set<string>();

  for (const token of getTokens(message)) {
    if (!GENERIC_PRODUCT_WORDS.has(token)) {
      signals.add(token);
    }

    for (const alias of ALIASES[token] ?? []) {
      signals.add(alias);
    }
  }

  return signals;
}

function scoreProduct(messageSignals: Set<string>, product: PmsProduct) {
  const productTokens = getMeaningfulProductTokens(product);
  let score = 0;

  for (const signal of messageSignals) {
    if (productTokens.has(signal)) {
      score += 1;
    }
  }

  return score;
}

export function matchPmsProduct(message: string, products: PmsProduct[]): ProductMatchResult {
  const messageSignals = getMessageSignals(message);
  const scoredProducts = products
    .map((product) => ({
      product,
      score: scoreProduct(messageSignals, product)
    }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredProducts.length === 0) {
    const hasGenericProductIntent = getTokens(message).some((token) =>
      GENERIC_PRODUCT_WORDS.has(token)
    );

    return {
      status: hasGenericProductIntent ? "AMBIGUOUS" : "NO_MATCH",
      products
    };
  }

  const [best, second] = scoredProducts;
  if (second && best.score === second.score) {
    return {
      status: "AMBIGUOUS",
      products
    };
  }

  return {
    status: "MATCHED",
    product: best.product,
    score: best.score
  };
}

// Stricter than matchPmsProduct: for identifying WHICH TENANT/BUSINESS a free-text message is about
// when checking across many tenants sharing one WhatsApp number, not which product to book within a
// conversation already known to belong to one specific tenant. matchPmsProduct's single-shared-word
// tolerance is safe for the latter (a wrong guess just means asking a clarifying follow-up within
// the same business) but confirmed live to false-positive against ordinary unrelated messages once
// several tenants' catalogs are all being checked against every message - a false positive here
// hijacks an entirely unrelated conversation into the wrong business's booking flow. Requires the
// message to substantially name the product: at least half (rounded up, minimum 2 for any title
// with more than one meaningful word) of the product's own TITLE words specifically - not title +
// description, since marketing descriptions are prose full of the same common charter vocabulary
// travellers use every day, with far too little identifying signal.
export function messageNamesADistinctiveProduct(message: string, products: PmsProduct[]): boolean {
  const messageSignals = getMessageSignals(message);

  return products.some((product) => {
    const titleTokens = getMeaningfulTitleTokens(product);
    if (titleTokens.length === 0) return false;

    const overlap = titleTokens.filter((token) => messageSignals.has(token)).length;
    const required = titleTokens.length === 1 ? 1 : Math.max(2, Math.ceil(titleTokens.length / 2));

    return overlap >= required;
  });
}
