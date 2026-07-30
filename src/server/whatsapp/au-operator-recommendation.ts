import { prisma } from "@/lib/prisma";
import { formatRecommendationReply } from "@/core/booking/booking-orchestrator";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import { AU_RECOMMENDATION_PLACEHOLDER_FEATURE } from "@/core/tenant/feature-flags";
import type { PmsProvider } from "@/core/tenant/types";
import {
  createAssistantMessage,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listRecentConversationMessages,
  resetWhatsAppConversation
} from "@/server/conversation/conversation-repository";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { sendWhatsAppText } from "@/server/whatsapp/client";
import { listWhatsAppGenericEligibleTenants } from "@/server/whatsapp/generic-tenant-router";

const defaultBluePassTenantSlug = "bluepass";

export interface AuRecommendationCandidate {
  tenantId: string;
  slug: string;
  name: string;
  // Placeholder candidates have no working PMS behind them - picking one always gets an honest
  // "not available" reply instead of a real hand-off (see AU_RECOMMENDATION_PLACEHOLDER_FEATURE).
  isPlaceholder: boolean;
}

// Never "TENANT": a pick message ("1"/the operator name) carries no real booking content of its
// own, so it is always fully answered right here (see resolveAuOperatorRecommendationPick) rather
// than handed to the caller to also replay through the booking engine - see that function's own
// comment for why replaying it was a real, confirmed-live bug.
export type AuOperatorRecommendationOutcome = { kind: "HANDLED" } | { kind: "NONE" };

// The full recommend-then-pick candidate list: real, bookable operators (WHATSAPP_GENERIC_ELIGIBLE_FEATURE,
// shared with the WhatsApp explicit-match tier in generic-tenant-router.ts) plus any placeholder
// operators (AU_RECOMMENDATION_PLACEHOLDER_FEATURE). Adding a candidate - real or placeholder - is a
// data change (create a Tenant row, set the relevant feature flag), never a code change.
export async function listAuRecommendationCandidates(
  // Lets callers that already fetched the eligible-tenant list this call-tree (resolveWhatsAppTenantForMessage)
  // share it instead of this function re-querying it again - defaults to fetching here so direct
  // callers/tests are unaffected.
  prefetchedEligibleTenants?: Awaited<ReturnType<typeof listWhatsAppGenericEligibleTenants>>
): Promise<AuRecommendationCandidate[]> {
  const [realTenants, placeholderTenants] = await Promise.all([
    prefetchedEligibleTenants ?? listWhatsAppGenericEligibleTenants(),
    prisma.tenant.findMany({
      where: { status: "ACTIVE", config: { enabledFeatures: { has: AU_RECOMMENDATION_PLACEHOLDER_FEATURE } } },
      select: { id: true, slug: true, name: true }
    })
  ]);

  return [
    ...realTenants.map((tenant) => ({ tenantId: tenant.id, slug: tenant.slug, name: tenant.name, isPlaceholder: false })),
    ...placeholderTenants.map((tenant) => ({ tenantId: tenant.id, slug: tenant.slug, name: tenant.name, isPlaceholder: true }))
  ];
}

