import { describe, expect, it } from "vitest";
import {
  beginExternalBooking,
  captureBookingDetails,
  markBookingReadyToConfirm,
  markExternalBookingConfirmed,
  markExternalBookingFailed
} from "./booking-state-machine";

const capturedDetails = {
  productExternalId: "PGG8QT",
  productTitle: "Gold Coast Whale Escape",
  dateText: "2026-06-23",
  guests: 2,
  travellerName: "Inov",
  travellerEmail: "inov@example.com",
  travellerPhone: "085337210180"
};

describe("booking state machine", () => {
  it("moves captured booking details to ready-to-confirm before any PMS write", () => {
    const captured = captureBookingDetails(capturedDetails);
    const ready = markBookingReadyToConfirm(captured);

    expect(ready).toEqual({
      ...capturedDetails,
      bookingStatus: "READY_TO_CONFIRM",
      confirmationSummary:
        "Gold Coast Whale Escape on 2026-06-23 for 2 guests under Inov, inov@example.com, 085337210180.",
      externalBookingId: null,
      externalProvider: null,
      bookingError: null
    });
  });

  it("moves ready booking through external pending and confirmed states", () => {
    const ready = markBookingReadyToConfirm(captureBookingDetails(capturedDetails));
    const pending = beginExternalBooking(ready);
    const confirmed = markExternalBookingConfirmed(pending, {
      externalBookingId: "RZ-123",
      externalProvider: "REZDY"
    });

    expect(pending.bookingStatus).toBe("EXTERNAL_BOOKING_PENDING");
    expect(confirmed).toMatchObject({
      bookingStatus: "CONFIRMED",
      externalBookingId: "RZ-123",
      externalProvider: "REZDY"
    });
  });

  it("fails closed when external booking cannot be completed", () => {
    const ready = markBookingReadyToConfirm(captureBookingDetails(capturedDetails));
    const pending = beginExternalBooking(ready);

    expect(markExternalBookingFailed(pending, "Rezdy rejected the request")).toMatchObject({
      bookingStatus: "FAILED",
      bookingError: "Rezdy rejected the request"
    });
  });
});
