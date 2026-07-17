import type { PmsProduct } from "@/core/pms/types";

export type ProductMatchResult =
  | {
      status: "MATCHED";
      product: PmsProduct;
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
    product: best.product
  };
}
