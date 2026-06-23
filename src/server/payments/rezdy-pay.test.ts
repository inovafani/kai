import { describe, expect, it } from "vitest";
import { hasRezdyBookingWriteConfig, resolveRezdyStripePublishableKey } from "./rezdy-pay";

describe("RezdyPay configuration", () => {
  it("requires Rezdy booking API settings before secure payment can start", () => {
    expect(
      hasRezdyBookingWriteConfig({
        REZDY_BASE_URL: "https://api.rezdy.com/v1",
        REZDY_API_KEY: "secret",
        REZDY_BOOKING_PATH: "/bookings"
      })
    ).toBe(true);
    expect(
      hasRezdyBookingWriteConfig({
        REZDY_BASE_URL: "https://api.rezdy.com/v1",
        REZDY_API_KEY: "secret"
      })
    ).toBe(false);
  });

  it("prefers an explicitly configured Rezdy Stripe publishable key", () => {
    expect(
      resolveRezdyStripePublishableKey({
        REZDY_STRIPE_PUBLISHABLE_KEY: "pk_test_custom"
      })
    ).toBe("pk_test_custom");
  });

  it("uses the Rezdy staging Stripe publishable key for staging API URLs", () => {
    expect(
      resolveRezdyStripePublishableKey({
        REZDY_BASE_URL: "https://api.rezdy-staging.com/v1"
      })
    ).toContain("pk_test_");
  });
});
