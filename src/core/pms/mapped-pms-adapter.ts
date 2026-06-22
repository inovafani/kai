import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct
} from "./types";

export interface PublicProductMapping {
  publicTitle: string;
  publicDescription?: string;
  productUrl?: string;
  pmsProductId: string;
  bookingMode?: "MANUAL_INQUIRY" | "AUTO_BOOKING";
}

export class MappedPmsAdapter implements PmsAdapter {
  provider;

  constructor(
    private readonly sourceAdapter: PmsAdapter,
    private readonly mappings: PublicProductMapping[]
  ) {
    this.provider = sourceAdapter.provider;
  }

  async listProducts(): Promise<PmsProduct[]> {
    return this.mappings.map((mapping) => ({
      externalProductId: mapping.pmsProductId,
      title: mapping.publicTitle,
      description: mapping.publicDescription ?? "",
      productUrl: mapping.productUrl ?? null,
      bookingMode: mapping.bookingMode ?? "AUTO_BOOKING"
    }));
  }

  async getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    return this.sourceAdapter.getAvailability(request);
  }

  async createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    return this.sourceAdapter.createBooking(request);
  }

  async cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }> {
    return this.sourceAdapter.cancelBooking(externalBookingId);
  }

  async getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null> {
    return this.sourceAdapter.getBooking(externalBookingId);
  }
}
