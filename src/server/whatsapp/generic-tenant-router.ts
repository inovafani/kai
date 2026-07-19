import { matchPmsProduct } from "@/core/booking/product-matcher";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import type { PmsProvider } from "@/core/tenant/types";
import type { GenericBookingTurnTenant } from "@/server/booking/generic-booking-turn";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { prisma } from "@/lib/prisma";

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
