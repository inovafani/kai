import { describe, expect, it } from "vitest";
import { resolveTenantBusinessPack } from "./resolve-tenant-business-pack";

const baseTenant = {
  id: "tenant_1",
  slug: "kai-demo",
  name: "Kai Demo",
  config: {
    enabledFeatures: ["widget_config"],
    bookingMode: "MANUAL_INQUIRY",
    bookingWriteEnabled: false,
    pmsProvider: "MOCK" as const,
  },
};

describe("resolveTenantBusinessPack", () => {
  it("resolves a Prisma-like tenant record", () => {
    expect(resolveTenantBusinessPack(baseTenant)).toEqual(
      expect.objectContaining({
        tenantId: "tenant_1",
        slug: "kai-demo",
        kind: "operator_direct",
        paymentPolicy: "no_payment_in_kai",
      }),
    );
  });

  it("defaults missing config safely", () => {
    expect(
      resolveTenantBusinessPack({
        id: "tenant_no_config",
        slug: "empty",
        name: "Empty Tenant",
        config: null,
      }),
    ).toEqual(
      expect.objectContaining({
        tenantId: "tenant_no_config",
        tools: [
          "product_search",
          "check_availability",
          "create_manual_inquiry",
          "handoff_to_operator",
        ],
        paymentPolicy: "no_payment_in_kai",
      }),
    );
  });

  it("resolves BluePass from enabled feature", () => {
    const pack = resolveTenantBusinessPack({
      ...baseTenant,
      id: "tenant_bluepass",
      slug: "bluepass",
      name: "BluePass",
      config: {
        enabledFeatures: ["widget_config", "bluepass_marketplace"],
        bookingMode: "MANUAL_INQUIRY",
        bookingWriteEnabled: false,
        pmsProvider: "NATIVE",
      },
    });

    expect(pack.kind).toBe("bluepass_marketplace");
    expect(pack.paymentPolicy).toBe("operator_acceptance_required");
  });
});
