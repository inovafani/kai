import { describe, expect, it } from "vitest";
import {
  parsePublicProductCatalog,
  parsePublicProductCatalogJson,
  parsePublicProductCatalogRows
} from "./public-product-catalog";

describe("public product catalog parsing", () => {
  it("keeps only valid website-to-PMS product mappings", () => {
    expect(
      parsePublicProductCatalog([
        {
          publicTitle: "Gold Coast Whale Escape",
          publicDescription: "Luxury whale watching",
          pmsProductId: "P123",
          productUrl: "https://tenant.example/whale",
          bookingMode: "AUTO_BOOKING"
        },
        { publicTitle: "", pmsProductId: "P124" },
        { publicTitle: "Missing PMS id" }
      ])
    ).toEqual([
      {
        publicTitle: "Gold Coast Whale Escape",
        publicDescription: "Luxury whale watching",
        pmsProductId: "P123",
        productUrl: "https://tenant.example/whale",
        bookingMode: "AUTO_BOOKING"
      }
    ]);
  });

  it("normalizes legacy instant booking mappings to auto-booking", () => {
    expect(
      parsePublicProductCatalog([{ publicTitle: "Legacy Tour", pmsProductId: "P124", bookingMode: "INSTANT_BOOKING" }])
    ).toEqual([
      {
        publicTitle: "Legacy Tour",
        publicDescription: "",
        pmsProductId: "P124",
        bookingMode: "AUTO_BOOKING"
      }
    ]);
  });

  it("parses JSON from the admin settings textarea", () => {
    expect(
      parsePublicProductCatalogJson(
        JSON.stringify([{ publicTitle: "Private Charter", pmsProductId: "P999", bookingMode: "MANUAL_INQUIRY" }])
      )
    ).toEqual([
      {
        publicTitle: "Private Charter",
        publicDescription: "",
        pmsProductId: "P999",
        bookingMode: "MANUAL_INQUIRY"
      }
    ]);
  });

  it("parses row-based admin product mapping fields", () => {
    expect(
      parsePublicProductCatalogRows({
        publicTitles: ["Gold Coast Whale Escape", "", "Private Yacht Charter"],
        publicDescriptions: ["Luxury whale watching", "ignored", "Tailored private charter"],
        productUrls: ["https://tenant.example/whale", "https://tenant.example/ignored", ""],
        pmsProductIds: ["PGG8QT", "P-empty", "boattime-private-yacht-charter"],
        bookingModes: ["AUTO_BOOKING", "AUTO_BOOKING", "MANUAL_INQUIRY"]
      })
    ).toEqual([
      {
        publicTitle: "Gold Coast Whale Escape",
        publicDescription: "Luxury whale watching",
        pmsProductId: "PGG8QT",
        productUrl: "https://tenant.example/whale",
        bookingMode: "AUTO_BOOKING"
      },
      {
        publicTitle: "Private Yacht Charter",
        publicDescription: "Tailored private charter",
        pmsProductId: "boattime-private-yacht-charter",
        bookingMode: "MANUAL_INQUIRY"
      }
    ]);
  });
});
