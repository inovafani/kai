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
      }
    });
  });
});
