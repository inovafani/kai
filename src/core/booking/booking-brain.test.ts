import { describe, expect, it } from "vitest";
import { analyzeTravellerBookingMessage, composeBookingBrainReply } from "./booking-brain";

describe("booking brain", () => {
  it("detects availability checks and extracts practical booking slots", () => {
    const result = analyzeTravellerBookingMessage(
      "Can you check Komodo Day Trip for 3 guests tomorrow?"
    );

    expect(result).toEqual({
      intent: "CHECK_AVAILABILITY",
      confidence: "HIGH",
      slots: {
        productHint: "Komodo Day Trip",
        dateText: "tomorrow",
        guests: 3
      },
      missingSlots: []
    });
  });

  it("routes human requests away from automated booking claims", () => {
    const result = analyzeTravellerBookingMessage("Can I talk to a human about a refund?");

    expect(result.intent).toBe("HUMAN_HANDOFF");
    expect(result.confidence).toBe("HIGH");
    expect(result.missingSlots).toEqual([]);
  });

  it("asks for missing slots before any PMS or booking action", () => {
    const analysis = analyzeTravellerBookingMessage("I want to book a tour");
    const reply = composeBookingBrainReply(analysis);

    expect(analysis.intent).toBe("BOOKING_INQUIRY");
    expect(analysis.missingSlots).toEqual(["product", "date", "guests"]);
    expect(reply).toBe(
      "I can help with that. Which tour, date, and number of guests should I check first?"
    );
  });
  it("treats plural tour wording as a booking inquiry", () => {
    const result = analyzeTravellerBookingMessage("Show me tomorrow tours");

    expect(result.intent).toBe("BOOKING_INQUIRY");
    expect(result.slots.dateText).toBe("tomorrow");
    expect(result.missingSlots).toEqual(["product", "guests"]);
  });

  it("treats boat wording as booking intent", () => {
    const result = analyzeTravellerBookingMessage("private boat for 2 guests tomorrow");

    expect(result.intent).toBe("BOOKING_INQUIRY");
    expect(result.slots.dateText).toBe("tomorrow");
    expect(result.slots.guests).toBe(2);
  });

});
