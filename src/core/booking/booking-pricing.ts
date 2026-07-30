import type { PmsExtraOption, PmsExtraQuantity, PmsTicketOption, PmsTicketQuantity } from "@/core/pms/types";

export interface BookingGrossAmountResult {
  grossAmountCents: number;
  resolvedTicketQuantities: PmsTicketQuantity[];
}

// Neither BookingFlowState nor BookingCaptureDetails store a computed total anywhere - only
// per-option unit prices (ticketOptions/extraOptions) and separate quantities. This joins them
// into a chargeable amount for a real Stripe charge, so it deliberately fails closed (returns
// null) on anything ambiguous rather than risk under/over-charging a traveller.
export function calculateBookingGrossAmountCents(input: {
  guests: number | null;
  ticketOptions?: PmsTicketOption[] | null;
  ticketQuantities?: PmsTicketQuantity[] | null;
  extraOptions?: PmsExtraOption[] | null;
  extraQuantities?: PmsExtraQuantity[] | null;
}): BookingGrossAmountResult | null {
  const ticketOptions = input.ticketOptions ?? [];
  let resolvedTicketQuantities = input.ticketQuantities ?? [];

  if (resolvedTicketQuantities.length === 0) {
    if (ticketOptions.length !== 1 || !input.guests) return null;
    resolvedTicketQuantities = [{ optionLabel: ticketOptions[0].label, quantity: input.guests }];
  }

  let grossAmountCents = 0;

  for (const quantity of resolvedTicketQuantities) {
    const option = ticketOptions.find((candidate) => candidate.label === quantity.optionLabel);
    if (!option) return null;
    grossAmountCents += option.unitPriceCents * quantity.quantity;
  }

  const extraOptions = input.extraOptions ?? [];
  for (const quantity of input.extraQuantities ?? []) {
    const option = extraOptions.find((candidate) => candidate.label === quantity.optionLabel);
    if (!option) continue;
    grossAmountCents += option.unitPriceCents * quantity.quantity;
  }

  return { grossAmountCents, resolvedTicketQuantities };
}
