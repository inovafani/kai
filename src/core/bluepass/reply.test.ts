import { describe, expect, it } from "vitest";
import {
  buildBluePassDestinationInterestReply,
  buildBluePassEnquiryReminder,
  buildBluePassRecommendationReply,
  buildBluePassRegionChoiceReply,
  buildBluePassSmallTalkReply,
  buildBluePassConservationReply,
  buildBluePassInquiryConfirmationReply,
  buildBluePassInquiryReadyReply,
  buildBluePassInquiryStatusReply,
  buildBluePassMissingFieldsReply,
  buildBluePassSeasonReply,
  buildBluePassValueReply,
  buildBluePassYachtComparisonReply,
  buildBluePassYachtOverviewReply,
  isBluePassConservationQuestion,
  isBluePassDestinationInterestReply,
  isBluePassRegionChoiceReply,
  isBluePassValuePropQuestion
} from "./reply";

// Minimal yacht shapes - the reply builders only read these fields.
const yacht = {
  name: "Sea Dragon",
  region: "Komodo",
  tier: "Explorer",
  maxGuests: 12,
  cabins: 6,
  priceSignal: "from IDR 15M/night",
  charterPriceSignal: "charter from IDR 90M/week",
  productUrl: "https://bluepass.co/y/sea-dragon"
} as any;

const rajaYacht = { ...yacht, name: "Manta Queen", region: "Raja Ampat" } as any;
// A couple's boat, so the steer has something smaller to pick than Sea Dragon.
const couple = { ...yacht, name: "Little Wing", maxGuests: 2, cabins: 1, priceSignal: "from IDR 9M/night" } as any;

// Every traveller-facing reply, across representative inputs.
function allTravellerReplies(): string[] {
  return [
    buildBluePassMissingFieldsReply({ missingFields: ["destination", "travellerEmail"] as any }),
    buildBluePassMissingFieldsReply({ destination: "Komodo", missingFields: ["dateWindow"] as any }),
    buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["dateWindow", "guests"] as any }),
    buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["travellerName", "travellerEmail"] as any }),
    buildBluePassInquiryReadyReply({ inquiryId: "BP-1001", dispatchQueued: true }),
    buildBluePassInquiryReadyReply({ inquiryId: "BP-1002", selectedYachtName: "Sea Dragon", dispatchFailed: true, dispatchQueued: false }),
    buildBluePassInquiryConfirmationReply({}),
    buildBluePassInquiryConfirmationReply({ selectedYachtName: "Sea Dragon", destination: "Komodo", dateWindow: "March", guests: 8, travellerName: "Tony", travellerEmail: "t@x.com", travellerPhone: "+62812" }),
    buildBluePassInquiryStatusReply({ inquiryId: "BP-1003", status: "OPERATOR_PENDING" }),
    buildBluePassYachtOverviewReply(yacht),
    buildBluePassValueReply(),
    buildBluePassSeasonReply("Komodo"),
    buildBluePassSeasonReply("Raja Ampat"),
    buildBluePassYachtComparisonReply([yacht, rajaYacht] as any),
    buildBluePassDestinationInterestReply({ destination: "Komodo" }),
    buildBluePassDestinationInterestReply({ destination: "Raja Ampat", known: { dateWindow: "March", guests: 6 } }),
    buildBluePassRegionChoiceReply(["Komodo", "Raja Ampat"]),
    buildBluePassRecommendationReply({ destination: "Komodo", matches: [yacht, couple] as any }),
    buildBluePassRecommendationReply({
      destination: "Komodo",
      matches: [yacht, couple] as any,
      known: { dateWindow: "July", guests: 2, interests: ["dive"] }
    }),
    buildBluePassRecommendationReply({ destination: "Komodo", matches: [yacht] as any, alreadyShown: true }),
    buildBluePassRecommendationReply({ destination: "Komodo", matches: [yacht] as any, noMoreOptions: true })
  ];
}

