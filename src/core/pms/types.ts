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
  timeOptions?: PmsTimeOption[];
  ticketOptions?: PmsTicketOption[];
  extraOptions?: PmsExtraOption[];
}

export interface PmsTimeOption {
  label: string;
  startTimeLocal: string;
  remaining: number;
  checkoutItemKey?: string;
  checkoutSessionId?: string;
}

export interface PmsTicketOption {
  label: string;
  unitPriceCents: number;
}

export interface PmsTicketQuantity {
  optionLabel: string;
  quantity: number;
}

export interface PmsExtraOption {
  label: string;
  unitPriceCents: number;
}

export interface PmsExtraQuantity {
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
  extraQuantities?: PmsExtraQuantity[] | null;
  paymentCardToken?: string | null;
  confirmationMode?: "CONFIRM_NOW" | "PAYMENT_HOLD";
}

export interface PmsCreateBookingResult {
  externalBookingId: string;
  provider: PmsProvider;
  status: "CONFIRMED" | "PENDING" | "FAILED";
  paymentUrl?: string | null;
}

export interface PmsAdapter {
  provider: PmsProvider;
  listProducts(): Promise<PmsProduct[]>;
  getAvailability(request: PmsAvailabilityRequest): Promise<PmsAvailabilityResult>;
  createBooking(request: PmsCreateBookingRequest): Promise<PmsCreateBookingResult>;
  cancelBooking(externalBookingId: string): Promise<{ cancelled: boolean }>;
  getBooking(externalBookingId: string): Promise<PmsCreateBookingResult | null>;
}
