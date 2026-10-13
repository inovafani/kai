import { WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "./feature-flags";

/**
 * Whether a chat on this tenant starts by recommending operators (and handing the traveller to the
 * one they pick) rather than booking on the tenant itself.
 *
 * A PLATFORM tenant is BluePass's own chat: it is not an operator, so by definition it recommends
 * operators. The older flag keeps working for a tenant that is still an operator but also fronts the
 * shared recommendation (it is itself one of the candidates).
 */
export function startsOperatorRecommendation(tenant: {
  kind?: string | null;
  config?: { enabledFeatures?: string[] | null } | null;
}) {
  return tenant.kind === "PLATFORM" || Boolean(tenant.config?.enabledFeatures?.includes(WHATSAPP_GENERIC_ELIGIBLE_FEATURE));
}
