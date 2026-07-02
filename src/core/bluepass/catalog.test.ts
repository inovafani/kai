import { describe, expect, it } from "vitest";
import { findBluePassAlternativeYachts, searchBluePassYachts } from "./catalog";

describe("searchBluePassYachts", () => {
  it("returns ranked preview catalog matches with truth labels", () => {
    const results = searchBluePassYachts({
      destination: "Komodo",
      guests: 8,
      interests: ["dive"]
    });

    expect(results[0]).toMatchObject({
      slug: "alila-purnama",
      name: "Alila Purnama",
      region: "Komodo",
      truth: {
        availabilitySource: "preview_catalog",
        priceSource: "preview_catalog",
        bookingConfirmationSource: "operator_admin"
      }
    });
    expect(results[0].score).toBeGreaterThan(results.at(-1)?.score ?? 0);
  });

  it("recommends similar alternatives after an operator decline without reusing the declined yacht", () => {
    const results = findBluePassAlternativeYachts({
      destination: "Komodo",
      guests: 4,
      declinedYachtSlug: "calico-jack"
    });

    expect(results.map((result) => result.slug)).toContain("alila-purnama");
    expect(results.map((result) => result.slug)).not.toContain("calico-jack");
    expect(results.every((result) => result.region === "Komodo")).toBe(true);
    expect(results.every((result) => result.maxGuests >= 4)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
