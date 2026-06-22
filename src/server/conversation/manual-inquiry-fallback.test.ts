import { describe, expect, it } from "vitest";
import { buildBookingFailureManualInquiry } from "./manual-inquiry-fallback";

describe("manual inquiry fallback", () => {
  it("builds an operator-review inquiry when PMS booking confirmation fails", () => {
    const result = buildBookingFailureManualInquiry({
      action: "BOOKING_FAILED",
      reply: "I could not confirm this booking in the PMS.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "PGG8QT",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Kala",
        travellerEmail: "kala@gmail.com",
        travellerPhone: "086554329278",
        bookingStatus: "FAILED",
        confirmationSummary: "Gold Coast Whale Escape on tomorrow for 3 guests under Kala.",
        externalBookingId: null,
        externalProvider: null,
        bookingError: "PMS booking request failed."
      }
    });

    expect(result).toEqual({
      state: {
        productExternalId: "PGG8QT",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Kala",
        travellerEmail: "kala@gmail.com",
        travellerPhone: "086554329278",
        bookingStatus: "FAILED",
        confirmationSummary: "Gold Coast Whale Escape on tomorrow for 3 guests under Kala.",
        externalBookingId: null,
        externalProvider: null,
        bookingError: "PMS booking request failed."
      },
      travellerName: "Kala",
      travellerEmail: "kala@gmail.com",
      travellerPhone: "086554329278"
    });
  });

  it("does not build fallback inquiries for non-failed booking actions", () => {
    const result = buildBookingFailureManualInquiry({
      action: "BOOKING_CONFIRMED",
      reply: "Confirmed.",
      replySource: "DETERMINISTIC",
      bookingStatePatch: {
        productExternalId: "PGG8QT",
        productTitle: "Gold Coast Whale Escape",
        dateText: "tomorrow",
        guests: 3,
        travellerName: "Kala",
        travellerEmail: "kala@gmail.com",
        travellerPhone: "086554329278",
        bookingStatus: "CONFIRMED",
        confirmationSummary: null,
        externalBookingId: "rezdy-123",
        externalProvider: "REZDY",
        bookingError: null
      }
    });

    expect(result).toBeNull();
  });
});