// Kai answers a named place like a person who knows it, not like a search box. One fact, one
// question, and the boats only once there's a reason to show them.
describe("conversational openers", () => {
  const questionCount = (reply: string) => reply.split("?").length - 1;

  it("acknowledges the place, says something useful, and asks one thing", () => {
    const reply = buildBluePassDestinationInterestReply({ destination: "Komodo" });

    expect(reply).toContain("Komodo is a good call.");
    expect(reply).toContain("April to November");
    expect(reply.endsWith("When are you thinking of going?")).toBe(true);
    expect(questionCount(reply)).toBe(1);
  });

  it("asks for the one thing it still needs, in turn", () => {
    const dates = { dateWindow: "July" };
    expect(buildBluePassDestinationInterestReply({ destination: "Komodo", known: dates })).toContain(
      "How many of you are going?"
    );
    expect(
      buildBluePassDestinationInterestReply({ destination: "Komodo", known: { ...dates, guests: 2 } })
    ).toContain("Are you more after the diving, or cruising the islands?");
    expect(
      buildBluePassDestinationInterestReply({
        destination: "Komodo",
        known: { ...dates, guests: 2, interests: ["dive"] }
      })
    ).toContain("Want me to line up what fits?");
  });

  it("does not ask the same question twice in a row when the traveller skips it", () => {
    const reply = buildBluePassDestinationInterestReply({
      destination: "Komodo",
      previousReply: "Komodo is a good call. When are you thinking of going?"
    });

    expect(reply).not.toContain("When are you thinking of going?");
    expect(reply).toContain("How many of you are going?");
  });

  it("knows its own opener, so the flow can tell it has already been asked", () => {
    const opener = buildBluePassDestinationInterestReply({ destination: "Komodo" });

    expect(isBluePassDestinationInterestReply(opener, "Komodo")).toBe(true);
    expect(isBluePassDestinationInterestReply(opener, "Raja Ampat")).toBe(false);
    expect(isBluePassDestinationInterestReply("Here are three boats in Komodo:", "Komodo")).toBe(false);
  });

  it("decides the region with a comparison instead of a list, when no place is named", () => {
    const reply = buildBluePassRegionChoiceReply(["Komodo", "Raja Ampat"]);

    expect(reply).toContain("Komodo");
    expect(reply).toContain("Raja Ampat");
    expect(reply.endsWith("Which way are you leaning?")).toBe(true);
    expect(questionCount(reply)).toBe(1);
    expect(isBluePassRegionChoiceReply(reply)).toBe(true);
  });
});

describe("recommendation lists that keep the conversation going", () => {
  const questionCount = (reply: string) => reply.split("?").length - 1;

  it("ends with one question, not a menu of ways to continue", () => {
    const reply = buildBluePassRecommendationReply({ destination: "Komodo", matches: [yacht, couple] as any });

    expect(questionCount(reply)).toBe(1);
    expect(reply.endsWith("When are you thinking of going?")).toBe(true);
    expect(reply).not.toContain("I can compare");
  });

  it("steers to the boat that fits the party, not the biggest one in the list", () => {
    const forTwo = buildBluePassRecommendationReply({
      destination: "Komodo",
      matches: [yacht, couple] as any,
      known: { dateWindow: "July", guests: 2 }
    });
    expect(forTwo).toContain("For the two of you, Little Wing takes 2");

    const forTen = buildBluePassRecommendationReply({
      destination: "Komodo",
      matches: [yacht, couple] as any,
      known: { dateWindow: "July", guests: 10 }
    });
    expect(forTen).toContain("For 10 of you, Sea Dragon is the closest fit, up to 12 guests.");
  });

  it("asks what it still needs instead of re-asking what it was just told", () => {
    const reply = buildBluePassRecommendationReply({
      destination: "Komodo",
      matches: [yacht, couple] as any,
      known: { dateWindow: "July", guests: 2 }
    });

    expect(reply).not.toContain("When are you thinking of going?");
    expect(reply).toContain("Are you more after the diving, or cruising the islands?");
  });

  it("offers the operator check once it knows the dates and the group", () => {
    const reply = buildBluePassRecommendationReply({
      destination: "Komodo",
      matches: [yacht, couple] as any,
      known: { dateWindow: "July", guests: 2, interests: ["dive"] }
    });

    expect(reply).toContain("Which one takes your eye, and I'll put July to the operator to check?");
    expect(questionCount(reply)).toBe(1);
  });

  it("says when it is showing the same boats again, and when there are no others", () => {
    // The cards are already in the chat, so the same list isn't sent again as though it were new.
    const sameAgain = buildBluePassRecommendationReply({
      destination: "Komodo",
      matches: [yacht, couple] as any,
      alreadyShown: true
    });
    expect(sameAgain).toContain("Still the same two in Komodo.");
    expect(sameAgain).not.toContain(yacht.productUrl);
    expect(sameAgain).toContain("When are you thinking of going?");
    expect(
      buildBluePassRecommendationReply({ destination: "Komodo", matches: [yacht] as any, noMoreOptions: true })
    ).toContain("That's everything BluePass has in Komodo right now:");
    expect(
      buildBluePassRecommendationReply({
        destination: "Komodo",
        matches: [yacht, couple] as any,
        showingSomethingNew: true
      })
    ).toContain("Here's what else BluePass has in Komodo:");
    expect(
      buildBluePassRecommendationReply({
        destination: "Komodo",
        matches: [],
        excludedYachtNames: ["Sea Dragon", "Little Wing"]
      })
    ).toContain("that's everything BluePass has in Komodo right now");
  });
});

