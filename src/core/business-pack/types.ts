import type { BookingMode, PmsProvider } from "@/core/tenant/types";

export type BusinessPackKind = "operator_direct" | "bluepass_marketplace";

export type KaiToolName =
  | "product_search"
  | "check_availability"
  | "create_manual_inquiry"
  | "create_instant_booking"
  | "capture_payment"
  | "handoff_to_operator"
  | "search_bluepass_yachts"
  | "create_bluepass_inquiry"
  | "sync_referral_ledger_estimate"
  | "dispatch_operator_whatsapp"
  | "get_bluepass_inquiry_status";

export type PaymentPolicy =
  | "no_payment_in_kai"
  | "instant_payment_allowed"
  | "operator_acceptance_required";

export type TruthPolicy = {
  availabilitySource: "preview_catalog" | "pms_live" | "operator_confirmed";
  priceSource: "preview_catalog" | "pms_live" | "operator_quote";
  bookingConfirmationSource: "none" | "pms_write_back" | "operator_admin";
};

export type BusinessPackResolutionInput = {
  tenantId: string;
  slug: string;
  name: string;
  enabledFeatures: string[];
  bookingMode: BookingMode | string;
  bookingWriteEnabled: boolean;
  pmsProvider: PmsProvider;
};

export type BusinessPackDescriptor = {
  tenantId: string;
  slug: string;
  displayName: string;
  kind: BusinessPackKind;
  tools: KaiToolName[];
  paymentPolicy: PaymentPolicy;
  truthPolicy: TruthPolicy;
};

export function hasTool(
  pack: Pick<BusinessPackDescriptor, "tools">,
  tool: KaiToolName,
) {
  return pack.tools.includes(tool);
}
