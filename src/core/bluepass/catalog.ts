import type { TruthPolicy } from "@/core/business-pack/types";

export type BluePassYachtCard = {
  slug: string;
  name: string;
  region: string;
  tier: string;
  maxGuests: number;
  cabins: number;
  priceSignal: string;
  charterPriceSignal: string | null;
  operatorId: string;
  operatorName: string;
  operatorPhone: string;
  productUrl?: string | null;
  imageUrl?: string | null;
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

export type BluePassAlternativeYachtInput = BluePassYachtSearchIntent & {
  declinedYachtSlug?: string | null;
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
    productUrl: "https://bluepass.co/yachts/alila-purnama",
    imageUrl: "https://bluepass.co/yachts/alila-purnama/hero.jpg",
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
    productUrl: "https://bluepass.co/yachts/alexa",
    imageUrl: "https://bluepass.co/yachts/alexa/hero.jpg",
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
    productUrl: "https://bluepass.co/yachts/calico-jack",
    imageUrl: "https://bluepass.co/yachts/calico-jack/hero.jpg",
    interests: ["dive", "phinisi", "private", "cabin"]
  },
  {
    slug: "anne-bonny",
    name: "Anne Bonny",
    region: "Komodo",
    tier: "Explorer",
    maxGuests: 8,
    cabins: 3,
    priceSignal: "from USD 1,483 private charter signal",
    charterPriceSignal: "from USD 4,450 private charter",
    operatorId: "operator_anne_bonny",
    operatorName: "Anne Bonny",
    operatorPhone: "+6281234567005",
    productUrl: "https://bluepass.co/yachts/anne-bonny",
    imageUrl: "https://bluepass.co/yachts/anne-bonny/hero.jpg",
    interests: ["dive", "phinisi", "private", "explorer"],
    about:
      "Anne Bonny is a 30-metre liveaboard with 3 cabins for up to 8 guests, focused on accessible private charter adventures in Komodo with seasonal Raja Ampat itineraries."
  },
  {
    slug: "celestia",
    name: "Celestia",
    region: "Komodo",
    tier: "Premium",
    maxGuests: 14,
    cabins: 7,
    priceSignal: "from USD 1,643 per cabin",
    charterPriceSignal: null,
    operatorId: "operator_celestia",
    operatorName: "Celestia",
    operatorPhone: "+6281234567006",
    productUrl: "https://bluepass.co/yachts/celestia",
    imageUrl: "https://bluepass.co/yachts/celestia/hero.jpg",
    interests: ["dive", "phinisi", "luxury", "cabin"]
  },
  {
    slug: "dunia-baru",
    name: "Dunia Baru",
    region: "Komodo",
    tier: "Legend",
    maxGuests: 14,
    cabins: 7,
    priceSignal: "from USD 2,857 per cabin",
    charterPriceSignal: "from USD 20,000 private charter",
    operatorId: "operator_dunia_baru",
    operatorName: "Dunia Baru",
    operatorPhone: "+6281234567007",
    productUrl: "https://bluepass.co/yachts/dunia-baru",
    imageUrl: "https://bluepass.co/yachts/dunia-baru/hero.jpg",
    interests: ["dive", "luxury", "phinisi", "private"]
  },
  {
    slug: "jakare",
    name: "Jakare",
    region: "Komodo",
    tier: "Explorer",
    maxGuests: 14,
    cabins: 5,
    priceSignal: "from USD 980 per cabin",
    charterPriceSignal: "from USD 4,900 private charter",
    operatorId: "operator_jakare",
    operatorName: "Jakare",
    operatorPhone: "+6281234567008",
    productUrl: "https://bluepass.co/yachts/jakare",
    imageUrl: "https://bluepass.co/yachts/jakare/hero.jpg",
    interests: ["dive", "phinisi", "explorer", "cabin"]
  },
  {
    slug: "katharina",
    name: "Katharina",
    region: "Komodo",
    tier: "Premium",
    maxGuests: 12,
    cabins: 6,
    priceSignal: "from USD 887 per cabin",
    charterPriceSignal: "from USD 4,250 private charter",
    operatorId: "operator_katharina",
    operatorName: "Katharina",
    operatorPhone: "+6281234567009",
    productUrl: "https://bluepass.co/yachts/katharina",
    imageUrl: "https://bluepass.co/yachts/katharina/hero.jpg",
    interests: ["dive", "phinisi", "cabin"]
  },
  {
    slug: "mischief",
    name: "Mischief",
    region: "Komodo",
    tier: "Premium",
    maxGuests: 6,
    cabins: 3,
    priceSignal: "from USD 2,667 per cabin",
    charterPriceSignal: "from USD 8,000 private charter",
    operatorId: "operator_mischief",
    operatorName: "Mischief",
    operatorPhone: "+6281234567010",
    productUrl: "https://bluepass.co/yachts/mischief",
    imageUrl: "https://bluepass.co/yachts/mischief/hero.jpg",
    interests: ["private", "luxury", "phinisi"]
  },
  {
    slug: "mutiara-laut",
    name: "Mutiara Laut",
    region: "Komodo",
    tier: "Premium",
    maxGuests: 10,
    cabins: 5,
    priceSignal: "from USD 1,929 per cabin",
    charterPriceSignal: "from USD 13,500 private charter",
    operatorId: "operator_mutiara_laut",
    operatorName: "Mutiara Laut",
    operatorPhone: "+6281234567011",
    productUrl: "https://bluepass.co/yachts/mutiara-laut",
    imageUrl: "https://bluepass.co/yachts/mutiara-laut/hero.jpg",
    interests: ["dive", "phinisi", "private"]
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
    productUrl: "https://bluepass.co/yachts/aliikai",
    imageUrl: "https://bluepass.co/yachts/aliikai/hero.jpg",
    interests: ["dive", "phinisi", "cabin"]
  },
  {
    slug: "carpe-diem",
    name: "Carpe Diem",
    region: "Raja Ampat",
    tier: "Explorer",
    maxGuests: 12,
    cabins: 6,
    priceSignal: "from USD 885 per cabin",
    charterPriceSignal: "from USD 8,580 private charter",
    operatorId: "operator_carpe_diem",
    operatorName: "Carpe Diem",
    operatorPhone: "+6281234567012",
    productUrl: "https://bluepass.co/yachts/carpe-diem",
    imageUrl: "https://bluepass.co/yachts/carpe-diem/hero.jpg",
    interests: ["dive", "phinisi", "explorer", "cabin"]
  },
  {
    slug: "fenides",
    name: "Fenides",
    region: "Raja Ampat",
    tier: "Premium",
    maxGuests: 11,
    cabins: 5,
    priceSignal: "from USD 815 per cabin",
    charterPriceSignal: "from USD 8,580 private charter",
    operatorId: "operator_fenides",
    operatorName: "Fenides",
    operatorPhone: "+6281234567013",
    productUrl: "https://bluepass.co/yachts/fenides",
    imageUrl: "https://bluepass.co/yachts/fenides/hero.jpg",
    interests: ["dive", "phinisi", "cabin"]
  },
  {
    slug: "majik",
    name: "Majik",
    region: "Raja Ampat",
    tier: "Explorer",
    maxGuests: 8,
    cabins: 4,
    priceSignal: "from USD 1,425 per cabin",
    charterPriceSignal: "from USD 5,700 private charter",
    operatorId: "operator_majik",
    operatorName: "Majik",
    operatorPhone: "+6281234567014",
    productUrl: "https://bluepass.co/yachts/majik",
    imageUrl: "https://bluepass.co/yachts/majik/hero.jpg",
    interests: ["dive", "private", "explorer"]
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
    productUrl: "https://bluepass.co/yachts/amandira",
    imageUrl: "https://bluepass.co/yachts/amandira/hero.jpg",
    interests: ["dive", "luxury", "private"]
  }
];

