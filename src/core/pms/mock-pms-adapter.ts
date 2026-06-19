import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct
} from "./types";

const PRODUCTS: PmsProduct[] = [
  {
    externalProductId: "mock-komodo-day-trip",
    title: "Komodo Day Trip",
    description: "A shared day trip with instant booking.",
    bookingMode: "INSTANT_BOOKING"
  },
  {
    externalProductId: "mock-private-charter",
    title: "Private Charter",
    description: "A custom charter that requires operator confirmation.",
    bookingMode: "MANUAL_INQUIRY"
  },
  {
    externalProductId: "mock-reef-day-snorkel",
    title: "Reef Day Snorkel",
    description: "A guided snorkeling tour over bright reef sites.",
    bookingMode: "INSTANT_BOOKING"
  }
];

export class MockPmsAdapter implements PmsAdapter {
  provider = "MOCK" as const;

  async listProducts(): Promise<PmsProduct[]> {
    return PRODUCTS;
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    const product = PRODUCTS.find((item) => item.externalProductId === request.productId);

    if (!product) {
      return {
        productId: request.productId,
        date: request.date,
        available: false,
        remaining: 0,
        currency: "USD",
        unitPriceCents: 0
      };
    }

    const remaining = product.bookingMode === "INSTANT_BOOKING" ? 10 - request.guests : 0;

    return {
      productId: request.productId,
      date: request.date,
      available: remaining >= 0 && product.bookingMode === "INSTANT_BOOKING",
      remaining: Math.max(remaining, 0),
      currency: "USD",
      unitPriceCents:
        product.externalProductId === "mock-komodo-day-trip"
          ? 18500
          : product.externalProductId === "mock-reef-day-snorkel"
            ? 8500
            : 0
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
