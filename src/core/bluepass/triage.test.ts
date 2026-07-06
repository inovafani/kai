import { describe, expect, it } from "vitest";
import {
  buildBluePassOperatorReply,
  buildBluePassPartnerReply,
  buildBluePassTriageGreeting,
  classifyBluePassPersona,
  shouldSendBluePassTriageGreeting
} from "./triage";

describe("classifyBluePassPersona", () => {
  it("classifies an operator from a first-person business message", () => {
    expect(classifyBluePassPersona(["Hi, I run a dive resort in Raja Ampat and want to list my boats"])).toBe(
      "OPERATOR"
    );
    expect(classifyBluePassPersona(["We operate three liveaboards out of Labuan Bajo"])).toBe("OPERATOR");
    expect(classifyBluePassPersona(["How do I claim my page? You emailed us"])).toBe("OPERATOR");
  });

  it("classifies a partner from identity nouns even with operator-style verbs", () => {
    expect(classifyBluePassPersona(["I run a dive shop in Sydney and send divers to Indonesia"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["I'm a travel agent looking at your partner program"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["I want to book for clients, a group of 12"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["How do commissions work?"])).toBe("PARTNER");
  });

  it("classifies a traveller from trip language", () => {
    expect(classifyBluePassPersona(["My wife and I want mantas in Komodo in March"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["Looking at a liveaboard cabin for two"])).toBe("TRAVELLER");
  });

  it("never mistakes a romantic partner or a referral code for a business partner", () => {
    expect(classifyBluePassPersona(["My partner and I want to dive Komodo"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["I have referral code BP123 and want a Komodo trip"])).toBe("TRAVELLER");
  });

  it("keeps the persona sticky across vague follow-ups", () => {
    expect(classifyBluePassPersona(["I run a dive resort in Bali", "ok tell me more"])).toBe("OPERATOR");
    expect(classifyBluePassPersona(["I'm a travel agent", "sounds good"])).toBe("PARTNER");
  });

  it("returns UNKNOWN for a bare greeting", () => {
    expect(classifyBluePassPersona(["hello"])).toBe("UNKNOWN");
    expect(classifyBluePassPersona([])).toBe("UNKNOWN");
  });
});

describe("shouldSendBluePassTriageGreeting", () => {
  it("greets when there is no persona and no trip signal", () => {
    expect(
      shouldSendBluePassTriageGreeting({
        persona: "UNKNOWN",
        missingFields: ["destination", "dateWindow", "guests", "travellerName", "travellerEmail", "travellerPhone"],
        hasIntentSignal: false
      })
    ).toBe(true);
  });

  it("stays quiet once any trip signal exists", () => {
    expect(
      shouldSendBluePassTriageGreeting({
        persona: "UNKNOWN",
        missingFields: ["dateWindow", "guests", "travellerName", "travellerEmail", "travellerPhone"],
        hasIntentSignal: true
      })
    ).toBe(false);
  });

  it("offers the three verticals in the greeting", () => {
    const greeting = buildBluePassTriageGreeting();

    expect(greeting).toContain("planning a trip");
    expect(greeting).toContain("run boats or dive trips");
    expect(greeting).toContain("book and refer for clients");
  });
});

describe("buildBluePassOperatorReply", () => {
  it("opens with the honest economics pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "I run a dive resort in Raja Ampat", pitched: false });

    expect(result.reply).toContain("82%");
    expect(result.reply).toContain("never marked up");
    expect(result.reply).toContain("5% conservation");
  });

  it("itemises the 18% when asked", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How does the 18% break down?", pitched: true });

    expect(result.reply).toContain("5%");
    expect(result.reply).toContain("3%");
    expect(result.reply).toContain("82%");
    expect(result.reply).toContain("no listing fees");
  });

  it("routes Indonesian operators to the pre-built claim path", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "We're in Indonesia", pitched: true });

    expect(result.reply).toContain("pre-built");
    expect(result.reply).toContain("claim link");
  });

  it("is honest with operators outside Indonesia", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "We're outside Indonesia, in Fiji", pitched: true });

    expect(result.reply).toContain("Indonesia-first");
    expect(result.reply).toContain("expansion list");
  });

  it("never promises approval when explaining vetting", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How does vetting work?", pitched: true });

    expect(result.reply).toContain("Green Fins");
    expect(result.reply).toContain("won't promise");
  });

  it("hands payout and contract questions to humans", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How do payouts work?", pitched: true });

    expect(result.reply).toContain("team");
    expect(result.reply).not.toContain("82%");
  });

  it("nudges for lead details instead of repeating the pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "ok", pitched: true });

    expect(result.reply).toContain("company name");
    expect(result.reply).not.toContain("82%");
  });
});

describe("buildBluePassPartnerReply", () => {
  it("opens with the zero-markup commission pitch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "I'm a travel agent", pitched: false });

    expect(result.reply).toContain("tracked link");
    expect(result.reply).toContain("never marked up");
    expect(result.reply).toContain("operator's side");
  });

  it("explains the commission mechanism without inventing a percentage", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "How do commissions work?", pitched: true });

    expect(result.reply).toContain("operator's own rate");
    expect(result.reply).toContain("founding");
    expect(result.reply).not.toMatch(/\byour commission is \d+%/i);
  });

  it("shows catalog cards for the catalogue branch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "What's in the catalogue?", pitched: true });

    expect(result.showCatalog).toBe(true);
    expect(result.reply).toContain("Komodo and Raja Ampat");
  });

  it("routes a destination brief to book-on-behalf with destination cards", () => {
    const komodo = buildBluePassPartnerReply({ latestMessage: "Komodo for my clients", pitched: true });
    const raja = buildBluePassPartnerReply({ latestMessage: "Raja Ampat instead", pitched: true });

    expect(komodo.showCatalog).toBe(true);
    expect(komodo.catalogDestination).toBe("Komodo");
    expect(raja.catalogDestination).toBe("Raja Ampat");
  });

  it("keeps conservation impact ahead of the commission keyword match", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "Tell me about the 5% conservation impact", pitched: true });

    expect(result.reply).toContain("conservation");
    expect(result.reply).toContain("co-brand");
  });

  it("nudges for lead details instead of repeating the pitch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "ok", pitched: true });

    expect(result.reply).toContain("claim link");
    expect(result.reply).not.toContain("tracked link and a catalogue");
  });
});
