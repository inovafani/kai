import { analyzeTravellerBookingMessage } from "./booking-brain";
import { matchPmsProduct } from "./product-matcher";
import type { PmsProduct } from "@/core/pms/types";

export interface BookingMemoryState {
  productExternalId: string | null;
  productTitle: string | null;
  dateText: string | null;
  guests: number | null;
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

  return {
    productExternalId:
      matchedProduct?.externalProductId ?? input.previousState?.productExternalId ?? null,
    productTitle: matchedProduct?.title ?? input.previousState?.productTitle ?? null,
    dateText: analysis.slots.dateText ?? input.previousState?.dateText ?? null,
    guests: analysis.slots.guests ?? input.previousState?.guests ?? null
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
