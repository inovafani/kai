import { describe, expect, it } from "vitest";
import {
  buildAffiliateTripListReply,
  buildAffiliateTripReply,
  decideAffiliateTurn,
  isAffiliateBookingUrl,
  matchAffiliateTrips,
  parseAffiliateTrips,
  type AffiliateTrip
} from "./affiliate-trips";

const reef: AffiliateTrip = {
  slug: "outer-reef-day",
  title: "Outer Reef Day",
  operatorName: "Reef Magic",
  region: "Great Barrier Reef",
  category: "Dive",
  description: "A full day on the outer reef from Cairns. Snorkel gear included. Lunch on board.",
  priceSignal: "From AUD 249",
  bookingPlatform: "FAREHARBOR",
  bookingUrl: "https://fareharbor.com/embeds/book/reefmagic/items/1/"
};
const whales: AffiliateTrip = {
  slug: "hervey-bay-whales",
  title: "Hervey Bay Whale Watch",
  operatorName: "Tasman Venture",
  region: "Hervey Bay",
  category: "Wildlife",
  description: "Half a day with humpback whales.",
  priceSignal: "From AUD 135",
  bookingPlatform: "REZDY",
  bookingUrl: "https://tasmanventure.rezdy.com/123/whale-watch"
};
const sail: AffiliateTrip = {
  slug: "whitsundays-sail",
  title: "Whitehaven Sail",
  operatorName: "Ocean Rafting",
  region: "Whitsundays",
  category: "Sail & Yacht",
  description: "Sail to Whitehaven Beach.",
  priceSignal: null,
  bookingPlatform: "FAREHARBOR",
  bookingUrl: "https://fareharbor.com/embeds/book/oceanrafting/"
};
const trips = [reef, whales, sail];

describe("isAffiliateBookingUrl", () => {
  it("only trusts https links on the platform's own domain", () => {
    expect(isAffiliateBookingUrl("FAREHARBOR", reef.bookingUrl)).toBe(true);
    expect(isAffiliateBookingUrl("REZDY", whales.bookingUrl)).toBe(true);
    expect(isAffiliateBookingUrl("FAREHARBOR", whales.bookingUrl)).toBe(false);
    expect(isAffiliateBookingUrl("FAREHARBOR", "http://fareharbor.com/embeds/book/x/")).toBe(false);
    expect(isAffiliateBookingUrl("FAREHARBOR", "https://fareharbor.com.evil.example/x")).toBe(false);
    expect(isAffiliateBookingUrl("BOKUN", "https://bokun.io/x")).toBe(false);
    expect(isAffiliateBookingUrl("REZDY", null)).toBe(false);
  });
});

describe("parseAffiliateTrips", () => {
  it("keeps well-formed trips and drops anything with a missing title or an untrusted link", () => {
    const parsed = parseAffiliateTrips([
      reef,
      { ...whales, bookingUrl: "https://example.com/book" },
      { ...sail, title: "" },
      "junk",
      null
    ]);
    expect(parsed.map((trip) => trip.slug)).toEqual(["outer-reef-day"]);
    expect(parseAffiliateTrips(undefined)).toEqual([]);
  });
});

describe("matchAffiliateTrips", () => {
  it("ranks by region, then category, then title words", () => {
    expect(matchAffiliateTrips("any whale trips in Hervey Bay?", trips).map((trip) => trip.slug)).toEqual(["hervey-bay-whales"]);
    expect(matchAffiliateTrips("I want to dive the Great Barrier Reef", trips)[0].slug).toBe("outer-reef-day");
  });

  it("returns nothing rather than guessing", () => {
    expect(matchAffiliateTrips("hello there", trips)).toEqual([]);
  });
});

describe("decideAffiliateTurn", () => {
  it("answers a named trip with that trip, whatever else the message says", () => {
    expect(decideAffiliateTurn({ message: "how much is the Outer Reef Day?", trips })).toEqual({ kind: "TRIP", trip: reef, via: "NAMED" });
  });

  it("lists matching trips when the traveller asks for ideas", () => {
    const turn = decideAffiliateTurn({ message: "what can I do in the Whitsundays or Hervey Bay?", trips });
    expect(turn.kind).toBe("LIST");
    expect(turn.kind === "LIST" && turn.trips.map((trip) => trip.slug)).toEqual(["hervey-bay-whales", "whitsundays-sail"]);
  });

  it("goes straight to the link when only one trip fits a booking request", () => {
    expect(decideAffiliateTurn({ message: "I'd like to book a whale watch in Hervey Bay", trips })).toEqual({ kind: "TRIP", trip: whales, via: "MATCHED" });
  });

  it("reads a number as a pick from the list Kai just sent, in the order it was shown", () => {
    const list = buildAffiliateTripListReply([whales, sail]);
    expect(decideAffiliateTurn({ message: "2", trips, lastAssistantMessage: list })).toEqual({ kind: "TRIP", trip: sail, via: "PICKED" });
    expect(decideAffiliateTurn({ message: "option 1", trips, lastAssistantMessage: list })).toEqual({ kind: "TRIP", trip: whales, via: "PICKED" });
    // A number with no list before it means something else.
    expect(decideAffiliateTurn({ message: "2", trips, lastAssistantMessage: "How many guests?" })).toEqual({ kind: "NONE" });
  });

  it("stays out of the way of everything else", () => {
    expect(decideAffiliateTurn({ message: "can I talk to a person?", trips })).toEqual({ kind: "NONE" });
    expect(decideAffiliateTurn({ message: "what's the weather like?", trips })).toEqual({ kind: "NONE" });
    expect(decideAffiliateTurn({ message: "book the Outer Reef Day", trips: [] })).toEqual({ kind: "NONE" });
  });
});

describe("replies", () => {
  it("gives the trip, its operator and link, and never claims availability", () => {
    const reply = buildAffiliateTripReply(reef);
    expect(reply).toContain("Outer Reef Day is run by Reef Magic (Great Barrier Reef). From AUD 249 per guest.");
    expect(reply).toContain(`Book it here: ${reef.bookingUrl}`);
    expect(reply).toContain("on FareHarbor");
    expect(reply).toContain("confirmation and booking reference come from Reef Magic");
    expect(reply).toContain("A full day on the outer reef from Cairns. Snorkel gear included.");
    expect(reply).not.toContain("Lunch on board");
    expect(reply.toLowerCase()).not.toMatch(/available|spots left|seats left|confirmed/);
  });

  it("names Rezdy for Rezdy trips and skips a missing price", () => {
    expect(buildAffiliateTripReply(whales)).toContain("on Rezdy");
    expect(buildAffiliateTripReply(sail)).not.toContain("per guest");
  });

  it("lists every trip with its own link", () => {
    const reply = buildAffiliateTripListReply([whales, sail]);
    expect(reply).toContain(`1. Hervey Bay Whale Watch with Tasman Venture (Hervey Bay, From AUD 135)\n   Book: ${whales.bookingUrl}`);
    expect(reply).toContain(`2. Whitehaven Sail with Ocean Rafting (Whitsundays)\n   Book: ${sail.bookingUrl}`);
  });
});
