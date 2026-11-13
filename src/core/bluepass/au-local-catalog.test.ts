import { describe, expect, it } from "vitest";
import { buildAuLocalCatalogLead } from "./au-local-catalog";

const boat = (slug: string, name: string, region: string, maxGuests: number) =>
  ({ slug, name, region, tier: "Charter", maxGuests, cabins: 0, priceSignal: "Quote on request", operatorId: `op_${slug}`, productUrl: null }) as any;

const catalog = [
  boat("alani", "Alani", "Hamilton Island, Whitsundays", 35),
  boat("yolo", "Yolo", "Gold Coast", 36),
  boat("komodo-boat", "Komodo Boat", "Komodo", 10)
];
const input = { catalog, operatorName: "Boattime Yacht Charters", operatorSlug: "boattime" };

describe("Australian chat: what comes before the live operator's lineup", () => {
  it("shows catalogue boats in the named place as information, then labels the live lineup", () => {
    const lead = buildAuLocalCatalogLead({ ...input, message: "Looking for a sunset charter in the Whitsundays" })!;

    expect(lead).toContain("Alani - Charter in Hamilton Island, Whitsundays, up to 35 guests");
    expect(lead).toContain("for information only");
    expect(lead).toContain("I can't check availability or book these from here");
    expect(lead).toContain("Boattime Yacht Charters, who runs from the Gold Coast");
    expect(lead).not.toContain("Yolo");
    expect(lead).not.toContain("Komodo");
  });

  it("says the lineup is from somewhere else when nothing is listed in the named place", () => {
    const lead = buildAuLocalCatalogLead({ ...input, message: "Great Barrier Reef trip for 4" });

    expect(lead).toBe("I don't have anything listed in Great Barrier Reef yet. Boattime Yacht Charters runs from the Gold Coast.");
  });

  it("adds nothing when no place is named, or when the lineup already is the place", () => {
    expect(buildAuLocalCatalogLead({ ...input, message: "what can I book for Saturday?" })).toBeNull();
    expect(buildAuLocalCatalogLead({ ...input, catalog: [catalog[0]], message: "Gold Coast for 2" })).toBeNull();
  });
});
