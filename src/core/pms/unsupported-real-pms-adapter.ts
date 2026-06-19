import type {
  PmsAdapter,
  PmsAvailabilityRequest,
  PmsAvailabilityResult,
  PmsCreateBookingRequest,
  PmsCreateBookingResult,
  PmsProduct
} from "./types";
import type { PmsProvider } from "@/core/tenant/types";

export const REAL_PMS_NOT_CONNECTED_MESSAGE =
  "Real PMS adapter is configured but credentials/API mapping are not connected yet.";

export abstract class UnsupportedRealPmsAdapter implements PmsAdapter {
  abstract provider: PmsProvider;

  protected notConnected(): never {
    throw new Error(REAL_PMS_NOT_CONNECTED_MESSAGE);
  }

  async listProducts(): Promise<PmsProduct[]> {
    this.notConnected();
  }

  async getAvailability(_request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult> {
    this.notConnected();
  }

  async createBooking(_request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult> {
    this.notConnected();
  }

  async cancelBooking(_externalBookingId: string): Promise<{ cancelled: boolean }> {
    this.notConnected();
  }

  async getBooking(_externalBookingId: string): Promise<PmsCreateBookingResult | null> {
    this.notConnected();
  }
}