describe("bluepass traveller replies (reply.ts)", () => {
  it("never uses an emoji", () => {
    const EMOJI = /\p{Extended_Pictographic}/u;
    for (const reply of allTravellerReplies()) {
      expect(EMOJI.test(reply), `emoji in: ${reply}`).toBe(false);
    }
  });

  it("only ever states the honest 5% (no invented percentages)", () => {
    for (const reply of allTravellerReplies()) {
      for (const m of reply.matchAll(/(\d+)\s*(?:%|percent)/gi)) {
        expect(m[1], `bad % in: ${reply}`).toBe("5");
      }
    }
  });

  it("returns non-empty, trimmed replies with no double spaces", () => {
    for (const reply of allTravellerReplies()) {
      expect(reply.length).toBeGreaterThan(0);
      expect(reply, `untrimmed: ${reply}`).toBe(reply.trim());
      expect(reply.includes("  "), `double space in: ${reply}`).toBe(false);
    }
  });

  it("keeps the selected-yacht dates/guests prompt <=320 with a full yacht (price + charter)", () => {
    const y = { ...yacht, name: "Alila Purnama Phinisi Expedition", priceSignal: "from IDR 15,000,000/night" } as any;
    const reply = buildBluePassMissingFieldsReply({ selectedYacht: y, missingFields: ["dateWindow", "guests"] as any });
    expect(reply.length, `selected-yacht prompt too long: ${reply.length}`).toBeLessThanOrEqual(320);
    expect(reply.toLowerCase()).toContain("operator");
  });

  it("keeps the yacht-overview reply <=320 with a charter signal + long name", () => {
    const y = { ...yacht, name: "Alila Purnama Phinisi Expedition" } as any;
    const reply = buildBluePassYachtOverviewReply(y);
    expect(reply.length, `overview too long: ${reply.length}`).toBeLessThanOrEqual(320);
    expect(reply.toLowerCase()).toContain("enquiry");
  });

  it("keeps the yacht-comparison reply <=320 with 3 real yachts (incl. long names)", () => {
    const three = [
      { ...yacht, name: "Alila Purnama Phinisi" },
      { ...rajaYacht, name: "Damai II Liveaboard" },
      { ...yacht, name: "Ombak Putih Expedition", region: "Raja Ampat" },
    ] as any;
    const reply = buildBluePassYachtComparisonReply(three);
    expect(reply.length, `comparison too long: ${reply.length}`).toBeLessThanOrEqual(320);
    expect(reply.toLowerCase()).toContain("narrow it down");
  });

  it("keeps the data-independent replies concise (<=320 chars)", () => {
    expect(buildBluePassValueReply().length).toBeLessThanOrEqual(320);
    expect(buildBluePassSeasonReply("Komodo").length).toBeLessThanOrEqual(320);
    expect(buildBluePassSeasonReply("Raja Ampat").length).toBeLessThanOrEqual(320);
  });

  it("AU-first: season reply gives Australian seasons for AU regions (no Komodo/Labuan Bajo)", () => {
    const gbr = buildBluePassSeasonReply("Great Barrier Reef");
    expect(gbr).toMatch(/Great Barrier Reef|stinger/);
    expect(gbr.toLowerCase()).not.toContain("komodo");
    expect(gbr.toLowerCase()).not.toContain("labuan bajo");
    expect(gbr.length).toBeLessThanOrEqual(320);

    const ningaloo = buildBluePassSeasonReply("Ningaloo Reef");
    expect(ningaloo.toLowerCase()).toMatch(/whale shark|ningaloo/);
    expect(ningaloo.length).toBeLessThanOrEqual(320);

    const whitsundays = buildBluePassSeasonReply("Whitsundays");
    expect(whitsundays.toLowerCase()).toMatch(/whitsundays|whitehaven|74 islands/);
    expect(whitsundays.length).toBeLessThanOrEqual(320);

    // An unknown region gets an honest "don't know yet" fallback rather than fabricated Australia-
    // wide seasonal claims - the same correctness bug this session already fixed once for a Komodo-
    // flavored default (see A5 in the integration plan); the fallback deliberately doesn't assume
    // any one market, matching the decision to leave the country/market gate unwired for now.
    const generic = buildBluePassSeasonReply("Sydney");
    expect(generic.toLowerCase()).toContain("sydney");
    expect(generic.toLowerCase()).not.toContain("komodo");
    expect(generic.length).toBeLessThanOrEqual(320);

    // Indonesian regions still get Indonesian seasons
    expect(buildBluePassSeasonReply("Komodo").toLowerCase()).toContain("komodo");
  });

  it("AU-first: an AU yacht is not called a 'phinisi', and comparisons don't name-drop Komodo/Raja", () => {
    const auYacht = { ...yacht, name: "Reef Explorer", region: "Great Barrier Reef" } as any;
    const missing = buildBluePassMissingFieldsReply({ selectedYacht: auYacht, missingFields: ["dateWindow"] as any });
    expect(missing.toLowerCase()).not.toContain("phinisi");
    expect(buildBluePassYachtOverviewReply(auYacht).toLowerCase()).not.toContain("phinisi");
    // Indonesian yacht still reads as a phinisi
    expect(buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["dateWindow"] as any }).toLowerCase()).toContain("phinisi");

    const auComparison = buildBluePassYachtComparisonReply([
      { ...yacht, name: "Reef Explorer", region: "Great Barrier Reef" },
      { ...yacht, name: "Ningaloo Drifter", region: "Ningaloo Reef" }
    ] as any);
    expect(auComparison).not.toContain("Komodo");
    expect(auComparison).not.toContain("Raja Ampat");
    expect(auComparison).toContain("Great Barrier Reef");
    expect(auComparison.toLowerCase()).toContain("narrow it down");
    expect(auComparison.length).toBeLessThanOrEqual(320);
  });

  it("missing-fields reply names the fields it still needs", () => {
    const reply = buildBluePassMissingFieldsReply({ missingFields: ["destination", "travellerEmail"] as any });
    expect(reply.toLowerCase()).toContain("destination");
    expect(reply.toLowerCase()).toContain("email");
  });

  it("confirmation reply asks the traveller to confirm before sending", () => {
    const reply = buildBluePassInquiryConfirmationReply({ selectedYachtName: "Sea Dragon", destination: "Komodo" });
    expect(reply.toLowerCase()).toContain("want me to send it now?");
  });

  it("status reply reflects the normalized inquiry status", () => {
    const reply = buildBluePassInquiryStatusReply({ inquiryId: "BP-9001", status: "OPERATOR_PENDING" });
    expect(reply).toContain("BP-9001");
    expect(reply.toLowerCase()).toContain("with the operator");
  });

  it("booking-implying replies reference the operator and never assert a confirmed booking", () => {
    // Affirmative "it's booked" language - NOT the negated "not a confirmed booking" disclaimer.
    const AFFIRMS_BOOKED = /booking is confirmed|booking confirmed[.!]|you're booked|you are booked|reservation confirmed|confirmed your booking/i;
    const bookingImplying = [
      buildBluePassInquiryReadyReply({ inquiryId: "BP-3001", dispatchQueued: true }),
      buildBluePassInquiryReadyReply({ inquiryId: "BP-3002", dispatchFailed: true, dispatchQueued: false }),
      buildBluePassInquiryConfirmationReply({ selectedYachtName: "Sea Dragon", destination: "Komodo", guests: 6 }),
      buildBluePassInquiryStatusReply({ inquiryId: "BP-3003", status: "OPERATOR_PENDING" }),
      buildBluePassMissingFieldsReply({ selectedYacht: yacht, missingFields: ["dateWindow"] as any }),
      buildBluePassYachtOverviewReply(yacht)
    ];
    for (const reply of bookingImplying) {
      expect(reply.toLowerCase(), `no operator reference in: ${reply}`).toContain("operator");
      expect(AFFIRMS_BOOKED.test(reply), `asserts a confirmed booking: ${reply}`).toBe(false);
    }
  });

  it("keeps booking-truth honest (no confirmed-booking language before operator confirms)", () => {
    const ready = buildBluePassInquiryReadyReply({ inquiryId: "BP-2001", dispatchQueued: true });
    expect(ready.toLowerCase()).toContain("not a confirmed booking");
  });
});

