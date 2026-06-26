import { describe, expect, it } from "vitest";
import { toPublicWidgetConfig } from "./widget-config";

describe("toPublicWidgetConfig", () => {
  it("returns only public tenant config", () => {
    const config = toPublicWidgetConfig({
      id: "tenant_1",
      slug: "kai-demo",
      name: "Kai Demo",
      defaultLocale: "en",
      branding: {
        logoUrl: null,
        primaryColor: "#0f766e",
        widgetTitle: "Kai",
        welcomeMessage: "Hi, I am Kai. How can I help with your booking?",
        brandVoice: "Warm and concise."
      },
      config: {
        supportedChannels: ["WEB_WIDGET"],
        enabledFeatures: ["widget_config", "mock_pms"],
        bookingMode: "MANUAL_INQUIRY",
        pmsProvider: "MOCK"
      }
    });

    expect(config).toEqual({
      tenant: {
        slug: "kai-demo",
        name: "Kai Demo",
        defaultLocale: "en"
      },
      branding: {
        logoUrl: null,
        primaryColor: "#0f766e",
        widgetTitle: "Kai",
        welcomeMessage: "Hi, I am Kai. How can I help with your booking?"
      },
      capabilities: {
        supportedChannels: ["WEB_WIDGET"],
        enabledFeatures: ["widget_config", "mock_pms"],
        bookingMode: "MANUAL_INQUIRY",
        pmsProvider: "MOCK"
      },
      businessPack: {
        kind: "operator_direct",
        tools: [
          "product_search",
          "check_availability",
          "create_manual_inquiry",
          "handoff_to_operator"
        ],
        paymentPolicy: "no_payment_in_kai",
        truthPolicy: {
          availabilitySource: "preview_catalog",
          priceSource: "preview_catalog",
          bookingConfirmationSource: "none"
        }
      }
    });
  });

  it("includes a safe public business pack summary", () => {
    const config = toPublicWidgetConfig({
      id: "tenant_bluepass",
      slug: "bluepass",
      name: "BluePass",
      defaultLocale: "en",
      branding: {
        logoUrl: null,
        primaryColor: "#0f766e",
        widgetTitle: "Kai",
        welcomeMessage: "Plan your ocean trip with Kai.",
        brandVoice: "Internal voice rules must not leak.",
      },
      config: {
        supportedChannels: ["WEB_WIDGET", "WHATSAPP"],
        enabledFeatures: ["widget_config", "bluepass_marketplace"],
        bookingMode: "MANUAL_INQUIRY",
        bookingWriteEnabled: false,
        pmsProvider: "NATIVE",
      },
    });

    expect(config.businessPack).toEqual({
      kind: "bluepass_marketplace",
      paymentPolicy: "operator_acceptance_required",
      tools: [
        "search_bluepass_yachts",
        "create_bluepass_inquiry",
        "sync_referral_ledger_estimate",
        "dispatch_operator_whatsapp",
        "get_bluepass_inquiry_status",
        "handoff_to_operator",
      ],
      truthPolicy: {
        availabilitySource: "preview_catalog",
        priceSource: "preview_catalog",
        bookingConfirmationSource: "operator_admin",
      },
    });
    expect(JSON.stringify(config)).not.toContain("Internal voice rules");
  });
});
