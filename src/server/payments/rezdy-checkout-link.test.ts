import { describe, expect, it } from "vitest";
import { buildRezdyCheckoutUrl } from "./rezdy-checkout-link";

describe("buildRezdyCheckoutUrl", () => {
  it("builds a Rezdy service checkout URL from the selected availability item key", () => {
    expect(
      buildRezdyCheckoutUrl({
        tenantSlug: "boattime",
        productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape",
        dateText: "2026-06-29 12:00:00",
        timeOptions: [
          {
            label: "12:00 PM",
            startTimeLocal: "2026-06-29 12:00:00",
            remaining: 80,
            checkoutItemKey: "item-431872-480938442"
          }
        ]
      })
    ).toBe("https://boattimeyachtcharters.rezdy.com/services/431872?itemKey=item-431872-480938442&useTransparentSessions=1");
  });

  it("returns null when there is no selected Rezdy checkout session", () => {
    expect(
      buildRezdyCheckoutUrl({
        tenantSlug: "boattime",
        productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape",
        dateText: "2026-06-29 12:00:00",
        timeOptions: []
      })
    ).toBeNull();
  });

  it("builds a Rezdy service checkout URL from a Boattime service id and session id", () => {
    expect(
      buildRezdyCheckoutUrl({
        tenantSlug: "boattime",
        productExternalId: "PGG8QT",
        productUrl: "http://localhost:3107/demo/boattime#gold-coast-whale-escape",
        dateText: "2026-06-29 09:00:00",
        timeOptions: [
          {
            label: "9:00 AM",
            startTimeLocal: "2026-06-29 09:00:00",
            remaining: 76,
            checkoutSessionId: "452992255"
          }
        ]
      })
    ).toBe("https://boattimeyachtcharters.rezdy.com/services/431872?itemKey=item-431872-452992255&useTransparentSessions=1");
  });
});