function parseNumberedPick(message: string): number | null {
  const match = message
    .trim()
    .toLowerCase()
    .match(/^(?:(?:option|choice|number|no)\s*)?#?\s*(\d{1,2})(?:\s*(?:please|pls|thanks|thank you))?$/);

  return match ? Number(match[1]) : null;
}

// A message that reads as a question ("what is X?", "explain X", "tell me about X") should never be
// read as picking option X, even though it mentions the candidate's name - confirmed live that a
// traveller asking "what is Boattime Yacht Charters?" right after the recommendation was shown got
// silently treated as picking option 1, so the question was never actually answered - it just got the
// canned "great choice, let's get you sorted" handoff line instead. Numbered picks ("1") are unaffected
// by this, since a bare number is never a question.
function looksLikeAQuestion(message: string): boolean {
  const trimmed = message.trim().toLowerCase();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  return /^(what|why|how|when|who|which|where|explain|describe|tell me|can you|could you|do you|does|is|are|will|would)\b/.test(
    trimmed
  );
}

export function buildAuOperatorRecommendationReply(candidates: AuRecommendationCandidate[]) {
  const rows = candidates.map((candidate, index) => `${index + 1}. ${candidate.name}`).join("\n");
  return `Here's who I can check for you in Australia:\n${rows}\n\nReply with the number (or the name) to continue.`;
}

// The exact trailing sentence buildAuOperatorRecommendationReply always appends - nothing else in
// the system produces this string, so checking for it is an unambiguous "the recommendation list
// itself was the most recent reply" signal.
const RECOMMENDATION_REPLY_MARKER = "reply with the number (or the name) to continue";

// Pure - only resolves a pick when the last assistant turn actually IS our own recommendation list
// (ends with its distinctive prompt), so a bare "1" elsewhere in the conversation is never misread
// as picking from this list. Deliberately NOT "mentions every candidate's name": confirmed live that
// with a single real candidate, the very next handoff reply ("Connecting you with Boattime Yacht
// Charters now...") also mentions that same candidate's name, which made a bare "1" meant to pick a
// PRODUCT from the handoff's own list get misread as re-picking the operator, forever - the
// traveller was stuck seeing the same handoff reply on every subsequent turn no matter what they
// typed, since this always won before the message ever reached the real booking engine.
export function resolveAuOperatorRecommendationSelection(input: {
  lastAssistantMessage: string | null;
  message: string;
  candidates: AuRecommendationCandidate[];
}): AuRecommendationCandidate | null {
  if (input.candidates.length === 0) return null;

  const last = input.lastAssistantMessage?.toLowerCase() ?? "";
  const wasShown = last.includes(RECOMMENDATION_REPLY_MARKER);
  if (!wasShown) return null;

  const numbered = parseNumberedPick(input.message);
  if (numbered && numbered >= 1 && numbered <= input.candidates.length) {
    return input.candidates[numbered - 1];
  }

  if (looksLikeAQuestion(input.message)) return null;

  const normalized = input.message.trim().toLowerCase();
  return input.candidates.find((candidate) => normalized.includes(candidate.name.toLowerCase())) ?? null;
}

// Builds the handoff line shown right after a traveller picks a real operator - shows that
// tenant's actual live product list (the same numbered "- live availability" format used
// everywhere else a traveller is asked "which product?", via formatRecommendationReply) instead of
// a vague "what would you like to explore?" that assumes the traveller already knows this
// operator's catalog. Falls back to the plain handoff line if the PMS call fails or returns nothing,
// so a live-fetch hiccup never blocks the handoff itself.
export async function buildTenantProductsHandoffReply(
  tenant: {
    id: string;
    slug: string;
    name: string;
    config: { pmsProvider: PmsProvider; publicProductCatalog: unknown };
  },
  env: Record<string, string | undefined> = process.env
): Promise<string> {
  const fallback = `Great choice! Connecting you with ${tenant.name} now - what would you like to explore?`;

  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(tenant.id, tenant.config.pmsProvider, env);
    const sourcePmsAdapter = getPmsAdapter(tenant.config.pmsProvider, tenantPmsEnv, fetch, tenant.slug);
    const publicProductCatalog = parsePublicProductCatalog(tenant.config.publicProductCatalog);
    const pmsAdapter =
      publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;
    const products = await pmsAdapter.listProducts();

    if (products.length === 0) return fallback;

    return `Great choice! Connecting you with ${tenant.name} now.\n\n${formatRecommendationReply(products, null)}`;
  } catch (error) {
    console.warn("au_operator_recommendation.products_handoff_failed", {
      tenantSlug: tenant.slug,
      error: error instanceof Error ? error.message : String(error)
    });
    return fallback;
  }
}

async function resolveBluePassConversationContext(phone: string, env: Record<string, string | undefined>) {
  const bluePassTenantSlug = env.WHATSAPP_BLUEPASS_TENANT_SLUG?.trim() || defaultBluePassTenantSlug;
  const bluePassTenant = await prisma.tenant.findFirst({ where: { slug: bluePassTenantSlug, status: "ACTIVE" } });
  if (!bluePassTenant) return null;

  const conversation = await findOrCreateWhatsAppConversation({ tenantId: bluePassTenant.id, whatsappPhone: phone });
  const recentMessages = await listRecentConversationMessages({
    tenantId: bluePassTenant.id,
    conversationId: conversation.id,
    take: 4
  });
  const lastAssistantMessage =
    [...recentMessages].reverse().find((message) => message.role === "assistant")?.content ?? null;

  return { tenant: bluePassTenant, conversation, lastAssistantMessage };
}

