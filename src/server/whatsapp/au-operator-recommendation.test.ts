import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { AU_RECOMMENDATION_PLACEHOLDER_FEATURE, WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "@/core/tenant/feature-flags";
import {
  buildAuOperatorRecommendationReply,
  listAuRecommendationCandidates,
  resolveAuOperatorRecommendationPick,
  resolveAuOperatorRecommendationSelection,
  triggerAuOperatorRecommendation
} from "./au-operator-recommendation";

vi.mock("@/server/whatsapp/client", () => ({
  sendWhatsAppText: vi.fn().mockResolvedValue(undefined)
}));

const originalEnv = { ...process.env };
// Every tenant this file creates uses one of these slug prefixes - cleaned up after every test so
// it never lingers as "eligible" for a later test's global listAuRecommendationCandidates()/
// resolveWhatsAppGenericTenant() query (there is no more per-test env-var scoping to isolate this).
// bluepass-standin-aor- (not the plain "bluepass-standin-" also used by
// generic-tenant-router.test.ts) so this file's afterEach cleanup (a startsWith prefix delete) can
// never sweep up that OTHER file's still-in-progress stand-in tenant when both run in the same
// vitest invocation - confirmed live as a real cross-file race (foreign-key errors on both sides)
// when the two files shared this exact prefix.
const testTenantSlugPrefixes = ["bluepass-standin-aor-", "au-real-", "au-placeholder-"];

// Scopes both of listAuRecommendationCandidates' queries (real tenants via
// WHATSAPP_GENERIC_ELIGIBLE_FEATURE, placeholders via AU_RECOMMENDATION_PLACEHOLDER_FEATURE) to just
// this file's own test tenants - without this, a real seeded tenant (or, when this file runs
// concurrently with sibling test files like generic-tenant-router.test.ts, one of THEIR test tenants)
// can appear as a candidate here, and worse, get deleted mid-test by the OTHER file's own cleanup,
// causing a foreign-key error (confirmed live: "Foreign key constraint violated on
// Message_conversationId_fkey"/"Conversation_tenantId_fkey" when this file ran alongside
// generic-tenant-router.test.ts in one vitest invocation). Same reasoning as
// generic-tenant-router.test.ts's own spy: this can't be done by mocking
// listWhatsAppGenericEligibleTenants's exported binding, since listAuRecommendationCandidates calls
// it as a plain local import-level call, not through anything vi.mock can intercept from this file.
const realTenantFindMany = prisma.tenant.findMany.bind(prisma.tenant);
let tenantFindManySpy: any;

beforeAll(() => {
  tenantFindManySpy = (vi.spyOn(prisma.tenant, "findMany") as any).mockImplementation(async (args: any) => {
    const results = await realTenantFindMany(args);
    const enabledFeature = args?.where?.config?.enabledFeatures?.has;
    const isScopedQuery =
      enabledFeature === WHATSAPP_GENERIC_ELIGIBLE_FEATURE || enabledFeature === AU_RECOMMENDATION_PLACEHOLDER_FEATURE;
    if (!isScopedQuery) return results;
    return (results as Array<{ slug: string }>).filter((tenant) =>
      testTenantSlugPrefixes.some((prefix) => tenant.slug.startsWith(prefix))
    );
  });
});

afterAll(() => {
  tenantFindManySpy.mockRestore();
});

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

async function createBluePassStandIn() {
  const slug = `bluepass-standin-aor-${randomUUID()}`;
  await prisma.tenant.create({
    data: { slug, name: "BluePass", widgetPublicKey: `pk_${randomUUID()}`, allowedOrigins: [], status: "ACTIVE" }
  });
  return slug;
}

// Named uniquely per call (never a fixed literal) so it can never collide with a real seeded
// tenant's name (e.g. the real "bluepass-au" tenant) sharing the same shared test database - tests
// that pick a candidate by name depend on that name being unambiguous.
async function createRealCandidate(name = `Test AU Operator ${randomUUID()}`) {
  const slug = `au-real-${randomUUID()}`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: [],
      status: "ACTIVE",
      config: {
        create: {
          bookingMode: "AUTO_BOOKING",
          bookingWriteEnabled: true,
          // MOCK, not REZDY: this tenant is globally "eligible" the moment it's created, so any
          // concurrently-running test's resolveWhatsAppGenericTenant() query may reach it too -
          // MOCK guarantees that can never trigger a real network call, unlike REZDY with no
          // static publicProductCatalog to short-circuit it.
          pmsProvider: "MOCK",
          publicProductCatalog: [],
          enabledFeatures: [WHATSAPP_GENERIC_ELIGIBLE_FEATURE],
          requiredSlots: {},
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
  return { slug, tenant };
}

async function createPlaceholderCandidate(name = `Test Placeholder Operator ${randomUUID()}`) {
  const slug = `au-placeholder-${randomUUID()}`;
  const tenant = await prisma.tenant.create({
    data: {
      slug,
      name,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: [],
      status: "ACTIVE",
      config: {
        create: {
          bookingMode: "MANUAL_INQUIRY",
          bookingWriteEnabled: false,
          pmsProvider: "MOCK",
          publicProductCatalog: [],
          enabledFeatures: [AU_RECOMMENDATION_PLACEHOLDER_FEATURE],
          requiredSlots: {},
          escalationRules: [],
          responseGuardrails: []
        }
      }
    }
  });
  return { slug, tenant };
}

describe("listAuRecommendationCandidates", () => {
  it("combines real (eligible) and placeholder tenants", async () => {
    const { slug: realSlug } = await createRealCandidate();
    const { slug: placeholderSlug } = await createPlaceholderCandidate();

    const candidates = await listAuRecommendationCandidates();

    expect(candidates.some((candidate) => candidate.slug === realSlug && candidate.isPlaceholder === false)).toBe(true);
    expect(candidates.some((candidate) => candidate.slug === placeholderSlug && candidate.isPlaceholder === true)).toBe(
      true
    );
  }, 15_000);
});

describe("buildAuOperatorRecommendationReply / resolveAuOperatorRecommendationSelection (pure)", () => {
  const candidates = [
    { tenantId: "t1", slug: "test-real", name: "Test Real Operator", isPlaceholder: false },
    { tenantId: "t2", slug: "test-placeholder", name: "Test Placeholder Operator", isPlaceholder: true }
  ];
  const lastAssistantMessage = buildAuOperatorRecommendationReply(candidates);

  it("resolves a numbered pick", () => {
    expect(resolveAuOperatorRecommendationSelection({ lastAssistantMessage, message: "1", candidates })).toEqual(
      candidates[0]
    );
    expect(resolveAuOperatorRecommendationSelection({ lastAssistantMessage, message: "2", candidates })).toEqual(
      candidates[1]
    );
  });

  it("resolves a name-based pick", () => {
    expect(
      resolveAuOperatorRecommendationSelection({ lastAssistantMessage, message: "Test Real Operator please", candidates })
    ).toEqual(candidates[0]);
  });

  // Regression: confirmed live that "what is Test Real Operator?" right after the recommendation was
  // shown got silently treated as picking option 1 (the question mentions the candidate's name, and
  // the old code matched on any substring), so the actual question was never answered - the traveller
  // just got the canned handoff reply instead.
  it("does not resolve a question that merely mentions the candidate's name", () => {
    expect(
      resolveAuOperatorRecommendationSelection({
        lastAssistantMessage,
        message: "what is Test Real Operator?",
        candidates
      })
    ).toBeNull();
    expect(
      resolveAuOperatorRecommendationSelection({
        lastAssistantMessage,
        message: "explain Test Real Operator",
        candidates
      })
    ).toBeNull();
    expect(
      resolveAuOperatorRecommendationSelection({
        lastAssistantMessage,
        message: "tell me about Test Real Operator",
        candidates
      })
    ).toBeNull();
  });

  it("returns null when the last assistant message was not this recommendation", () => {
    expect(
      resolveAuOperatorRecommendationSelection({ lastAssistantMessage: "How many guests?", message: "1", candidates })
    ).toBeNull();
  });

  it("returns null when the reply matches neither option", () => {
    expect(
      resolveAuOperatorRecommendationSelection({ lastAssistantMessage, message: "what about tomorrow?", candidates })
    ).toBeNull();
  });

  it("returns null with an empty candidate list", () => {
    expect(
      resolveAuOperatorRecommendationSelection({ lastAssistantMessage: "anything", message: "1", candidates: [] })
    ).toBeNull();
  });

  it("scales to 3+ candidates", () => {
    const three = [...candidates, { tenantId: "t3", slug: "test-third", name: "Great Barrier Adventures", isPlaceholder: true }];
    const reply = buildAuOperatorRecommendationReply(three);

    expect(resolveAuOperatorRecommendationSelection({ lastAssistantMessage: reply, message: "3", candidates: three })).toEqual(
      three[2]
    );
  });
});

describe("triggerAuOperatorRecommendation", () => {
  it("returns NONE when isAuRegionSignal is false", async () => {
    const result = await triggerAuOperatorRecommendation({
      messageText: "anything",
      fromPhone: randomTestPhone(),
      isAuRegionSignal: false
    });
    expect(result).toEqual({ kind: "NONE" });
  }, 15_000);

  it("sends the recommendation when triggered", async () => {
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = await createBluePassStandIn();
    await createRealCandidate();

    const result = await triggerAuOperatorRecommendation({
      messageText: "boat charter in australia",
      fromPhone: randomTestPhone(),
      isAuRegionSignal: true
    });

    expect(result).toEqual({ kind: "HANDLED" });
  }, 15_000);
});

describe("resolveAuOperatorRecommendationPick", () => {
  it("returns NONE when no recommendation was shown yet", async () => {
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = await createBluePassStandIn();
    await createRealCandidate();

    const result = await resolveAuOperatorRecommendationPick({ messageText: "1", fromPhone: randomTestPhone() });

    expect(result).toEqual({ kind: "NONE" });
  }, 15_000);

  it("hands off to the real tenant when picked by name, seeding it for stickiness with a live product list", async () => {
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = await createBluePassStandIn();
    const operatorName = `Test AU Operator ${randomUUID()}`;
    const { tenant: realTenant } = await createRealCandidate(operatorName);
    const phone = randomTestPhone();

    await triggerAuOperatorRecommendation({
      messageText: "boat charter in australia",
      fromPhone: phone,
      isAuRegionSignal: true
    });

    // Pick by exact (randomized, collision-free) name rather than a numbered position - other
    // eligible/placeholder tenants in this shared database may also appear in the list, at any
    // position.
    const pickResult = await resolveAuOperatorRecommendationPick({ messageText: operatorName, fromPhone: phone });

    // HANDLED, not TENANT: this pick message has already been fully answered (the assertions below
    // prove the seeded conversation + reply), so the caller must never also replay it through the
    // generic booking engine - see resolveAuOperatorRecommendationPick's own comment for the bug this
    // fixed (a second, confusing reply on top of whatever stale state the tenant+phone already had).
    expect(pickResult).toEqual({ kind: "HANDLED" });

    const realTenantConversation = await prisma.conversation.findFirst({
      where: { tenantId: realTenant.id, whatsappPhone: phone }
    });
    expect(realTenantConversation).not.toBeNull();

    const seededMessage = await prisma.message.findFirst({
      where: { conversationId: realTenantConversation!.id, role: "ASSISTANT" },
      orderBy: { createdAt: "desc" }
    });
    expect(seededMessage?.content).toContain(`Connecting you with ${operatorName}`);
    // Proves the handoff shows this tenant's actual live product list (formatRecommendationReply's
    // fixed closing line) instead of the old vague "what would you like to explore?" the traveller
    // had no way to answer without already knowing the catalog.
    expect(seededMessage?.content).toContain("Which one sounds closest to what you want?");
  }, 20_000);

  // Regression: confirmed live that picking a real operator resumed a stale Conversation left over
  // from an unrelated earlier session with the same phone number (e.g. an old test run) - the
  // traveller saw a specific old product/date/price they never mentioned this session, looking like
  // Kai had fabricated it, immediately after picking the operator.
  it("starts the handed-off tenant conversation fresh instead of resuming a stale one", async () => {
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = await createBluePassStandIn();
    const operatorName = `Test AU Operator ${randomUUID()}`;
    const { tenant: realTenant } = await createRealCandidate(operatorName);
    const phone = randomTestPhone();

    const staleConversation = await prisma.conversation.create({
      data: { tenantId: realTenant.id, channel: "WHATSAPP", controlMode: "AI", whatsappPhone: phone }
    });
    await prisma.conversationBookingState.create({
      data: {
        tenantId: realTenant.id,
        conversationId: staleConversation.id,
        productTitle: "Stale Old Product From A Past Session",
        dateText: "2020-01-01",
        guests: 99,
        bookingStatus: "AVAILABILITY_CHECKED"
      }
    });

    await triggerAuOperatorRecommendation({
      messageText: "boat charter in australia",
      fromPhone: phone,
      isAuRegionSignal: true
    });
    const pickResult = await resolveAuOperatorRecommendationPick({ messageText: operatorName, fromPhone: phone });
    expect(pickResult).toEqual({ kind: "HANDLED" });

    const staleConversationAfterPick = await prisma.conversation.findUnique({ where: { id: staleConversation.id } });
    expect(staleConversationAfterPick?.whatsappPhone).toBeNull();

    const freshConversation = await prisma.conversation.findFirst({
      where: { tenantId: realTenant.id, whatsappPhone: phone }
    });
    expect(freshConversation).not.toBeNull();
    expect(freshConversation!.id).not.toBe(staleConversation.id);

    const freshBookingState = await prisma.conversationBookingState.findUnique({
      where: { conversationId: freshConversation!.id }
    });
    expect(freshBookingState).toBeNull();
  }, 20_000);

  it("replies honestly and resolves no tenant when a placeholder option is picked", async () => {
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = await createBluePassStandIn();
    await createRealCandidate();
    const placeholderName = `Test Placeholder Operator ${randomUUID()}`;
    await createPlaceholderCandidate(placeholderName);
    const phone = randomTestPhone();

    await triggerAuOperatorRecommendation({
      messageText: "boat charter in australia",
      fromPhone: phone,
      isAuRegionSignal: true
    });

    const pickResult = await resolveAuOperatorRecommendationPick({ messageText: placeholderName, fromPhone: phone });

    expect(pickResult).toEqual({ kind: "HANDLED" });
  }, 20_000);

  it("returns NONE (falls through) for an unrelated reply after the recommendation", async () => {
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = await createBluePassStandIn();
    await createRealCandidate();
    const phone = randomTestPhone();

    await triggerAuOperatorRecommendation({
      messageText: "boat charter in australia",
      fromPhone: phone,
      isAuRegionSignal: true
    });

    const pickResult = await resolveAuOperatorRecommendationPick({
      messageText: "what's the weather like there?",
      fromPhone: phone
    });

    expect(pickResult).toEqual({ kind: "NONE" });
  }, 20_000);
});
