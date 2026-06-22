import type { PmsProvider } from "@/core/tenant/types";

export interface PmsProduct {
  externalProductId: string;
  title: string;
  description: string;
  bookingMode: "MANUAL_INQUIRY" | "AUTO_BOOKING";
  productUrl?: string | null;
}

export interface PmsAvailabilityRequest {
  productId: string;
  date: string;
  guests: number;
}

export interface PmsAvailabilityResult {
  productId: string;
  date: string;
  available: boolean;
  remaining: number;
  currency: string;
  unitPriceCents: number;
  ticketOptions?: PmsTicketOption[];
}

export interface PmsTicketOption {
  label: string;
  unitPriceCents: number;
}

export interface PmsTicketQuantity {
  optionLabel: string;
  quantity: number;
}

export interface PmsCreateBookingRequest {
  productId: string;
  date: string;
  guests: number;
  travellerName: string;
  travellerEmail: string;
  travellerPhone?: string | null;
  ticketQuantities?: PmsTicketQuantity[] | null;
}

export interface PmsCreateBookingResult {
  externalBookingId: string;
  provider: PmsProvider;
  status: "CONFIRMED" | "PENDING" | "FAILED";
}

export interface PmsAdapter {
  provider: PmsProvider;
  listProducts(): Promise<PmsProduct[]>;
  getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult>;
  createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult>;
  cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }>;
  getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null>;
}
