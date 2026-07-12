import { describe, expect, it } from "vitest";
import { parseBluePassRouterDecision } from "./bluepass-router";

describe("parseBluePassRouterDecision", () => {
  it("parses a well-formed router decision", () => {
    const decision = parseBluePassRouterDecision(
      JSON.stringify({
        action: "recommendation",
        destination: "Komodo",
        guests: 4,
        interests: ["dive", "private"],
        seasonDestination: null,
        gratitude: false
      })
    );

    expect(decision).toMatchObject({
      action: "RECOMMENDATION",
      intent: { destination: "Komodo", guests: 4, interests: ["dive", "private"] },
      seasonDestination: null,
      gratitude: false
    });
  });

  it("extracts JSON even when the model wraps it in prose or code fences", () => {
    const decision = parseBluePassRouterDecision(
      'Sure, here is the classification:\n```json\n{"action": "SMALL_TALK", "gratitude": true}\n```'
    );

    expect(decision).toMatchObject({ action: "SMALL_TALK", gratitude: true });
  });

  it("returns null for an unrecognized action value", () => {
    const decision = parseBluePassRouterDecision(JSON.stringify({ action: "BOOK_NOW" }));
    expect(decision).toBeNull();
  });

  it("returns null when there is no JSON object in the response", () => {
    expect(parseBluePassRouterDecision("I am not sure what to do here.")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseBluePassRouterDecision("{action: RECOMMENDATION")).toBeNull();
  });

  it("never extracts travellerName, travellerEmail, or travellerPhone from the model output", () => {
    const decision = parseBluePassRouterDecision(
      JSON.stringify({
        action: "SUBMIT_INQUIRY",
        travellerName: "Fabricated Name",
        travellerEmail: "fabricated@example.com",
        travellerPhone: "+62123456789"
      })
    );

    expect(decision?.intent).not.toHaveProperty("travellerName");
    expect(decision?.intent).not.toHaveProperty("travellerEmail");
    expect(decision?.intent).not.toHaveProperty("travellerPhone");
  });

  it("ignores non-numeric or non-positive guest counts", () => {
    const decision = parseBluePassRouterDecision(JSON.stringify({ action: "RECOMMENDATION", guests: -3 }));
    expect(decision?.intent.guests).toBeUndefined();
  });

  it("ignores a seasonDestination outside the known enum", () => {
    const decision = parseBluePassRouterDecision(
      JSON.stringify({ action: "SEASON_QUESTION", seasonDestination: "Bali" })
    );
    expect(decision?.seasonDestination).toBeNull();
  });
});
