import { describe, expect, it } from "vitest";
import { resolveBusinessPack } from "./registry";

describe("resolveBusinessPack", () => {
  it("resolves Boattime as an operator-direct pack with instant booking tools", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_boattime",
      slug: "boattime",
      name: "Boattime Yacht Charters",
      enabledFeatures: ["widget_config", "mock_pms", "boattime_local_demo"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: true,
      pmsProvider: "REZDY",
    });

    expect(pack).toEqual({
      tenantId: "tenant_boattime",
      slug: "boattime",
      displayName: "Boattime Yacht Charters",
      kind: "operator_direct",
      tools: [
        "product_search",
        "check_availability",
        "create_manual_inquiry",
        "create_instant_booking",
        "capture_payment",
        "handoff_to_operator",
      ],
      paymentPolicy: "instant_payment_allowed",
      truthPolicy: {
        availabilitySource: "pms_live",
        priceSource: "pms_live",
        bookingConfirmationSource: "pms_write_back",
      },
    });
  });

  it("grants instant booking tools to any Rezdy + booking-write tenant, not just boattime", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_reef_tours_au",
      slug: "reef-tours-au",
      name: "Reef Tours Australia",
      enabledFeatures: ["widget_config"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: true,
      pmsProvider: "REZDY",
    });

    expect(pack.kind).toBe("operator_direct");
    expect(pack.tools).toContain("create_instant_booking");
    expect(pack.tools).toContain("capture_payment");
    expect(pack.paymentPolicy).toBe("instant_payment_allowed");
    expect(pack.truthPolicy).toEqual({
      availabilitySource: "pms_live",
      priceSource: "pms_live",
      bookingConfirmationSource: "pms_write_back",
    });
  });

  it("does not grant instant booking tools to a Rezdy tenant with booking-write off", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_reef_tours_au",
      slug: "reef-tours-au",
      name: "Reef Tours Australia",
      enabledFeatures: ["widget_config"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "REZDY",
    });

    expect(pack.tools).not.toContain("create_instant_booking");
    expect(pack.tools).not.toContain("capture_payment");
    expect(pack.paymentPolicy).toBe("no_payment_in_kai");
  });

  it("resolves BluePass as a marketplace pack with inquiry and referral tools only", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_bluepass",
      slug: "bluepass",
      name: "BluePass",
      enabledFeatures: [
        "widget_config",
        "bluepass_marketplace",
        "referral_attribution",
        "operator_whatsapp_dispatch",
      ],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "NATIVE",
    });

    expect(pack.kind).toBe("bluepass_marketplace");
    expect(pack.tools).toEqual([
      "search_bluepass_yachts",
      "create_bluepass_inquiry",
      "sync_referral_ledger_estimate",
      "dispatch_operator_whatsapp",
      "get_bluepass_inquiry_status",
      "handoff_to_operator",
    ]);
    expect(pack.paymentPolicy).toBe("operator_acceptance_required");
    expect(pack.tools).not.toContain("create_instant_booking");
    expect(pack.tools).not.toContain("capture_payment");
  });

  it("does not grant BluePass marketplace tools to a generic tenant", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_demo",
      slug: "kai-demo",
      name: "Kai Demo",
      enabledFeatures: ["widget_config", "mock_pms"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "MOCK",
    });

    expect(pack.kind).toBe("operator_direct");
    expect(pack.tools).toEqual([
      "product_search",
      "check_availability",
      "create_manual_inquiry",
      "handoff_to_operator",
    ]);
    expect(pack.tools).not.toContain("search_bluepass_yachts");
    expect(pack.paymentPolicy).toBe("no_payment_in_kai");
  });
});
