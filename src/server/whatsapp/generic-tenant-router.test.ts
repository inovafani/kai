import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { matchesTenantRegionKeywords, resolveWhatsAppGenericTenant } from "./generic-tenant-router";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

async function createTestPmsTenant(overrides?: {
  name?: string;
  productTitle?: string;
  productDescription?: string;
}) {
  const slug = `pms-router-test-${randomUUID()}`;

  return prisma.tenant.create({
    data: {
      slug,
      name: overrides?.name ?? "Reef Runner Charters",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: [],
      status: "ACTIVE",
      config: {
        create: {
          bookingMode: "AUTO_BOOKING",
          bookingWriteEnabled: false,
          pmsProvider: "REZDY",
          publicProductCatalog: [
            {
              publicTitle: overrides?.productTitle ?? "Sunset Reef Snorkel Adventure",
              publicDescription:
                overrides?.productDescription ?? "A guided snorkel trip over the outer reef at sunset.",
              pmsProductId: `test-product-${randomUUID()}`,
              bookingMode: "AUTO_BOOKING"
            }
          ],
          enabledFeatures: [],
          requiredSlots: {},
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
}

describe("resolveWhatsAppGenericTenant", () => {
  it("returns null when no allowlist is configured", async () => {
    delete process.env.WHATSAPP_GENERIC_TENANT_SLUGS;

    const result = await resolveWhatsAppGenericTenant("I want to book a liveaboard in Komodo");

    expect(result).toBeNull();
  });

  it("returns null for a BluePass-style message that doesn't match the allowlisted tenant", async () => {
    const tenant = await createTestPmsTenant();
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = tenant.slug;

    const result = await resolveWhatsAppGenericTenant(
      "Looking for a liveaboard trip to Raja Ampat for 4 guests in August"
    );

    expect(result).toBeNull();
  });

  it("matches when the message names the tenant's own product", async () => {
    const tenant = await createTestPmsTenant();
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = tenant.slug;

    const result = await resolveWhatsAppGenericTenant(
      "Do you have availability for the Sunset Reef Snorkel Adventure this weekend?"
    );

    expect(result?.tenant.slug).toBe(tenant.slug);
  });

  it("matches when the message names the tenant's own business", async () => {
    const tenant = await createTestPmsTenant({ name: "Reef Runner Charters" });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = tenant.slug;

    const result = await resolveWhatsAppGenericTenant("Hi, is this Reef Runner Charters?");

    expect(result?.tenant.slug).toBe(tenant.slug);
  });

  it("skips an allowlisted slug that has no matching active tenant row", async () => {
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = `nonexistent-${randomUUID()}`;

    const result = await resolveWhatsAppGenericTenant(
      "Do you have the Sunset Reef Snorkel Adventure available?"
    );

    expect(result).toBeNull();
  });

  it("checks multiple allowlisted tenants and matches the correct one", async () => {
    const otherTenant = await createTestPmsTenant({
      name: "Coastal Kayak Co",
      productTitle: "Mangrove Kayak Sunrise Paddle",
      productDescription: "A guided kayak paddle through the mangroves at sunrise."
    });
    const targetTenant = await createTestPmsTenant({ name: "Reef Runner Charters" });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = `${otherTenant.slug},${targetTenant.slug}`;

    const result = await resolveWhatsAppGenericTenant(
      "Do you have availability for the Sunset Reef Snorkel Adventure?"
    );

    expect(result?.tenant.slug).toBe(targetTenant.slug);
  });

  it("does not steal a generically-worded BluePass yacht-charter message against boattime's real catalog", async () => {
    const boattime = await prisma.tenant.create({
      data: {
        slug: `boattime-collision-test-${randomUUID()}`,
        name: "Boattime Yacht Charters",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: [],
        status: "ACTIVE",
        config: {
          create: {
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "REZDY",
            publicProductCatalog: [
              {
                publicTitle: "Gold Coast Whale Escape",
                publicDescription: "Luxury whale watching cruise",
                pmsProductId: "PGG8QT",
                bookingMode: "AUTO_BOOKING"
              },
              {
                publicTitle: "Twilight Drift",
                publicDescription: "Broadwater sunset tour and scenic cruise",
                pmsProductId: "P4APMF",
                bookingMode: "AUTO_BOOKING"
              },
              {
                publicTitle: "Broadwater Twilight Dining",
                publicDescription: "Gold Coast buffet dinner cruise",
                pmsProductId: "P1D0SB",
                bookingMode: "AUTO_BOOKING"
              },
              {
                publicTitle: "Coastal Lunch Escape",
                publicDescription: "Gold Coast daytime dining cruise",
                pmsProductId: "PJEJ0P",
                bookingMode: "AUTO_BOOKING"
              },
              {
                publicTitle: "Private Yacht Charter",
                publicDescription: "Tailored private yacht charter requiring operator confirmation",
                pmsProductId: "boattime-private-yacht-charter",
                bookingMode: "MANUAL_INQUIRY"
              }
            ],
            enabledFeatures: [],
            requiredSlots: {},
            escalationRules: [],
            responseGuardrails: []
          }
        }
      }
    });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = boattime.slug;

    const result = await resolveWhatsAppGenericTenant(
      "I want a private yacht charter in Komodo for 6 guests"
    );

    expect(result).toBeNull();
  });

  it("resolves the real bluepass-au tenant for a bare region mention with no specific product named", async () => {
    // Regression: a generic "I want to trip in Australia" never scores against any single AU
    // product distinctly enough for matchPmsProduct to resolve it (see
    // matchesTenantRegionKeywords's own doc comment) - this proves the region-keyword escape hatch
    // actually closes that gap for the one tenant it's scoped to, using the tenant already seeded
    // in the shared database (not a throwaway test fixture), since the check is keyed by that exact
    // slug.
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = "bluepass-au";

    const result = await resolveWhatsAppGenericTenant("i want to trip in australia");

    expect(result?.tenant.slug).toBe("bluepass-au");
  });

  it("does not resolve bluepass-au for an ordinary Indonesia-flavored BluePass message", async () => {
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = "bluepass-au";

    const result = await resolveWhatsAppGenericTenant(
      "I want a liveaboard trip to Komodo for 6 guests next month"
    );

    expect(result).toBeNull();
  });
});

describe("matchesTenantRegionKeywords", () => {
  it("matches bluepass-au on a bare region mention", () => {
    expect(matchesTenantRegionKeywords("bluepass-au", "i want to trip in australia")).toBe(true);
    expect(matchesTenantRegionKeywords("bluepass-au", "any trips to the Gold Coast?")).toBe(true);
    expect(matchesTenantRegionKeywords("bluepass-au", "looking at Queensland options")).toBe(true);
  });

  it("does not match bluepass-au for an unrelated message", () => {
    expect(matchesTenantRegionKeywords("bluepass-au", "I want a liveaboard in Komodo")).toBe(false);
  });

  it("does not match any keyword for a tenant slug with no configured region", () => {
    expect(matchesTenantRegionKeywords("boattime", "I want to trip in australia")).toBe(false);
  });
});
