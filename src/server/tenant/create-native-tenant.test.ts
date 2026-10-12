import { describe, expect, it } from "vitest";
import { BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE, WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "@/core/tenant/feature-flags";
import { buildNativeTenantData, NATIVE_GO_LIVE_FEATURES, normalizeWhatsAppDigits, slugifyOperatorName } from "./create-native-tenant";

describe("slugifyOperatorName", () => {
  it("makes a readable, url-safe slug", () => {
    expect(slugifyOperatorName("Barbados Blue Water Tours")).toBe("barbados-blue-water-tours");
    expect(slugifyOperatorName("  Café del Mar & Sons!  ")).toBe("cafe-del-mar-sons");
  });

  it("caps the length without leaving a trailing dash", () => {
    const slug = slugifyOperatorName("A very long operator name that keeps going and going well past forty characters");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("falls back when the name has nothing usable", () => {
    expect(slugifyOperatorName("!!!")).toBe("operator");
  });
});

describe("normalizeWhatsAppDigits", () => {
  it("keeps digits only", () => {
    expect(normalizeWhatsAppDigits("+1 (246) 555-0134")).toBe("12465550134");
    expect(normalizeWhatsAppDigits("+62 812-3456-7890")).toBe("6281234567890");
  });

  it("rejects values that cannot be a phone number", () => {
    expect(normalizeWhatsAppDigits("12345")).toBeNull();
    expect(normalizeWhatsAppDigits("")).toBeNull();
    expect(normalizeWhatsAppDigits(null)).toBeNull();
  });
});

describe("buildNativeTenantData", () => {
  const base = { slug: "blue-water", name: "Blue Water", adminWhatsAppPhone: "12465550134" };

  it("sets up a native tenant that books on Kai's own system", () => {
    const data = buildNativeTenantData({ ...base, goLive: false });
    expect(data.config.pmsProvider).toBe("NATIVE");
    expect(data.config.bookingMode).toBe("AUTO_BOOKING");
    expect(data.config.bookingWriteEnabled).toBe(true);
    expect(data.config.adminWhatsAppPhone).toBe("12465550134");
    expect(data.allowedOrigins).toEqual(["https://bluepass.co", "https://www.bluepass.co"]);
    expect(data.widgetPublicKey).toMatch(/^pk_native_[0-9a-f]{24}$/);
  });

  it("stays invisible to travellers until it goes live", () => {
    expect(buildNativeTenantData({ ...base, goLive: false }).config.enabledFeatures).toEqual([]);
    expect(buildNativeTenantData({ ...base, goLive: true }).config.enabledFeatures).toEqual(NATIVE_GO_LIVE_FEATURES);
    expect(NATIVE_GO_LIVE_FEATURES).toEqual([WHATSAPP_GENERIC_ELIGIBLE_FEATURE, BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE]);
  });

  it("gives every tenant its own widget key", () => {
    const first = buildNativeTenantData({ ...base, goLive: false }).widgetPublicKey;
    const second = buildNativeTenantData({ ...base, goLive: false }).widgetPublicKey;
    expect(first).not.toBe(second);
  });
});
