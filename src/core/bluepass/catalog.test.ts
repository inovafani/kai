import { describe, expect, it } from "vitest";
import { searchBluePassYachts } from "./catalog";

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
});
