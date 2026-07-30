import { messageNamesADistinctiveProduct } from "@/core/booking/product-matcher";
import { isBluePassResetConversationRequest } from "@/core/bluepass/conversation-intent";
import { classifyBluePassMarket } from "@/core/bluepass/market";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import { WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "@/core/tenant/feature-flags";
import type { PmsProvider } from "@/core/tenant/types";
import type { GenericBookingTurnTenant } from "@/server/booking/generic-booking-turn";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import {
  resolveAuOperatorRecommendationPick,
  triggerAuOperatorRecommendation
} from "@/server/whatsapp/au-operator-recommendation";
import { prisma } from "@/lib/prisma";

const defaultBluePassTenantSlug = "bluepass";

export interface ResolvedWhatsAppGenericTenant {
  tenant: GenericBookingTurnTenant;
}

// Real, bookable tenants reachable via the shared WhatsApp number - both the explicit product/
// business-name match below and the AU recommendation list (au-operator-recommendation.ts) draw
// from this same set. Onboarding a new operator onto the shared number is a data change (set
// WHATSAPP_GENERIC_ELIGIBLE_FEATURE on its TenantConfig.enabledFeatures), not a code/env edit.
export async function listWhatsAppGenericEligibleTenants() {
  return prisma.tenant.findMany({
    where: { status: "ACTIVE", config: { enabledFeatures: { has: WHATSAPP_GENERIC_ELIGIBLE_FEATURE } } },
    include: { branding: true, config: true }
  });
}

function mentionsTenantByName(message: string, tenantName: string) {
  const normalizedMessage = message.toLowerCase();
  const normalizedName = tenantName.toLowerCase().trim();
  if (!normalizedName) return false;

  return normalizedMessage.includes(normalizedName);
}

// A bare region mention ("I want to trip in Australia") is deliberately NOT treated as an explicit
// match for any one specific tenant, even one whose entire catalog is that region - now that
// listAuRecommendationCandidates() can hold more than one eligible AU tenant, guessing a single
// "the" region tenant here would silently skip the recommendation list the moment a second real
// operator is flagged eligible, which defeats the whole point of that mechanism. This keyword set is
// used only to decide isAuRegionSignal for the last-resort recommendation trigger in
// resolveWhatsAppTenantForMessage - a signal that "show the AU pick-an-operator list", not "resolve
// straight to this one tenant". Pure and DB-free so it's unit-testable without creating any tenant row.
const TENANT_REGION_KEYWORDS: Record<string, RegExp> = {
  "bluepass-au": /\b(?:gold coast|australia|queensland)\b/i
};

export function matchesTenantRegionKeywords(slug: string, message: string): boolean {
  return TENANT_REGION_KEYWORDS[slug]?.test(message) ?? false;
}

// Pre-routing check for the shared WhatsApp number: since there is no separate number/tenant signal
// on an inbound WhatsApp message (see generic-booking-turn.ts for the shared engine this feeds),
// this checks the message against every tenant flagged eligible for the shared number (see
// listWhatsAppGenericEligibleTenants above) before falling through to the existing BluePass
// marketplace path. Reuses the same product matcher and PMS adapter construction the web widget
// already relies on - never invents a second, hand-maintained keyword list.
export async function resolveWhatsAppGenericTenant(
  messageText: string,
  env: Record<string, string | undefined> = process.env,
  // Lets resolveWhatsAppTenantForMessage fetch this list once and share it across every tier instead
  // of each one independently re-querying it - defaults to fetching it here so every existing direct
  // caller/test is unaffected.
  prefetchedEligibleTenants?: Awaited<ReturnType<typeof listWhatsAppGenericEligibleTenants>>
): Promise<ResolvedWhatsAppGenericTenant | null> {
  const eligibleTenants = prefetchedEligibleTenants ?? (await listWhatsAppGenericEligibleTenants());

  for (const tenant of eligibleTenants) {
    if (!tenant.config) continue;

    if (mentionsTenantByName(messageText, tenant.name)) {
      return { tenant };
    }

    try {
      const provider = tenant.config.pmsProvider as PmsProvider;
      const tenantPmsEnv = await resolveTenantPmsEnv(tenant.id, provider, env);
      const sourcePmsAdapter = getPmsAdapter(provider, tenantPmsEnv, fetch, tenant.slug);
      const publicProductCatalog = parsePublicProductCatalog(tenant.config.publicProductCatalog);
      const pmsAdapter =
        publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;
      // Only AUTO_BOOKING products carry a specific, named offering (e.g. "Gold Coast Whale
      // Escape") distinctive enough to safely identify this tenant from free text shared across
      // the whole WhatsApp number. MANUAL_INQUIRY entries are typically generic catch-alls (e.g.
      // "Private Yacht Charter") built from the same common marine-charter vocabulary BluePass's
      // own travellers use every day - matching on them would misroute an ordinary BluePass
      // inquiry ("private yacht charter in Komodo") to this tenant instead.
      const products = await pmsAdapter.listProducts();
      const namedProducts = products.filter((product) => product.bookingMode === "AUTO_BOOKING");

      // messageNamesADistinctiveProduct, not matchPmsProduct: cross-tenant identification needs a
      // much stricter bar than within-tenant product disambiguation (see that function's own doc
      // comment) - confirmed live that matchPmsProduct's single-shared-word tolerance false-
      // positives against ordinary BluePass messages once more than one eligible tenant's catalog
      // is being checked against every message.
      if (messageNamesADistinctiveProduct(messageText, namedProducts)) {
        return { tenant };
      }
    } catch (error) {
      console.warn("whatsapp_generic_tenant_router.match_failed", {
        tenantSlug: tenant.slug,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return null;
}

// Fallback for a message that carries NO explicit signal for any tenant (a bare "1", "yes", "show me
// yachts", a date) - the kind of generic follow-up that only makes sense in the context of whatever
// this phone number was JUST discussing. Without this, resolveWhatsAppGenericTenant returning null
// makes the webhook default straight to BluePass, so a traveller mid-conversation with an eligible
// PMS tenant (e.g. bluepass-au) silently gets bounced back to BluePass's own, unrelated conversation
// history the moment their message stops repeating an explicit region/product keyword. Instead, check
// which tenant - among the eligible tenants plus BluePass itself - this phone last actually talked
// to, and stay there. A phone with no WhatsApp history yet, or whose most recent activity was
// already BluePass, resolves to null here (unchanged, default-to-BluePass behavior).
//
// Deliberately orders by the MESSAGE table's createdAt, not Conversation.updatedAt: an existing
// Conversation row is only ever read via findOrCreateWhatsAppConversation, never .update()'d on
// later turns, so its updatedAt freezes at creation/reset time and goes stale the moment a second
// message arrives. Ordering by that stale field made a long-reset-ago BluePass conversation always
// look "more recent" than a tenant conversation actively being used seconds ago - confirmed live: a
// traveller's bluepass-au conversation reused from hours earlier still carried its original
// creation timestamp even after just answering "i want to travel in australia", so it lost the
// recency race to a "new chat" reset that had touched the BluePass row moments before. Message rows
// are always fresh inserts, so ordering by their createdAt reflects true last-activity regardless of
// whether anything else remembers to touch the parent Conversation row.
export async function resolveStickyWhatsAppGenericTenant(
  phone: string,
  env: Record<string, string | undefined> = process.env,
  // See resolveWhatsAppGenericTenant's matching param - same purpose, defaults to fetching here so
  // direct callers/tests are unaffected.
  prefetchedEligibleTenants?: Awaited<ReturnType<typeof listWhatsAppGenericEligibleTenants>>
): Promise<ResolvedWhatsAppGenericTenant | null> {
  const bluePassTenantSlug = env.WHATSAPP_BLUEPASS_TENANT_SLUG?.trim() || defaultBluePassTenantSlug;
  const normalizedPhone = normalizeLocalPhone(phone);

  // Reuses listWhatsAppGenericEligibleTenants (the same eligibility list resolveWhatsAppGenericTenant
  // checks) rather than a second, separately-expressed flag filter - one source of truth for "who is
  // eligible", and it means both functions are affected identically by anything that scopes that one
  // function (e.g. a test mocking it to exclude tenants this test file didn't itself create).
  const eligibleTenantIds = (prefetchedEligibleTenants ?? (await listWhatsAppGenericEligibleTenants())).map(
    (tenant) => tenant.id
  );

  const mostRecentMessage = await prisma.message.findFirst({
    where: {
      conversation: {
        whatsappPhone: normalizedPhone,
        channel: "WHATSAPP",
        tenant: {
          status: "ACTIVE",
          OR: [{ id: { in: eligibleTenantIds } }, { slug: bluePassTenantSlug }]
        }
      }
    },
    orderBy: { createdAt: "desc" },
    include: { conversation: { include: { tenant: { include: { branding: true, config: true } } } } }
  });

  const tenant = mostRecentMessage?.conversation.tenant;
  if (!tenant || tenant.slug === bluePassTenantSlug || !tenant.config) {
    return null;
  }

  return { tenant };
}

export type WhatsAppTenantRouteOutcome =
  | { kind: "TENANT"; tenant: GenericBookingTurnTenant }
  | { kind: "HANDLED" }
  | { kind: "NONE" };

// Single entry point for the webhook: explicit signal first (resolveWhatsAppGenericTenant), then a
// pending recommendation-pick, then the sticky recency fallback, then (last resort) a fresh AU
// operator recommendation - except a "new chat" reset or an explicit Indonesia-market signal
// ("Komodo", "Bali", ...) always means "go to BluePass now" and must override all of that, otherwise
// a traveller who explicitly asks for Komodo while stuck in a sticky bluepass-au thread would wrongly
// stay there. classifyBluePassMarket is BluePass's own existing country classifier
// (core/bluepass/market.ts) - reused rather than a second hand-maintained keyword list.
//
// The fresh recommendation trigger runs only after the sticky check finds nothing, so an ongoing
// conversation with an eligible tenant is never hijacked back into "pick an operator" just because a
// later message happens to mention "Australia" again - see au-operator-recommendation.ts.
export async function resolveWhatsAppTenantForMessage(
  input: { messageText: string; fromPhone: string },
  env: Record<string, string | undefined> = process.env
): Promise<WhatsAppTenantRouteOutcome> {
  if (isBluePassResetConversationRequest(input.messageText)) return { kind: "NONE" };
  if (classifyBluePassMarket([input.messageText]) === "INDONESIA") return { kind: "NONE" };

  // Fetched once and threaded through every tier below (each accepts it as an optional prefetched
  // param) instead of each one independently re-querying the same eligibility list - that redundancy
  // was adding several sequential DB round-trips to every single inbound WhatsApp message.
  const eligibleTenants = await listWhatsAppGenericEligibleTenants();

  const explicitMatch = await resolveWhatsAppGenericTenant(input.messageText, env, eligibleTenants);
  if (explicitMatch) return { kind: "TENANT", tenant: explicitMatch.tenant };

  const pick = await resolveAuOperatorRecommendationPick(input, env, eligibleTenants);
  if (pick.kind !== "NONE") return pick;

  const sticky = await resolveStickyWhatsAppGenericTenant(input.fromPhone, env, eligibleTenants);
  if (sticky) return { kind: "TENANT", tenant: sticky.tenant };

  const isAuRegionSignal = matchesTenantRegionKeywords("bluepass-au", input.messageText);
  return triggerAuOperatorRecommendation({ ...input, isAuRegionSignal }, env, eligibleTenants);
}
