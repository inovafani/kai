import type { TruthPolicy } from "@/core/business-pack/types";

export type BluePassYachtCard = {
  slug: string;
  name: string;
  region: "Komodo" | "Raja Ampat";
  tier: string;
  maxGuests: number;
  cabins: number;
  priceSignal: string;
  charterPriceSignal: string | null;
  operatorId: string;
  operatorName: string;
  operatorPhone: string;
  productUrl?: string | null;
  reasons: string[];
  score: number;
  truth: TruthPolicy;
};

export type BluePassYachtCatalogItem = Omit<BluePassYachtCard, "reasons" | "score" | "truth"> & {
  interests: string[];
  cabinBookable?: boolean;
  about?: string | null;
  departuresPreview?: string[];
};

export type BluePassCatalogSnapshotItem = Partial<BluePassYachtCatalogItem> & {
  slug?: string;
  name?: string;
  region?: string;
};

export type BluePassYachtSearchIntent = {
  destination?: string;
  guests?: number;
  interests?: string[];
  selectedYachtSlug?: string;
};

const previewTruth: TruthPolicy = {
  availabilitySource: "preview_catalog",
  priceSource: "preview_catalog",
  bookingConfirmationSource: "operator_admin"
};

export const bluePassPreviewCatalog: BluePassYachtCatalogItem[] = [
  {
    slug: "alila-purnama",
    name: "Alila Purnama",
    region: "Komodo",
    tier: "Legend",
    maxGuests: 10,
    cabins: 5,
    priceSignal: "from USD 3,000 per cabin",
    charterPriceSignal: "from USD 15,000 private charter",
    operatorId: "operator_alila_purnama",
    operatorName: "Alila Purnama",
    operatorPhone: "+6281234567001",
    interests: ["dive", "luxury", "phinisi", "private"]
  },
  {
    slug: "alexa",
    name: "Alexa",
    region: "Komodo",
    tier: "Premium",
    maxGuests: 2,
    cabins: 1,
    priceSignal: "from USD 6,499 private couple charter",
    charterPriceSignal: null,
    operatorId: "operator_alexa",
    operatorName: "Alexa Charters",
    operatorPhone: "+6281234567890",
    interests: ["private", "couples", "luxury"]
  },
  {
    slug: "calico-jack",
    name: "Calico Jack",
    region: "Komodo",
    tier: "Premium",
    maxGuests: 10,
    cabins: 5,
    priceSignal: "from USD 3,200 per cabin",
    charterPriceSignal: "from USD 46,000 private charter",
    operatorId: "operator_calico_jack",
    operatorName: "Calico Jack",
    operatorPhone: "+6281234567004",
    interests: ["dive", "phinisi", "private", "cabin"]
  },
  {
    slug: "aliikai",
    name: "Aliikai",
    region: "Raja Ampat",
    tier: "Premium",
    maxGuests: 15,
    cabins: 7,
    priceSignal: "from USD 690 per cabin",
    charterPriceSignal: "from USD 8,900 charter",
    operatorId: "operator_aliikai",
    operatorName: "Aliikai Expeditions",
    operatorPhone: "+6281234567002",
    interests: ["dive", "phinisi", "cabin"]
  },
  {
    slug: "amandira",
    name: "Amandira",
    region: "Raja Ampat",
    tier: "Legend",
    maxGuests: 10,
    cabins: 5,
    priceSignal: "from USD 3,190 per cabin",
    charterPriceSignal: "from USD 15,500 charter",
    operatorId: "operator_amandira",
    operatorName: "Amandira",
    operatorPhone: "+6281234567003",
    interests: ["dive", "luxury", "private"]
  }
];

export function searchBluePassYachts(intent: BluePassYachtSearchIntent, catalogInput?: BluePassCatalogSnapshotItem[]) {
  return resolveBluePassCatalog(catalogInput)
    .map((item) => {
      const reasons: string[] = [];
      let score = 0;

      if (intent.selectedYachtSlug && item.slug === intent.selectedYachtSlug) {
        score += 100;
        reasons.push("selected by traveller");
      }

      if (intent.destination && item.region.toLowerCase().includes(intent.destination.toLowerCase())) {
        score += 40;
        reasons.push(`matches ${item.region}`);
      }

      if (intent.guests && item.maxGuests >= intent.guests) {
        score += 20;
        reasons.push(`fits up to ${item.maxGuests} guests`);
      }

      const interestMatches =
        intent.interests?.filter((interest) => item.interests.includes(interest.toLowerCase())) ?? [];
      if (interestMatches.length > 0) {
        score += interestMatches.length * 10;
        reasons.push(`matches ${interestMatches.join(", ")}`);
      }

      if (score === 0) {
        reasons.push("preview BluePass catalog option");
      }

      return {
        ...item,
        reasons,
        score,
        truth: previewTruth
      } satisfies BluePassYachtCard;
    })
    .sort((a, b) => b.score - a.score || b.maxGuests - a.maxGuests)
    .slice(0, 3);
}

export function findBluePassYachtBySlug(slug?: string | null, catalogInput?: BluePassCatalogSnapshotItem[]) {
  return slug ? resolveBluePassCatalog(catalogInput).find((item) => item.slug === slug) ?? null : null;
}

export function resolveBluePassCatalog(catalogInput?: BluePassCatalogSnapshotItem[]) {
  const externalCatalog = normalizeBluePassCatalogSnapshot(catalogInput);

  return externalCatalog.length > 0 ? externalCatalog : bluePassPreviewCatalog;
}

function normalizeBluePassCatalogSnapshot(catalogInput?: BluePassCatalogSnapshotItem[]): BluePassYachtCatalogItem[] {
  if (!Array.isArray(catalogInput)) {
    return [];
  }

  return catalogInput
    .map((item) => {
      const slug = item.slug?.trim();
      const name = item.name?.trim();
      const region = normalizeRegion(item.region);

      if (!slug || !name || !region) {
        return null;
      }

      return {
        slug,
        name,
        region,
        tier: item.tier?.trim() ?? "",
        maxGuests: Number(item.maxGuests) || 0,
        cabins: Number(item.cabins) || 0,
        priceSignal: item.priceSignal?.trim() || "Quote on request",
        charterPriceSignal: item.charterPriceSignal ?? null,
        operatorId: item.operatorId?.trim() || `operator_${slug.replace(/-/g, "_")}`,
        operatorName: item.operatorName?.trim() || name,
        operatorPhone: item.operatorPhone?.trim() || "",
        productUrl: item.productUrl?.trim() || null,
        interests: Array.isArray(item.interests) ? item.interests.filter(Boolean) : [],
        cabinBookable: item.cabinBookable,
        about: item.about ?? null,
        departuresPreview: Array.isArray(item.departuresPreview) ? item.departuresPreview.filter(Boolean) : []
      } satisfies BluePassYachtCatalogItem;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function normalizeRegion(value?: string) {
  if (/komodo|labuan bajo|flores/i.test(value ?? "")) return "Komodo";
  if (/raja\s*ampat|misool|sorong/i.test(value ?? "")) return "Raja Ampat";
  return null;
}
