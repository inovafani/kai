import { describe, expect, it } from "vitest";
import { isConfirmedBooking } from "./types";

describe("booking state", () => {
  it("requires both CONFIRMED status and an external booking id", () => {
    expect(
      isConfirmedBooking({
        tenantId: "tenant_bluepass",
        bookingId: "booking_1",
        status: "CONFIRMED",
        paymentStatus: "AUTHORIZED",
        externalBookingId: "rezdy_123",
        externalProvider: "REZDY"
      })
    ).toBe(true);

    expect(
      isConfirmedBooking({
        tenantId: "tenant_bluepass",
        bookingId: "booking_2",
        status: "CONFIRMED",
        paymentStatus: "AUTHORIZED",
        externalBookingId: null,
        externalProvider: null
      })
    ).toBe(false);
  });
});
