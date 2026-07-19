import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  matchesTenantRegionKeywords,
  resolveStickyWhatsAppGenericTenant,
  resolveWhatsAppGenericTenant,
  resolveWhatsAppTenantForMessage
} from "./generic-tenant-router";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

function randomTestPhone() {
  return `6281199${randomUUID().replace(/\D/g, "").slice(0, 7)}`;
}

async function createBluePassStandInTenant(name: string) {
  const slug = `bluepass-standin-${randomUUID()}`;
  await prisma.tenant.create({
    data: {
      slug,
      name,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: [],
      status: "ACTIVE"
    }
  });
  return slug;
}

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

describe("resolveStickyWhatsAppGenericTenant", () => {
  it("sticks to the allowlisted tenant this phone most recently talked to", async () => {
    const genericTenant = await createTestPmsTenant({ name: `Sticky Recent ${randomUUID()}` });
    const bluePassSlug = await createBluePassStandInTenant("BluePass Sticky Stand-in A");
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = genericTenant.slug;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = bluePassSlug;
    const phone = randomTestPhone();

    await prisma.conversation.create({
      data: { tenantId: genericTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });

    const result = await resolveStickyWhatsAppGenericTenant(phone);

    expect(result?.tenant.slug).toBe(genericTenant.slug);
  });

  it("returns null when BluePass's own conversation for this phone is the more recent one", async () => {
    const genericTenant = await createTestPmsTenant({ name: `Sticky Stale ${randomUUID()}` });
    const bluePassSlug = await createBluePassStandInTenant("BluePass Sticky Stand-in B");
    const bluePassTenant = await prisma.tenant.findFirstOrThrow({ where: { slug: bluePassSlug } });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = genericTenant.slug;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = bluePassSlug;
    const phone = randomTestPhone();

    await prisma.conversation.create({
      data: { tenantId: genericTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });
    await prisma.conversation.create({
      data: { tenantId: bluePassTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });

    const result = await resolveStickyWhatsAppGenericTenant(phone);

    expect(result).toBeNull();
  });

  it("returns null when this phone has no WhatsApp conversation history at all", async () => {
    const genericTenant = await createTestPmsTenant({ name: `Sticky None ${randomUUID()}` });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = genericTenant.slug;

    const result = await resolveStickyWhatsAppGenericTenant(randomTestPhone());

    expect(result).toBeNull();
  });
});

describe("resolveWhatsAppTenantForMessage", () => {
  it("regression: stays with the AU tenant for a generic follow-up with no region keyword, instead of falling back to BluePass/Komodo", async () => {
    // Reproduces the exact bug found live: traveller says "id like to travel in australia" (routes
    // to bluepass-au, creating its Conversation row), then later says something generic like "Show
    // me yachts" with no region word in it - before this fix, that silently fell through to
    // BluePass's own separate Komodo conversation instead of continuing the Australia thread.
    const auTenant = await createTestPmsTenant({ name: `AU Regression ${randomUUID()}` });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = auTenant.slug;
    const phone = randomTestPhone();

    await prisma.conversation.create({
      data: { tenantId: auTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });

    const result = await resolveWhatsAppTenantForMessage({ messageText: "Show me yachts", fromPhone: phone });

    expect(result?.tenant.slug).toBe(auTenant.slug);
  });

  it("a 'new chat' reset always overrides stickiness", async () => {
    const auTenant = await createTestPmsTenant({ name: `AU Reset Override ${randomUUID()}` });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = auTenant.slug;
    const phone = randomTestPhone();
    await prisma.conversation.create({
      data: { tenantId: auTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });

    const result = await resolveWhatsAppTenantForMessage({ messageText: "new chat", fromPhone: phone });

    expect(result).toBeNull();
  });

  it("an explicit Indonesia-market mention always overrides stickiness", async () => {
    const auTenant = await createTestPmsTenant({ name: `AU Indonesia Override ${randomUUID()}` });
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = auTenant.slug;
    const phone = randomTestPhone();
    await prisma.conversation.create({
      data: { tenantId: auTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });

    const result = await resolveWhatsAppTenantForMessage({
      messageText: "actually can we talk about Komodo instead",
      fromPhone: phone
    });

    expect(result).toBeNull();
  });

  it("an explicit product match still wins even with no sticky history", async () => {
    const tenant = await createTestPmsTenant();
    process.env.WHATSAPP_GENERIC_TENANT_SLUGS = tenant.slug;

    const result = await resolveWhatsAppTenantForMessage({
      messageText: "Do you have availability for the Sunset Reef Snorkel Adventure this weekend?",
      fromPhone: randomTestPhone()
    });

    expect(result?.tenant.slug).toBe(tenant.slug);
  });
});
