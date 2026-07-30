import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "@/core/tenant/feature-flags";
import {
  matchesTenantRegionKeywords,
  resolveStickyWhatsAppGenericTenant,
  resolveWhatsAppGenericTenant,
  resolveWhatsAppTenantForMessage
} from "./generic-tenant-router";

vi.mock("@/server/whatsapp/client", () => ({
  sendWhatsAppText: vi.fn().mockResolvedValue(undefined)
}));

const originalEnv = { ...process.env };
// Every tenant this file creates uses one of these slug prefixes - cleaned up after every test so
// it never lingers as "eligible" for a later (or concurrently-running) test's global
// resolveWhatsAppGenericTenant()/listAuRecommendationCandidates() query, now that there is no more
// per-test env-var scoping to isolate this.
// bluepass-standin-gtr- (not the plain "bluepass-standin-" also used by
// au-operator-recommendation.test.ts) so this file's afterEach cleanup (a startsWith prefix delete)
// can never sweep up that OTHER file's still-in-progress stand-in tenant when both run in the same
// vitest invocation - confirmed live as a real cross-file race (foreign-key errors on both sides)
// when the two files shared this exact prefix.
const testTenantSlugPrefixes = ["pms-router-test-", "bluepass-standin-gtr-", "boattime-collision-test-"];

// Scopes listWhatsAppGenericEligibleTenants() to just this file's own test tenants, so real,
// live-flagged tenants in this shared dev DB (e.g. the real "bluepass-au", which today matches
// TENANT_REGION_KEYWORDS on a bare "australia" mention) never leak into these tests. This can't be
// done by mocking generic-tenant-router's own exported listWhatsAppGenericEligibleTenants: every
// caller in this file (resolveWhatsAppGenericTenant, resolveStickyWhatsAppGenericTenant) is defined
// in - and calls it from - that same module, as a plain local call rather than through the imported
// binding, so vi.mock on that module has zero effect on those call sites. Spying on
// prisma.tenant.findMany instead works regardless of which module makes the call, since every caller
// shares the one real PrismaClient singleton.
const realTenantFindMany = prisma.tenant.findMany.bind(prisma.tenant);
// Untyped on purpose: Prisma's generated findMany signature is a complex conditional generic that
// isn't worth fighting for a test-only mock - the runtime behavior (filter results, pass everything
// else through) is what matters here, not a precise static type for the spy itself.
let tenantFindManySpy: any;

beforeAll(() => {
  tenantFindManySpy = (vi.spyOn(prisma.tenant, "findMany") as any).mockImplementation(async (args: any) => {
    const results = await realTenantFindMany(args);
    const isEligibilityQuery = args?.where?.config?.enabledFeatures?.has === WHATSAPP_GENERIC_ELIGIBLE_FEATURE;
    if (!isEligibilityQuery) return results;
    return (results as Array<{ slug: string }>).filter((tenant) =>
      testTenantSlugPrefixes.some((prefix) => tenant.slug.startsWith(prefix))
    );
  });
});

afterAll(() => {
  tenantFindManySpy.mockRestore();
});

// Neutralizes the AU-operator-recommendation tier's BluePass-conversation-home lookup by default,
// since it does real writes (Conversation/Message rows) and would otherwise resolve against
// whatever real "bluepass" tenant exists in this DB. Tests that specifically want BluePass stand-in
// behavior already set WHATSAPP_BLUEPASS_TENANT_SLUG themselves via createBluePassStandInTenant,
// which overrides this default within that test.
beforeEach(() => {
  process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = "no-such-bluepass-tenant-in-tests";
});

afterEach(async () => {
  process.env = { ...originalEnv };
  await prisma.tenant.deleteMany({
    where: { OR: testTenantSlugPrefixes.map((prefix) => ({ slug: { startsWith: prefix } })) }
  });
});

function randomTestPhone() {
  return `6281199${randomUUID().replace(/\D/g, "").slice(0, 7)}`;
}

