import { analyzeTravellerBookingMessage } from "./booking-brain";
import type { BookingFlowStatus } from "./booking-state-machine";
import { matchPmsProduct } from "./product-matcher";
import type { PmsProduct, PmsTicketOption, PmsTicketQuantity } from "@/core/pms/types";

export interface BookingMemoryState {
  productExternalId: string | null;
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
  travellerName?: string | null;
  travellerEmail?: string | null;
  travellerPhone?: string | null;
  bookingStatus?: BookingFlowStatus | null;
  confirmationSummary?: string | null;
  externalBookingId?: string | null;
  externalProvider?: string | null;
  bookingError?: string | null;
  ticketOptions?: PmsTicketOption[] | null;
  ticketQuantities?: PmsTicketQuantity[] | null;
}

export interface UpdateBookingMemoryStateInput {
  previousState: BookingMemoryState | null;
  message: string;
  products: PmsProduct[];
}

export function updateBookingMemoryState(input: UpdateBookingMemoryStateInput): BookingMemoryState {
  const analysis = analyzeTravellerBookingMessage(input.message);
  const productMatch = matchPmsProduct(input.message, input.products);
  const matchedProduct = productMatch.status === "MATCHED" ? productMatch.product : null;
  const ticketState = {
    ...(input.previousState?.ticketOptions ? { ticketOptions: input.previousState.ticketOptions } : {}),
    ...(input.previousState?.ticketQuantities
      ? { ticketQuantities: input.previousState.ticketQuantities }
      : {})
  };

  return {
    productExternalId:
      matchedProduct?.externalProductId ?? input.previousState?.productExternalId ?? null,
    productTitle: matchedProduct?.title ?? input.previousState?.productTitle ?? null,
    dateText: analysis.slots.dateText ?? input.previousState?.dateText ?? null,
    guests: analysis.slots.guests ?? input.previousState?.guests ?? null,
    travellerName: input.previousState?.travellerName ?? null,
    travellerEmail: input.previousState?.travellerEmail ?? null,
    travellerPhone: input.previousState?.travellerPhone ?? null,
    bookingStatus: input.previousState?.bookingStatus ?? "DRAFT",
    confirmationSummary: input.previousState?.confirmationSummary ?? null,
    externalBookingId: input.previousState?.externalBookingId ?? null,
    externalProvider: input.previousState?.externalProvider ?? null,
    bookingError: input.previousState?.bookingError ?? null,
    ...ticketState
  };
}

export function bookingMemoryToContext(state: BookingMemoryState | null) {
  if (!state) {
    return "";
  }

  return [
    state.productTitle,
    state.dateText,
    state.guests ? `${state.guests} guests` : null
  ]
    .filter(Boolean)
    .join(" ");
}
