import { matchPmsProduct } from "@/core/booking/product-matcher";
import { isBluePassResetConversationRequest } from "@/core/bluepass/conversation-intent";
import { classifyBluePassMarket } from "@/core/bluepass/market";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import type { PmsProvider } from "@/core/tenant/types";
import type { GenericBookingTurnTenant } from "@/server/booking/generic-booking-turn";
import { normalizeLocalPhone } from "@/server/phone/normalize-local-phone";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { prisma } from "@/lib/prisma";

const defaultBluePassTenantSlug = "bluepass";

export interface ResolvedWhatsAppGenericTenant {
  tenant: GenericBookingTurnTenant;
}

function readAllowlistedSlugs(env: Record<string, string | undefined>) {
  return (env.WHATSAPP_GENERIC_TENANT_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => slug.length > 0);
}

function mentionsTenantByName(message: string, tenantName: string) {
  const normalizedMessage = message.toLowerCase();
  const normalizedName = tenantName.toLowerCase().trim();
  if (!normalizedName) return false;

  return normalizedMessage.includes(normalizedName);
}

// matchPmsProduct only recognizes a specific, named product ("Gold Coast Whale Escape") or the
// tenant's exact display name - a bare region mention ("I want to trip in Australia") never scores
// against any one product distinctly enough to resolve, so it silently falls through to BluePass
// even for a tenant whose entire catalog IS that region. This is a small, explicit, per-tenant
// escape hatch for that gap - not a generic keyword system, since today there is exactly one
// region-exclusive PMS-connected tenant on the shared WhatsApp number. Pure and DB-free so it's
// unit-testable without creating any tenant row.
const TENANT_REGION_KEYWORDS: Record<string, RegExp> = {
  "bluepass-au": /\b(?:gold coast|australia|queensland)\b/i
};

export function matchesTenantRegionKeywords(slug: string, message: string): boolean {
  return TENANT_REGION_KEYWORDS[slug]?.test(message) ?? false;
}

// Pre-routing check for the shared WhatsApp number: since there is no separate number/tenant signal
// on an inbound WhatsApp message (see generic-booking-turn.ts for the shared engine this feeds),
// this checks the message against a small, explicit allowlist of PMS-connected tenants (today just
// "boattime") before falling through to the existing BluePass marketplace path. Reuses the same
// product matcher and PMS adapter construction the web widget already relies on - never invents a
// second, hand-maintained keyword list.
export async function resolveWhatsAppGenericTenant(
  messageText: string,
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedWhatsAppGenericTenant | null> {
  const allowlistedSlugs = readAllowlistedSlugs(env);
  if (allowlistedSlugs.length === 0) return null;

  for (const slug of allowlistedSlugs) {
    const tenant = await prisma.tenant.findFirst({
      where: { slug, status: "ACTIVE" },
      include: { branding: true, config: true }
    });
    if (!tenant || !tenant.config) continue;

    if (mentionsTenantByName(messageText, tenant.name) || matchesTenantRegionKeywords(tenant.slug, messageText)) {
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
      const match = matchPmsProduct(messageText, namedProducts);

      if (match.status === "MATCHED") {
        return { tenant };
      }
    } catch (error) {
      console.warn("whatsapp_generic_tenant_router.match_failed", {
        tenantSlug: slug,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return null;
}

// Fallback for a message that carries NO explicit signal for any tenant (a bare "1", "yes", "show me
// yachts", a date) - the kind of generic follow-up that only makes sense in the context of whatever
// this phone number was JUST discussing. Without this, resolveWhatsAppGenericTenant returning null
// makes the webhook default straight to BluePass, so a traveller mid-conversation with an allowlisted
// PMS tenant (e.g. bluepass-au) silently gets bounced back to BluePass's own, unrelated conversation
// history the moment their message stops repeating an explicit region/product keyword. Instead, check
// which tenant - among the allowlist plus BluePass itself - this phone last actually talked to, and
// stay there. A phone with no WhatsApp history yet, or whose most recent activity was already
// BluePass, resolves to null here (unchanged, default-to-BluePass behavior).
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
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedWhatsAppGenericTenant | null> {
  const allowlistedSlugs = readAllowlistedSlugs(env);
  if (allowlistedSlugs.length === 0) return null;

  const bluePassTenantSlug = env.WHATSAPP_BLUEPASS_TENANT_SLUG?.trim() || defaultBluePassTenantSlug;
  const normalizedPhone = normalizeLocalPhone(phone);

  const mostRecentMessage = await prisma.message.findFirst({
    where: {
      conversation: {
        whatsappPhone: normalizedPhone,
        channel: "WHATSAPP",
        tenant: {
          slug: { in: [...allowlistedSlugs, bluePassTenantSlug] },
          status: "ACTIVE"
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

// Single entry point for the webhook: explicit signal first (resolveWhatsAppGenericTenant), then the
// sticky recency fallback above - except a "new chat" reset or an explicit Indonesia-market signal
// ("Komodo", "Bali", ...) always means "go to BluePass now" and must override stickiness, otherwise a
// traveller who explicitly asks for Komodo while stuck in a sticky bluepass-au thread would wrongly
// stay there. classifyBluePassMarket is BluePass's own existing country classifier
// (core/bluepass/market.ts) - reused rather than a second hand-maintained keyword list.
export async function resolveWhatsAppTenantForMessage(
  input: { messageText: string; fromPhone: string },
  env: Record<string, string | undefined> = process.env
): Promise<ResolvedWhatsAppGenericTenant | null> {
  if (isBluePassResetConversationRequest(input.messageText)) return null;
  if (classifyBluePassMarket([input.messageText]) === "INDONESIA") return null;

  const explicitMatch = await resolveWhatsAppGenericTenant(input.messageText, env);
  if (explicitMatch) return explicitMatch;

  return resolveStickyWhatsAppGenericTenant(input.fromPhone, env);
}
