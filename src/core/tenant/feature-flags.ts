// Shared literal so the same string is never hand-duplicated between orchestration gating,
// widget-config capability exposure, and seed/admin data. Toggled per tenant via
// TenantConfig.enabledFeatures (see the admin settings page).
export const BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE = "bluepass_stripe_pms_checkout";

// Marks a tenant as reachable through the single shared WhatsApp number's generic (non-BluePass)
// routing - both the explicit product/business-name match and the AU operator recommendation list.
// Replaces the old WHATSAPP_GENERIC_TENANT_SLUGS env-var allowlist: adding a new real operator to
// the shared number is now a data change (set this flag when the operator's PMS integration goes
// live), not a code/env edit + redeploy.
export const WHATSAPP_GENERIC_ELIGIBLE_FEATURE = "whatsapp_generic_eligible";

// Marks a tenant as a placeholder shown in the AU recommendation list without being a real,
// bookable operator (no working PMS behind it) - picking it always gets an honest "not available"
// reply instead of a real hand-off. Lets the recommendation list carry more than one option (for
// demos or UX testing) purely by adding a Tenant row, without a fake operator ever being routable
// via the shared number's explicit-match/sticky logic (see WHATSAPP_GENERIC_ELIGIBLE_FEATURE).
export const AU_RECOMMENDATION_PLACEHOLDER_FEATURE = "au_recommendation_placeholder";