export function searchBluePassYachts(
  intent: BluePassYachtSearchIntent,
  catalogInput?: BluePassCatalogSnapshotItem[],
  limit = 3
) {
  return resolveBluePassCatalog(catalogInput)
    .map((item, catalogIndex) => {
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
        truth: previewTruth,
        catalogIndex
      } satisfies BluePassYachtCard & { catalogIndex: number };
    })
    .sort((a, b) => b.score - a.score || a.catalogIndex - b.catalogIndex || b.maxGuests - a.maxGuests)
    .slice(0, limit)
    .map(({ catalogIndex: _catalogIndex, ...item }) => item);
}

export function findBluePassYachtBySlug(slug?: string | null, catalogInput?: BluePassCatalogSnapshotItem[]) {
  return slug ? resolveBluePassCatalog(catalogInput).find((item) => item.slug === slug) ?? null : null;
}

export function findBluePassAlternativeYachts(
  intent: BluePassAlternativeYachtInput,
  catalogInput?: BluePassCatalogSnapshotItem[]
) {
  return searchBluePassYachts(
    {
      destination: intent.destination,
      guests: intent.guests,
      interests: intent.interests
    },
    catalogInput
  )
    .filter((item) => item.slug !== intent.declinedYachtSlug)
    .filter((item) => (intent.destination ? item.region.toLowerCase().includes(intent.destination.toLowerCase()) : true))
    .filter((item) => (intent.guests ? item.maxGuests >= intent.guests : true))
    .slice(0, 3);
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
        imageUrl: item.imageUrl?.trim() || null,
        interests: Array.isArray(item.interests) ? item.interests.filter(Boolean) : [],
        cabinBookable: item.cabinBookable,
        about: item.about ?? null,
        departuresPreview: Array.isArray(item.departuresPreview) ? item.departuresPreview.filter(Boolean) : []
      } satisfies BluePassYachtCatalogItem;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

// Keeps the existing Komodo/Raja Ampat spelling-variant normalization (Labuan Bajo, Flores,
// Misool, Sorong all still canonicalize), but passes through anything else instead of returning
// null - a null here used to silently drop the entire catalog item (see the !region check above),
// which is exactly what discarded any non-Indonesia region (e.g. "Great Barrier Reef") before.
function normalizeRegion(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/komodo|labuan bajo|flores/i.test(trimmed)) return "Komodo";
  if (/raja\s*ampat|misool|sorong/i.test(trimmed)) return "Raja Ampat";
  return trimmed;
}
