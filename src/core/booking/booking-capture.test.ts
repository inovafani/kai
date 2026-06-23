import { describe, expect, it } from "vitest";
import { evaluateBookingCapture } from "./booking-capture";

const bookingMemory = {
  productExternalId: "rezdy-gold-coast-whale",
  productTitle: "Gold Coast Whale Escape",
  dateText: "2026-06-23",
  guests: 2
};

describe("booking capture", () => {
  it("starts capture when traveller asks to book a known product/date/guest selection", () => {
    const result = evaluateBookingCapture({
      message: "yes book it",
      bookingMemory,
      priorTravellerMessages: []
    });

    expect(result).toEqual({
      active: true,
      ready: false,
      missingBookingSlots: [],
      missingContactSlots: ["name", "email", "phone"],
      details: {
        productExternalId: "rezdy-gold-coast-whale",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-23",
        guests: 2,
        travellerName: null,
        travellerEmail: null,
        travellerPhone: null
      }
    });
  });

  it("starts capture from natural confirmation language after availability is known", () => {
    const result = evaluateBookingCapture({
      message: "ok i think i want that",
      bookingMemory,
      priorTravellerMessages: ["Gold Coast Whale Escape is available for 2 guests on 2026-06-23."]
    });

    expect(result.active).toBe(true);
    expect(result.missingContactSlots).toEqual(["name", "email", "phone"]);
  });

  it("continues capture across messages and becomes ready when contact details are present", () => {
    const result = evaluateBookingCapture({
      message: "My name is Maya Chen, email maya@example.com, phone +61 400 111 222",
      bookingMemory,
      priorTravellerMessages: ["Can you check Gold Coast Whale Escape for 2 guests on 2026-06-23?", "yes book it"]
    });

    expect(result).toEqual({
      active: true,
      ready: true,
      missingBookingSlots: [],
      missingContactSlots: [],
      details: {
        productExternalId: "rezdy-gold-coast-whale",
        productTitle: "Gold Coast Whale Escape",
        dateText: "2026-06-23",
        guests: 2,
        travellerName: "Maya Chen",
        travellerEmail: "maya@example.com",
        travellerPhone: "+61 400 111 222"
      }
    });
  });

  it("keeps digits in traveller names such as test fixture names", () => {
    const result = evaluateBookingCapture({
      message: "My name is Test4, email test4@gmail.com, phone 087665234098",
      bookingMemory,
      priorTravellerMessages: ["yes book it"]
    });

    expect(result.details.travellerName).toBe("Test4");
    expect(result.details.travellerEmail).toBe("test4@gmail.com");
    expect(result.details.travellerPhone).toBe("087665234098");
  });
});