// kai-conversation-flow-notes.md stop-the-line item A: Kai once told a traveller the 5% was
// "likely a service fee... goes towards maintaining the platform" - the exact inverse of the truth.
describe("conservation/value-prop grounding", () => {
  it("buildBluePassValueReply never calls the 5% a platform/service fee, and gives the real direction", () => {
    const reply = buildBluePassValueReply();
    expect(reply.toLowerCase()).not.toMatch(/platform fee|service fee/);
    expect(reply.toLowerCase()).toContain("operator's side");
    expect(reply.toLowerCase()).toContain("never added to your fare");
    expect(reply).toContain("5%");
  });

  it("buildBluePassConservationReply names the real, verified partners and explicitly denies it's a platform fee", () => {
    const reply = buildBluePassConservationReply();
    // The reply is allowed to say "not a platform fee" (an explicit rebuttal of the false claim) -
    // what it must never do is affirm it, e.g. "is a platform fee" or "goes towards the platform".
    expect(reply.toLowerCase()).not.toMatch(/\bis a platform fee\b|\bgoes towards.*platform\b|\bmaintaining the platform\b/);
    expect(reply.toLowerCase()).toContain("never a platform fee");
    expect(reply.toLowerCase()).toContain("operator's side");
    expect(reply).toContain("Great Barrier Reef Foundation");
    expect(reply).toContain("Whitsundays Marine Trust");
    expect(reply).toContain("Hervey Bay Whale Research");
    expect(reply).toContain("bluepass.co/conservation");
  });

  it("isBluePassConservationQuestion matches the real transcript question", () => {
    expect(isBluePassConservationQuestion("Where exactly does the 5% go, and who verifies it?")).toBe(true);
    expect(isBluePassConservationQuestion("what happens after I pay")).toBe(false);
  });

  // Regression: a trailing `\b` right after a literal "%" never matches, since "%" isn't a word
  // character - that silently broke the detector for "5%" followed by whitespace/punctuation, which
  // is nearly every real sentence. The test above happened to also contain "verifies", masking this.
  it("isBluePassConservationQuestion matches bare '5%' phrasing with no other trigger word", () => {
    expect(isBluePassConservationQuestion("isn't the 5% just a service fee for bluepass?")).toBe(true);
    expect(isBluePassConservationQuestion("is the 5% a platform fee?")).toBe(true);
    expect(isBluePassConservationQuestion("so where does the 5%. actually go")).toBe(true);
  });

  it("isBluePassValuePropQuestion matches the real transcript question, without matching the conservation one", () => {
    expect(isBluePassValuePropQuestion("Why is booking through you better than going direct to the operator?")).toBe(
      true
    );
    expect(isBluePassValuePropQuestion("Where exactly does the 5% go, and who verifies it?")).toBe(false);
  });

  it("isBluePassValuePropQuestion recognises everyday ways of asking why BluePass", () => {
    for (const question of [
      "Why should I book through BluePass?",
      "why book via bluepass",
      "Why should I use you?",
      "why go through you instead of the operator"
    ]) {
      expect(isBluePassValuePropQuestion(question), question).toBe(true);
    }
    expect(isBluePassValuePropQuestion("how do I book with you")).toBe(false);
  });
});