// Tier between the explicit-match and sticky-fallback checks in resolveWhatsAppTenantForMessage:
// resolves a reply to a recommendation list triggerAuOperatorRecommendation already showed.
// Deliberately checked BEFORE the sticky fallback so a bare "1"/"2" reply is never mistaken for
// anything else, but AFTER the explicit product/tenant match so a specific request (e.g. naming a
// real product) is never intercepted by this.
export async function resolveAuOperatorRecommendationPick(
  input: { messageText: string; fromPhone: string },
  env: Record<string, string | undefined> = process.env,
  prefetchedEligibleTenants?: Awaited<ReturnType<typeof listWhatsAppGenericEligibleTenants>>
): Promise<AuOperatorRecommendationOutcome> {
  const phone = normalizeLocalPhone(input.fromPhone);
  const context = await resolveBluePassConversationContext(phone, env);
  if (!context) return { kind: "NONE" };

  const candidates = await listAuRecommendationCandidates(prefetchedEligibleTenants);
  if (candidates.length === 0) return { kind: "NONE" };

  const picked = resolveAuOperatorRecommendationSelection({
    lastAssistantMessage: context.lastAssistantMessage,
    message: input.messageText,
    candidates
  });
  if (!picked) return { kind: "NONE" };

  await createTravellerMessage({
    tenantId: context.tenant.id,
    conversationId: context.conversation.id,
    content: input.messageText
  });

  if (picked.isPlaceholder) {
    const reply = `Sorry, ${picked.name} is not available right now - want to try one of the other options instead?`;
    await createAssistantMessage({ tenantId: context.tenant.id, conversationId: context.conversation.id, content: reply });
    await sendWhatsAppText({ to: input.fromPhone, role: "kai", body: reply });
    return { kind: "HANDLED" };
  }

  const realTenant = await prisma.tenant.findUnique({
    where: { id: picked.tenantId },
    include: { branding: true, config: true }
  });
  if (!realTenant || !realTenant.config) return { kind: "NONE" };

  const handoffReply = await buildTenantProductsHandoffReply(
    { id: realTenant.id, slug: realTenant.slug, name: realTenant.name, config: realTenant.config },
    env
  );
  await createAssistantMessage({
    tenantId: context.tenant.id,
    conversationId: context.conversation.id,
    content: handoffReply
  });

  // Reset (not find-or-create): by the time a pick reaches here, resolveStickyWhatsAppGenericTenant
  // has already confirmed this phone's most recent WhatsApp activity was NOT an in-progress
  // conversation with this tenant (otherwise sticky would already have resolved to it earlier in
  // resolveWhatsAppTenantForMessage's tier order) - so any existing conversation row for this
  // tenant+phone is a stale, abandoned one from an unrelated earlier session. Confirmed live: resuming
  // its old bookingMemory (a specific old date/guest count/price the traveller never mentioned this
  // session) surfaced the instant this pick was made, looking like Kai had fabricated it. A fresh
  // conversation guarantees the handoff always starts clean. Still seeds a Message row here so the
  // traveller's very next message stays sticky on this tenant via resolveStickyWhatsAppGenericTenant.
  const realConversation = await resetWhatsAppConversation({ tenantId: realTenant.id, whatsappPhone: phone });
  await createAssistantMessage({
    tenantId: realTenant.id,
    conversationId: realConversation.id,
    content: handoffReply
  });

  await sendWhatsAppText({ to: input.fromPhone, role: "kai", body: handoffReply });

  // HANDLED, not TENANT: this pick message has already been fully answered above, and it carries no
  // real booking content of its own - it must never also be replayed into the generic booking engine
  // as if it were the traveller's first real message to this tenant. Confirmed live this was
  // happening: the webhook fed this same pick message into handleGenericWhatsAppInboundMessage right
  // after this function's own handoff reply, producing a second, confusing reply on top of whatever
  // stale bookingMemory that tenant+phone still had from an earlier session. The traveller's actual
  // next message reaches the tenant normally via the sticky seed above.
  return { kind: "HANDLED" };
}

// Last-resort trigger: the caller only invokes this after both the explicit-match and
// sticky-fallback checks find nothing, so an ongoing conversation with an eligible tenant is never
// hijacked back into a fresh recommendation just because a later message happens to mention
// "Australia" again.
export async function triggerAuOperatorRecommendation(
  input: { messageText: string; fromPhone: string; isAuRegionSignal: boolean },
  env: Record<string, string | undefined> = process.env,
  prefetchedEligibleTenants?: Awaited<ReturnType<typeof listWhatsAppGenericEligibleTenants>>
): Promise<{ kind: "HANDLED" } | { kind: "NONE" }> {
  if (!input.isAuRegionSignal) return { kind: "NONE" };

  const phone = normalizeLocalPhone(input.fromPhone);
  const context = await resolveBluePassConversationContext(phone, env);
  if (!context) return { kind: "NONE" };

  const candidates = await listAuRecommendationCandidates(prefetchedEligibleTenants);
  if (candidates.length === 0) return { kind: "NONE" };

  await createTravellerMessage({
    tenantId: context.tenant.id,
    conversationId: context.conversation.id,
    content: input.messageText
  });

  const reply = buildAuOperatorRecommendationReply(candidates);
  await createAssistantMessage({ tenantId: context.tenant.id, conversationId: context.conversation.id, content: reply });
  await sendWhatsAppText({ to: input.fromPhone, role: "kai", body: reply });

  return { kind: "HANDLED" };
}
