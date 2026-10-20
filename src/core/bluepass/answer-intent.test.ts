import { describe, expect, it } from "vitest";
import { guestsFromAnswer, intentFromAnswer, intentFromAnswers, pairTravellerWithKai, questionKaiAsked } from "./answer-intent";

describe("questionKaiAsked", () => {
  it("recognises Kai's own questions", () => {
    expect(questionKaiAsked("How many of you are going?")).toBe("guests");
    expect(questionKaiAsked("Komodo is a good call. When are you thinking of going?")).toBe("dateWindow");
    expect(questionKaiAsked("Are you more after the diving, or cruising the islands?")).toBe("interests");
    expect(questionKaiAsked("Here are three boats.")).toBeNull();
    expect(questionKaiAsked(null)).toBeNull();
  });
});

describe("guestsFromAnswer", () => {
  it.each([
    ["2", 2], ["two", 2], ["4 people", 4], ["we're 6", 6], ["just me", 1], ["solo", 1],
    ["me and my wife", 2], ["the two of us", 2], ["a couple", 2], ["family of four", 4],
    ["5 adults and 2 kids", 7], ["8 of us", 8], ["dua orang", 2]
  ])("reads %j as %d", (reply, expected) => {
    expect(guestsFromAnswer(reply)).toBe(expected);
  });

  it.each(["August", "not sure yet", "diving", "4 nights", "the 15th of august", "", "what is the price for 3 nights and 2 days in komodo please"])(
    "does not invent a party size from %j",
    (reply) => {
      expect(guestsFromAnswer(reply)).toBeNull();
    }
  );
});

describe("intentFromAnswer", () => {
  it("reads a reply by its question", () => {
    expect(intentFromAnswer("guests", "2")).toEqual({ guests: 2 });
    expect(intentFromAnswer("dateWindow", "not sure yet")).toEqual({ dateWindow: "flexible" });
    expect(intentFromAnswer("interests", "diving mostly")).toEqual({ interests: ["dive"] });
    expect(intentFromAnswer("interests", "just cruising around the islands")).toEqual({ interests: ["cruise"] });
    expect(intentFromAnswer("interests", "bit of both")).toEqual({ interests: ["dive", "cruise"] });
  });

  it("says nothing when there was no question, so a stray number is not a head count", () => {
    expect(intentFromAnswer(null, "2")).toEqual({});
  });
});

describe("intentFromAnswers", () => {
  const greeting = "Hi, I'm Kai. Where do you want to go?";
  const askedDates = "Komodo is a good call. When are you thinking of going?";
  const askedGuests = "How many of you are going?";
  const askedInterest = "Are you more after the diving, or cruising the islands?";

  // Prior traveller messages leave out the one being answered right now, and Kai's list ends with the
  // message it just sent, so with a stored greeting Kai has exactly one more than the traveller.
  it("reads an earlier bare number as the party size, because Kai had asked how many were going", () => {
    const pairs = pairTravellerWithKai(
      ["I'm planning a trip to Komodo", "probably August", "2"],
      [greeting, askedDates, askedGuests, askedInterest]
    );
    expect(pairs.map((p) => p.assistantBefore)).toEqual([greeting, askedDates, askedGuests]);
    expect(intentFromAnswers(pairs)).toEqual({ guests: 2 });
  });

  it("does not read a number as a head count when Kai had asked something else", () => {
    const pairs = pairTravellerWithKai(["Komodo", "4"], [greeting, askedDates, askedInterest]);
    expect(intentFromAnswers(pairs)).toEqual({});
  });

  it("collects several answers across the chat", () => {
    const pairs = pairTravellerWithKai(
      ["Komodo", "not sure when", "just me", "diving mostly"],
      [greeting, askedDates, askedGuests, askedInterest, "Here is what I would put in front of you."]
    );
    expect(intentFromAnswers(pairs)).toEqual({ dateWindow: "flexible", guests: 1, interests: ["dive"] });
  });

  it("lines up when Kai has no stored greeting", () => {
    const pairs = pairTravellerWithKai(["Komodo", "3"], [askedGuests, askedGuests]);
    expect(pairs[0].assistantBefore).toBeNull();
    expect(pairs[1].assistantBefore).toBe(askedGuests);
  });
});

import { extractBluePassInquiryIntent } from "./intent";

describe("a month and the next message's number", () => {
  it("does not make 'August' then '2' into the 2nd of August", () => {
    expect(extractBluePassInquiryIntent(["probably August", "2"]).dateWindow).toBe("August");
  });

  it("still reads a day and a month typed together", () => {
    expect(extractBluePassInquiryIntent(["2 August"]).dateWindow).toBe("2 August");
    expect(extractBluePassInquiryIntent(["August 2nd please"]).dateWindow).toBe("2 August");
  });
});
