import { prisma } from "@/lib/prisma";
import { AU_RECOMMENDATION_PLACEHOLDER_FEATURE } from "@/core/tenant/feature-flags";
import type { GenericBookingTurnTenant } from "@/server/booking/generic-booking-turn";
import {
  createAssistantMessage,
  createTravellerMessage,
  findOrCreateWhatsAppConversation,
  listRecentConversationMessages
} from "@/server/conversation/conversation-repository";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
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

export type AuOperatorRecommendationOutcome =
  | { kind: "TENANT"; tenant: GenericBookingTurnTenant }
  | { kind: "HANDLED" }
  | { kind: "NONE" };

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

// Pure - only resolves a pick when the last assistant turn actually looks like our own
// recommendation (mentions every candidate currently shown), so a bare "1" elsewhere in a
// conversation is never misread as picking from this list.
export function resolveAuOperatorRecommendationSelection(input: {
  lastAssistantMessage: string | null;
  message: string;
  candidates: AuRecommendationCandidate[];
}): AuRecommendationCandidate | null {
  if (input.candidates.length === 0) return null;

  const last = input.lastAssistantMessage?.toLowerCase() ?? "";
  const wasShown = input.candidates.every((candidate) => last.includes(candidate.name.toLowerCase()));
  if (!wasShown) return null;

  const numbered = parseNumberedPick(input.message);
  if (numbered && numbered >= 1 && numbered <= input.candidates.length) {
    return input.candidates[numbered - 1];
  }

  if (looksLikeAQuestion(input.message)) return null;

  const normalized = input.message.trim().toLowerCase();
  return input.candidates.find((candidate) => normalized.includes(candidate.name.toLowerCase())) ?? null;
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

  const handoffReply = `Great choice! Connecting you with ${realTenant.name} now - what would you like to explore?`;
  await createAssistantMessage({
    tenantId: context.tenant.id,
    conversationId: context.conversation.id,
    content: handoffReply
  });

  // Seed a Message row in the real tenant's own conversation so the traveller's very next message
  // stays sticky on this tenant via resolveStickyWhatsAppGenericTenant, instead of feeding this pick
  // ("1"/the operator name) into the booking engine as if it were a real product question.
  const realConversation = await findOrCreateWhatsAppConversation({ tenantId: realTenant.id, whatsappPhone: phone });
  await createAssistantMessage({
    tenantId: realTenant.id,
    conversationId: realConversation.id,
    content: handoffReply
  });

  await sendWhatsAppText({ to: input.fromPhone, role: "kai", body: handoffReply });

  return { kind: "TENANT", tenant: realTenant };
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
