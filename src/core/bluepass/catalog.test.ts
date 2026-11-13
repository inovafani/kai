import { describe, expect, it } from "vitest";
import { findBluePassAlternativeYachts, searchBluePassYachts } from "./catalog";

describe("catalog snapshot links", () => {
  const item = { slug: "x", name: "X", region: "Komodo", operatorId: "o" } as any;

  it("drops the dead /yachts/ route but keeps any other link", () => {
    const [dead, absolute, ok] = [
      "https://bluepass.co/yachts/alexa",
      "/yachts/alexa",
      "https://example.com/trip"
    ].map((productUrl) => searchBluePassYachts({ destination: "Komodo" }, [{ ...item, productUrl }])[0].productUrl);

    expect(dead).toBeNull();
    expect(absolute).toBeNull();
    expect(ok).toBe("https://example.com/trip");
  });
});

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
    // Not a strict first > last: several Komodo yachts (alila-purnama, calico-jack, anne-bonny,
    // celestia, dunia-baru, jakare, katharina, mutiara-laut) all fit >=8 guests and match "dive",
    // so they legitimately tie on score - catalogIndex is what makes the order deterministic, not
    // the score itself. What actually matters is that scores never increase down the ranked list.
    expect(results.every((result, i) => i === 0 || result.score <= results[i - 1].score)).toBe(true);
  });

  // kai-conservation-flow-notes.md item 10: budget was parsed but never applied - a traveller who
  // said "budget about $500 each" got quoted $8,580+ boats with no filtering. Additive score boost,
  // not a hard filter, so a budget nobody fits still returns the existing top matches rather than an
  // empty list.
  it("scores yachts that fit a stated USD budget higher, without ever excluding the rest", () => {
    // Alila Purnama is "from USD 3,000 per cabin" (catalog.ts) - comfortably inside a 5,000 budget.
    const withinBudget = searchBluePassYachts({
      destination: "Komodo",
      selectedYachtSlug: "alila-purnama",
      budget: { currency: "USD", amount: 5000 }
    });
    const alilaWithBudget = withinBudget.find((yacht) => yacht.slug === "alila-purnama");
    expect(alilaWithBudget?.reasons).toContain("within budget");

    // Same yacht, budget too low to fit - no false "within budget" claim, but still returned (the
    // selectedYachtSlug bonus keeps it in the results either way).
    const overBudget = searchBluePassYachts({
      destination: "Komodo",
      selectedYachtSlug: "alila-purnama",
      budget: { currency: "USD", amount: 100 }
    });
    const alilaOverBudget = overBudget.find((yacht) => yacht.slug === "alila-purnama");
    expect(alilaOverBudget?.reasons).not.toContain("within budget");
    expect(alilaOverBudget?.score).toBeLessThan(alilaWithBudget!.score);
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
