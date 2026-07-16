import type {
  BusinessPackDescriptor,
  BusinessPackResolutionInput,
  KaiToolName,
  PaymentPolicy,
  TruthPolicy,
} from "./types";

const operatorInquiryTools: KaiToolName[] = [
  "product_search",
  "check_availability",
  "create_manual_inquiry",
  "handoff_to_operator",
];

const operatorInstantTools: KaiToolName[] = [
  "product_search",
  "check_availability",
  "create_manual_inquiry",
  "create_instant_booking",
  "capture_payment",
  "handoff_to_operator",
];

const bluepassMarketplaceTools: KaiToolName[] = [
  "search_bluepass_yachts",
  "create_bluepass_inquiry",
  "sync_referral_ledger_estimate",
  "dispatch_operator_whatsapp",
  "get_bluepass_inquiry_status",
  "handoff_to_operator",
];

export function resolveBusinessPack(
  input: BusinessPackResolutionInput,
): BusinessPackDescriptor {
  if (isBluePassMarketplace(input)) {
    return {
      tenantId: input.tenantId,
      slug: input.slug,
      displayName: input.name,
      kind: "bluepass_marketplace",
      tools: bluepassMarketplaceTools,
      paymentPolicy: "operator_acceptance_required",
      truthPolicy: {
        availabilitySource: "preview_catalog",
        priceSource: "preview_catalog",
        bookingConfirmationSource: "operator_admin",
      },
    };
  }

  const instantBookingAllowed =
    input.bookingWriteEnabled && input.bookingMode === "AUTO_BOOKING";
  // Any Rezdy tenant with booking-write on gets instant-booking tools, not just "boattime" -
  // future operators onboarded the same way (their own tenant, their own Rezdy credentials) get
  // this automatically, with no registry change needed per operator.
  const rezdyInstantWrite =
    input.bookingWriteEnabled && input.pmsProvider === "REZDY";
  const tools =
    instantBookingAllowed || rezdyInstantWrite
      ? operatorInstantTools
      : operatorInquiryTools;

  return {
    tenantId: input.tenantId,
    slug: input.slug,
    displayName: input.name,
    kind: "operator_direct",
    tools,
    paymentPolicy: resolveOperatorPaymentPolicy(tools),
    truthPolicy: resolveOperatorTruthPolicy(input, tools),
  };
}

function isBluePassMarketplace(input: BusinessPackResolutionInput) {
  return (
    input.slug === "bluepass" ||
    input.enabledFeatures.includes("bluepass_marketplace")
  );
}

function resolveOperatorPaymentPolicy(tools: KaiToolName[]): PaymentPolicy {
  return tools.includes("capture_payment")
    ? "instant_payment_allowed"
    : "no_payment_in_kai";
}

function resolveOperatorTruthPolicy(
  input: BusinessPackResolutionInput,
  tools: KaiToolName[],
): TruthPolicy {
  if (tools.includes("create_instant_booking") && input.pmsProvider !== "MOCK") {
    return {
      availabilitySource: "pms_live",
      priceSource: "pms_live",
      bookingConfirmationSource: "pms_write_back",
    };
  }

  return {
    availabilitySource: "preview_catalog",
    priceSource: "preview_catalog",
    bookingConfirmationSource: "none",
  };
}
