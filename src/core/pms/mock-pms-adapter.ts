import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsExtraOption,
  PmsProduct
} from "./types";

export type MockPmsCatalog = "komodo" | "boattime" | "australia";

type MockPmsProduct = PmsProduct & {
  capacity: number;
  currency: string;
  unitPriceCents: number;
  extraOptions?: PmsExtraOption[];
};

const catalogProducts: Record<MockPmsCatalog, MockPmsProduct[]> = {
  // Australia is the launch market - the general AU reef/charter catalog, used as the
  // default for AU tenants. Whole-boat charter is MANUAL_INQUIRY (quote over WhatsApp/SMS).
  australia: [
    {
      externalProductId: "au-gbr-reef-day-trip",
      title: "Great Barrier Reef Day Trip",
      description: "A full-day outer reef snorkel and dive trip from Cairns.",
      bookingMode: "AUTO_BOOKING",
      capacity: 30,
      currency: "AUD",
      unitPriceCents: 21500
    },
    {
      externalProductId: "au-whitsundays-sailing-day",
      title: "Whitsundays Sailing Day",
      description: "A day sailing the Whitsundays with a stop at Whitehaven Beach.",
      bookingMode: "AUTO_BOOKING",
      capacity: 20,
      currency: "AUD",
      unitPriceCents: 24900
    },
    {
      externalProductId: "au-ningaloo-whale-shark-swim",
      title: "Ningaloo Whale Shark Swim",
      description: "A guided swim with whale sharks on Ningaloo Reef from Exmouth.",
      bookingMode: "AUTO_BOOKING",
      capacity: 20,
      currency: "AUD",
      unitPriceCents: 42500
    },
    {
      externalProductId: "au-reef-dive-trip",
      title: "Reef Dive Trip",
      description: "A guided two-dive day on the reef for certified divers.",
      bookingMode: "AUTO_BOOKING",
      capacity: 16,
      currency: "AUD",
      unitPriceCents: 27900
    },
    {
      externalProductId: "au-whole-boat-charter",
      title: "Whole-Boat Charter",
      description: "A private whole-boat charter for groups, quoted by the operator.",
      bookingMode: "MANUAL_INQUIRY",
      capacity: 0,
      currency: "AUD",
      unitPriceCents: 0
    }
  ],
  komodo: [
    {
      externalProductId: "mock-komodo-day-trip",
      title: "Komodo Day Trip",
      description: "A shared day trip with auto-booking.",
      bookingMode: "AUTO_BOOKING",
      capacity: 10,
      currency: "USD",
      unitPriceCents: 18500
    },
    {
      externalProductId: "mock-private-charter",
      title: "Private Charter",
      description: "A custom charter that requires operator confirmation.",
      bookingMode: "MANUAL_INQUIRY",
      capacity: 0,
      currency: "USD",
      unitPriceCents: 0
    },
    {
      externalProductId: "mock-reef-day-snorkel",
      title: "Reef Day Snorkel",
      description: "A guided snorkeling tour over bright reef sites.",
      bookingMode: "AUTO_BOOKING",
      capacity: 10,
      currency: "USD",
      unitPriceCents: 8500
    }
  ],
  boattime: [
    {
      externalProductId: "boattime-whale-escape",
      title: "Gold Coast Whale Escape",
      description: "A luxury whale watching cruise on the Gold Coast.",
      bookingMode: "AUTO_BOOKING",
      capacity: 24,
      currency: "AUD",
      unitPriceCents: 9900,
      extraOptions: [
        { label: "Corona Bucket", unitPriceCents: 3000 },
        { label: "Sparkling for 2", unitPriceCents: 4000 },
        { label: "Cheese Platter for 2", unitPriceCents: 1000 }
      ]
    },
    {
      externalProductId: "boattime-private-yacht-charter",
      title: "Private Yacht Charter",
      description: "A private yacht charter for tailored celebrations and groups.",
      bookingMode: "MANUAL_INQUIRY",
      capacity: 0,
      currency: "AUD",
      unitPriceCents: 0
    },
    {
      externalProductId: "boattime-corporate-charter",
      title: "Corporate Charter",
      description: "A private charter package for corporate events and client hosting.",
      bookingMode: "MANUAL_INQUIRY",
      capacity: 0,
      currency: "AUD",
      unitPriceCents: 0
    },
    {
      externalProductId: "boattime-wedding-charter",
      title: "Wedding Yacht Charter",
      description: "A private yacht experience for wedding celebrations.",
      bookingMode: "MANUAL_INQUIRY",
      capacity: 0,
      currency: "AUD",
      unitPriceCents: 0
    },
    {
      externalProductId: "boattime-twilight-drift",
      title: "Twilight Drift",
      description: "A relaxed sunset cruise experience on the Broadwater.",
      bookingMode: "AUTO_BOOKING",
      capacity: 18,
      currency: "AUD",
      unitPriceCents: 7900
    },
    {
      externalProductId: "boattime-coastal-lunch-escape",
      title: "Coastal Lunch Escape",
      description: "A lunch cruise package for travellers looking for a daytime escape.",
      bookingMode: "AUTO_BOOKING",
      capacity: 18,
      currency: "AUD",
      unitPriceCents: 12900
    },
    {
      externalProductId: "boattime-broadwater-twilight-dining",
      title: "Broadwater Twilight Dining",
      description: "A twilight dining cruise on the Gold Coast Broadwater.",
      bookingMode: "AUTO_BOOKING",
      capacity: 18,
      currency: "AUD",
      unitPriceCents: 14900
    }
  ]
};

function toPublicProduct(product: MockPmsProduct): PmsProduct {
  return {
    externalProductId: product.externalProductId,
    title: product.title,
    description: product.description,
    bookingMode: product.bookingMode
  };
}

export class MockPmsAdapter implements PmsAdapter {
  provider = "MOCK" as const;

  constructor(private readonly catalog: MockPmsCatalog = "komodo") {}

  async listProducts(): Promise<PmsProduct[]> {
    return catalogProducts[this.catalog].map(toPublicProduct);
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    const product = catalogProducts[this.catalog].find((item) => item.externalProductId === request.productId);

    if (!product) {
      return {
        productId: request.productId,
        date: request.date,
        available: false,
        remaining: 0,
        currency: this.catalog === "komodo" ? "USD" : "AUD",
        unitPriceCents: 0
      };
    }

    const remaining = product.bookingMode === "AUTO_BOOKING" ? product.capacity - request.guests : 0;

    return {
      productId: request.productId,
      date: request.date,
      available: remaining >= 0 && product.bookingMode === "AUTO_BOOKING",
      remaining: Math.max(remaining, 0),
      currency: product.currency,
      unitPriceCents: product.unitPriceCents,
      ...(product.extraOptions ? { extraOptions: product.extraOptions } : {})
    };
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    const availability = await this.getAvailability(request);

    if (!availability.available) {
      return {
        externalBookingId: "",
        provider: this.provider,
        status: "FAILED"
      };
    }

    return {
      externalBookingId: `mock-booking-${request.productId}-${request.date}-${request.guests}`,
      provider: this.provider,
      status: "CONFIRMED"
    };
  }

  async cancelBooking(_externalBookingId: string): Promise<{ cancelled: boolean }> {
    return { cancelled: true };
  }

  async getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null> {
    if (!externalBookingId.startsWith("mock-booking-")) {
      return null;
    }

    return {
      externalBookingId,
      provider: this.provider,
      status: "CONFIRMED"
    };
  }
}
