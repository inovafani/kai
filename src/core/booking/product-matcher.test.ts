import { describe, expect, it } from "vitest";
import type { PmsProduct } from "@/core/pms/types";
import { matchPmsProduct } from "./product-matcher";

const products: PmsProduct[] = [
  {
    externalProductId: "mock-komodo-day-trip",
    title: "Komodo Day Trip",
    description: "A shared day trip with auto-booking.",
    bookingMode: "AUTO_BOOKING"
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
    bookingMode: "AUTO_BOOKING"
  }
];

describe("product matcher", () => {
  it("matches product aliases from title and description words", () => {
    expect(matchPmsProduct("private boat for 2 guests tomorrow", products)).toMatchObject({
      status: "MATCHED",
      product: {
        externalProductId: "mock-private-charter"
      }
    });

    expect(matchPmsProduct("snorkeling for 2 people tomorrow", products)).toMatchObject({
      status: "MATCHED",
      product: {
        externalProductId: "mock-reef-day-snorkel"
      }
    });
  });

  it("returns ambiguous when only generic tour language is present", () => {
    expect(matchPmsProduct("tour for 2 guests tomorrow", products)).toEqual({
      status: "AMBIGUOUS",
      products
    });
  });

  it("returns no match when there are no meaningful product signals", () => {
    expect(matchPmsProduct("airport pickup tomorrow", products)).toEqual({
      status: "NO_MATCH",
      products
    });
  });
});