async function createBluePassStandInTenant(name: string) {
  const slug = `bluepass-standin-gtr-${randomUUID()}`;
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

// Stickiness is measured off the Message table, not Conversation.updatedAt (see
// resolveStickyWhatsAppGenericTenant's own doc comment) - a bare Conversation row with no message
// looks identical to one that was never actually talked in, so every sticky test needs a real
// message to represent "this phone actually said something to this tenant."
async function createConversationWithMessage(input: { tenantId: string; whatsappPhone: string; content?: string }) {
  const conversation = await prisma.conversation.create({
    data: { tenantId: input.tenantId, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: input.whatsappPhone }
  });
  await prisma.message.create({
    data: {
      tenantId: input.tenantId,
      conversationId: conversation.id,
      role: "TRAVELLER",
      content: input.content ?? "hi"
    }
  });
  return conversation;
}

// Every tenant created here is automatically eligible for the shared WhatsApp number's generic
// routing (WHATSAPP_GENERIC_ELIGIBLE_FEATURE) - replaces the old WHATSAPP_GENERIC_TENANT_SLUGS
// env-var allowlist. Names/product titles should stay specific per test (randomized where the test
// doesn't care about a particular one) since resolveWhatsAppGenericTenant now checks every eligible
// tenant in the whole shared database, not just the ones a given test created.
async function createTestPmsTenant(overrides?: { name?: string; productTitle?: string; productDescription?: string }) {
  const slug = `pms-router-test-${randomUUID()}`;

  return prisma.tenant.create({
    data: {
      slug,
      name: overrides?.name ?? `Reef Runner Charters ${randomUUID()}`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: [],
      status: "ACTIVE",
      config: {
        create: {
          bookingMode: "AUTO_BOOKING",
          bookingWriteEnabled: false,
          // MOCK, not REZDY: publicProductCatalog below is non-empty so MappedPmsAdapter always
          // wins here regardless of provider, but MOCK also protects any OTHER (concurrent or
          // leftover) test that reaches this tenant from ever triggering a real network call.
          pmsProvider: "MOCK",
          publicProductCatalog: [
            {
              publicTitle: overrides?.productTitle ?? `Sunset Reef Snorkel Adventure ${randomUUID()}`,
              publicDescription:
                overrides?.productDescription ?? "A guided snorkel trip over the outer reef at sunset.",
              pmsProductId: `test-product-${randomUUID()}`,
              bookingMode: "AUTO_BOOKING"
            }
          ],
          enabledFeatures: [WHATSAPP_GENERIC_ELIGIBLE_FEATURE],
          requiredSlots: {},
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
}

describe("resolveWhatsAppGenericTenant", () => {
  it("returns null for a BluePass-style message that doesn't match any eligible tenant", async () => {
    await createTestPmsTenant();

    const result = await resolveWhatsAppGenericTenant(
      `Looking for a liveaboard trip to Raja Ampat for 4 guests in August ${randomUUID()}`
    );

    expect(result).toBeNull();
  });

  it("matches when the message names the tenant's own product", async () => {
    const productTitle = `Sunset Reef Snorkel Adventure ${randomUUID()}`;
    const tenant = await createTestPmsTenant({ productTitle });

    const result = await resolveWhatsAppGenericTenant(`Do you have availability for the ${productTitle} this weekend?`);

    expect(result?.tenant.slug).toBe(tenant.slug);
  });

  it("matches when the message names the tenant's own business", async () => {
    const name = `Reef Runner Charters ${randomUUID()}`;
    const tenant = await createTestPmsTenant({ name });

    const result = await resolveWhatsAppGenericTenant(`Hi, is this ${name}?`);

    expect(result?.tenant.slug).toBe(tenant.slug);
  });

  it("checks multiple eligible tenants and matches the correct one", async () => {
    const otherProductTitle = `Mangrove Kayak Sunrise Paddle ${randomUUID()}`;
    await createTestPmsTenant({
      name: `Coastal Kayak Co ${randomUUID()}`,
      productTitle: otherProductTitle,
      productDescription: "A guided kayak paddle through the mangroves at sunrise."
    });
    const targetProductTitle = `Sunset Reef Snorkel Adventure ${randomUUID()}`;
    const targetTenant = await createTestPmsTenant({
      name: `Reef Runner Charters ${randomUUID()}`,
      productTitle: targetProductTitle
    });

    const result = await resolveWhatsAppGenericTenant(`Do you have availability for the ${targetProductTitle}?`);

    expect(result?.tenant.slug).toBe(targetTenant.slug);
  }, 15_000);

  it("does not steal a generically-worded BluePass yacht-charter message against boattime's real catalog", async () => {
    const boattime = await prisma.tenant.create({
      data: {
        slug: `boattime-collision-test-${randomUUID()}`,
        name: `Boattime Yacht Charters ${randomUUID()}`,
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: [],
        status: "ACTIVE",
        config: {
          create: {
            bookingMode: "MANUAL_INQUIRY",
            bookingWriteEnabled: false,
            pmsProvider: "MOCK",
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
            enabledFeatures: [WHATSAPP_GENERIC_ELIGIBLE_FEATURE],
            requiredSlots: {},
            escalationRules: [],
            responseGuardrails: []
          }
        }
      }
    });

    const result = await resolveWhatsAppGenericTenant("I want a private yacht charter in Komodo for 6 guests");

    expect(result?.tenant.slug === boattime.slug).toBe(false);
  });

  it("does not resolve any specific tenant for a bare region mention with no specific product named", async () => {
    // A generic "I want to trip in Australia" never scores against any single AU product distinctly
    // enough for matchPmsProduct to resolve it, and (unlike an earlier version of this behavior) is
    // now deliberately NOT resolved here via a region-keyword shortcut either - now that
    // listAuRecommendationCandidates() can hold more than one eligible AU tenant, guessing "the" AU
    // tenant from a bare region mention would silently bypass the pick-an-operator recommendation the
    // moment a second real operator is flagged eligible. See matchesTenantRegionKeywords's own doc
    // comment: that keyword set now only feeds resolveWhatsAppTenantForMessage's last-resort
    // recommendation trigger, not this function's explicit-match tier.
    const result = await resolveWhatsAppGenericTenant("i want to trip in australia");

    expect(result).toBeNull();
  });

  it("does not resolve bluepass-au for an ordinary Indonesia-flavored BluePass message", async () => {
    const result = await resolveWhatsAppGenericTenant("I want a liveaboard trip to Komodo for 6 guests next month");

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
  it("sticks to the eligible tenant this phone most recently talked to", async () => {
    const genericTenant = await createTestPmsTenant({ name: `Sticky Recent ${randomUUID()}` });
    const bluePassSlug = await createBluePassStandInTenant("BluePass Sticky Stand-in A");
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = bluePassSlug;
    const phone = randomTestPhone();

    await createConversationWithMessage({ tenantId: genericTenant.id, whatsappPhone: phone });

    const result = await resolveStickyWhatsAppGenericTenant(phone);

    expect(result?.tenant.slug).toBe(genericTenant.slug);
  });

  it("returns null when BluePass's own conversation for this phone is the more recent one", async () => {
    const genericTenant = await createTestPmsTenant({ name: `Sticky Stale ${randomUUID()}` });
    const bluePassSlug = await createBluePassStandInTenant("BluePass Sticky Stand-in B");
    const bluePassTenant = await prisma.tenant.findFirstOrThrow({ where: { slug: bluePassSlug } });
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = bluePassSlug;
    const phone = randomTestPhone();

    await createConversationWithMessage({ tenantId: genericTenant.id, whatsappPhone: phone });
    await createConversationWithMessage({ tenantId: bluePassTenant.id, whatsappPhone: phone });

    const result = await resolveStickyWhatsAppGenericTenant(phone);

    expect(result).toBeNull();
  }, 15_000);

  it("returns null when this phone has no WhatsApp conversation history at all", async () => {
    await createTestPmsTenant({ name: `Sticky None ${randomUUID()}` });

    const result = await resolveStickyWhatsAppGenericTenant(randomTestPhone());

    expect(result).toBeNull();
  });
});

describe("resolveWhatsAppTenantForMessage", () => {
  it("regression: stays with the AU tenant for a generic follow-up with no region keyword, instead of falling back to BluePass/Komodo", async () => {
    // Reproduces the exact bug found live: traveller says "id like to travel in australia" (routes
    // to the AU tenant, creating its Conversation row), then later says something generic like "Show
    // me yachts" with no region word in it - before this fix, that silently fell through to
    // BluePass's own separate Komodo conversation instead of continuing the Australia thread.
    const auTenant = await createTestPmsTenant({ name: `AU Regression ${randomUUID()}` });
    const phone = randomTestPhone();

    await createConversationWithMessage({
      tenantId: auTenant.id,
      whatsappPhone: phone,
      content: "i want to travel in australia"
    });

    const result = await resolveWhatsAppTenantForMessage({ messageText: "Show me yachts", fromPhone: phone });

    expect(result.kind).toBe("TENANT");
    expect(result.kind === "TENANT" ? result.tenant.slug : null).toBe(auTenant.slug);
  }, 15_000);

  it("a 'new chat' reset always overrides stickiness", async () => {
    const auTenant = await createTestPmsTenant({ name: `AU Reset Override ${randomUUID()}` });
    const phone = randomTestPhone();
    await prisma.conversation.create({
      data: { tenantId: auTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });

    const result = await resolveWhatsAppTenantForMessage({ messageText: "new chat", fromPhone: phone });

    expect(result).toEqual({ kind: "NONE" });
  });

  it("an explicit Indonesia-market mention always overrides stickiness", async () => {
    const auTenant = await createTestPmsTenant({ name: `AU Indonesia Override ${randomUUID()}` });
    const phone = randomTestPhone();
    await prisma.conversation.create({
      data: { tenantId: auTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });

    const result = await resolveWhatsAppTenantForMessage({
      messageText: "actually can we talk about Komodo instead",
      fromPhone: phone
    });

    expect(result).toEqual({ kind: "NONE" });
  });

  it("an explicit product match still wins even with no sticky history", async () => {
    const productTitle = `Sunset Reef Snorkel Adventure ${randomUUID()}`;
    const tenant = await createTestPmsTenant({ productTitle });

    const result = await resolveWhatsAppTenantForMessage({
      messageText: `Do you have availability for the ${productTitle} this weekend?`,
      fromPhone: randomTestPhone()
    });

    expect(result.kind).toBe("TENANT");
    expect(result.kind === "TENANT" ? result.tenant.slug : null).toBe(tenant.slug);
  });

  it("shows the AU operator recommendation as a last resort when nothing else matches", async () => {
    const bluePassSlug = await createBluePassStandInTenant("BluePass AU Recommend Stand-in");
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = bluePassSlug;
    await createTestPmsTenant({ name: `Test AU Operator ${randomUUID()}` });

    const result = await resolveWhatsAppTenantForMessage({
      messageText: "I want a boat charter in australia",
      fromPhone: randomTestPhone()
    });

    expect(result).toEqual({ kind: "HANDLED" });
  }, 15_000);

  it("hands off to the real AU operator when the traveller picks it by name from the recommendation", async () => {
    const bluePassSlug = await createBluePassStandInTenant("BluePass AU Pick Stand-in");
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = bluePassSlug;
    const operatorName = `Test AU Operator ${randomUUID()}`;
    const realTenant = await createTestPmsTenant({ name: operatorName });
    const phone = randomTestPhone();

    await resolveWhatsAppTenantForMessage({ messageText: "boat charter in australia", fromPhone: phone });
    // Pick by the exact (randomized, collision-free) name rather than a numbered position - other
    // eligible tenants in this shared database may also appear in the list, at any position.
    const result = await resolveWhatsAppTenantForMessage({ messageText: operatorName, fromPhone: phone });

    expect(result.kind).toBe("TENANT");
    expect(result.kind === "TENANT" ? result.tenant.slug : null).toBe(realTenant.slug);
  }, 25_000);
});