describe("buildBluePassEnquiryReminder", () => {
  it("asks only for what the enquiry still needs", () => {
    expect(buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["dateWindow", "guests"] })).toBe(
      "When you're ready, just tell me your dates and how many of you for Alila Purnama."
    );
    expect(buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["guests", "travellerName"] })).toBe(
      "When you're ready, just tell me how many of you are going on Alila Purnama."
    );
    expect(buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["travellerPhone", "travellerEmail"] })).toBe(
      "When you're ready, pop your details in the form below and I'll get your enquiry to the operator."
    );
    expect(buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: ["travellerName", "travellerEmail"] })).toBe(
      "When you're ready, send me your name and email and I'll get your enquiry to the operator."
    );
  });

  it("has nothing to add once everything's in, unless the enquiry is still waiting on a yes", () => {
    expect(buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: [] })).toBeNull();
    expect(buildBluePassEnquiryReminder({ yachtName: "Alila Purnama", missingFields: [], readyToSend: true })).toBe(
      "When you're ready, just say yes and I'll send your Alila Purnama enquiry to the operator."
    );
  });

  it("lets small talk pick the enquiry back up", () => {
    const enquiryReminder = "When you're ready, just tell me your dates and how many of you for Alila Purnama.";

    expect(buildBluePassSmallTalkReply({ gratitude: true, enquiryReminder })).toBe(`No worries at all. ${enquiryReminder}`);
    expect(buildBluePassSmallTalkReply({ latestMessage: "how's it going?", enquiryReminder })).toBe(
      `Going well, thanks for asking. ${enquiryReminder}`
    );
  });
});
