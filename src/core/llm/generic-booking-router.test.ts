import { describe, expect, it } from "vitest";
import { parseGenericBookingRouterDecision } from "./generic-booking-router";

describe("parseGenericBookingRouterDecision", () => {
  it("parses a well-formed router decision", () => {
    const decision = parseGenericBookingRouterDecision(JSON.stringify({ intent: "check_availability" }));

    expect(decision).toEqual({ intent: "CHECK_AVAILABILITY" });
  });

  it("extracts JSON even when the model wraps it in prose or code fences", () => {
    const decision = parseGenericBookingRouterDecision(
      'Sure, here is the classification:\n```json\n{"intent": "GENERAL_QUESTION"}\n```'
    );

    expect(decision).toEqual({ intent: "GENERAL_QUESTION" });
  });

  it("returns null for an unrecognized intent value", () => {
    const decision = parseGenericBookingRouterDecision(JSON.stringify({ intent: "BOOK_NOW" }));
    expect(decision).toBeNull();
  });

  it("returns null when there is no JSON object in the response", () => {
    expect(parseGenericBookingRouterDecision("I am not sure what to do here.")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseGenericBookingRouterDecision("{intent: GENERAL_QUESTION")).toBeNull();
  });

  it("never surfaces productHint, dateText, or guests even if the model output includes them", () => {
    const decision = parseGenericBookingRouterDecision(
      JSON.stringify({
        intent: "BOOKING_INQUIRY",
        productHint: "Fabricated Tour",
        dateText: "tomorrow",
        guests: 4
      })
    );

    expect(decision).toEqual({ intent: "BOOKING_INQUIRY" });
    expect(decision).not.toHaveProperty("productHint");
    expect(decision).not.toHaveProperty("dateText");
    expect(decision).not.toHaveProperty("guests");
  });
});
