import { describe, expect, it } from "vitest";
import type { PmsProduct } from "@/core/pms/types";
import { updateBookingMemoryState } from "./booking-memory";

const products: PmsProduct[] = [
  {
    externalProductId: "mock-private-charter",
    title: "Private Charter",
    description: "A custom charter that requires operator confirmation.",
    bookingMode: "MANUAL_INQUIRY"
  }
];

describe("booking memory", () => {
  it("stores matched product, date, and guests as structured state", () => {
    const state = updateBookingMemoryState({
      previousState: null,
      message: "private boat for 2 guests tomorrow",
      products
    });

    expect(state).toEqual({
      productExternalId: "mock-private-charter",
      productTitle: "Private Charter",
      dateText: "tomorrow",
      guests: 2
    });
  });

  it("keeps prior product while filling missing date and guests", () => {
    const state = updateBookingMemoryState({
      previousState: {
        productExternalId: "mock-private-charter",
        productTitle: "Private Charter",
        dateText: null,
        guests: null
      },
      message: "tomorrow for 2 people",
      products
    });

    expect(state).toEqual({
      productExternalId: "mock-private-charter",
      productTitle: "Private Charter",
      dateText: "tomorrow",
      guests: 2
    });
  });
});
