import { describe, expect, it } from "vitest";
import { resolveBusinessPack } from "@/core/business-pack/registry";
import { buildBusinessPackGateReply, shouldUseGenericBookingFlow } from "./business-pack-gate";

describe("business pack message gate", () => {
  it("allows operator direct tenants to use the generic booking flow", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_boattime",
      slug: "boattime",
      name: "Boattime Yacht Charters",
      enabledFeatures: ["widget_config"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "REZDY"
    });

    expect(shouldUseGenericBookingFlow(pack)).toBe(true);
    expect(buildBusinessPackGateReply(pack)).toBeNull();
  });

  it("routes BluePass marketplace tenants away from the generic booking flow", () => {
    const pack = resolveBusinessPack({
      tenantId: "tenant_bluepass",
      slug: "bluepass",
      name: "BluePass",
      enabledFeatures: ["widget_config", "bluepass_marketplace"],
      bookingMode: "MANUAL_INQUIRY",
      bookingWriteEnabled: false,
      pmsProvider: "NATIVE"
    });

    expect(shouldUseGenericBookingFlow(pack)).toBe(false);
    expect(buildBusinessPackGateReply(pack)).toEqual({
      content:
        "I can help shape this BluePass request, but I will route marketplace availability, referral context, and operator follow-up through the BluePass inquiry flow instead of confirming a booking here.",
      businessPack: {
        kind: "bluepass_marketplace",
        paymentPolicy: "operator_acceptance_required",
        truthPolicy: {
          availabilitySource: "preview_catalog",
          priceSource: "preview_catalog",
          bookingConfirmationSource: "operator_admin"
        }
      }
    });
  });
});
