export type BluePassLedgerEstimateInput = {
  inquiryId: string;
  budget?: string | null;
  referralPartnerId?: string | null;
  referralLinkId?: string | null;
  referralCode?: string | null;
  referralRole?: string | null;
};

export type BluePassLedgerEstimate = {
  inquiryId: string;
  kind:
    | "CREATOR_COMMISSION_ESTIMATE"
    | "BLUEPASS_PLATFORM_COMMISSION"
    | "CONSERVATION_ALLOCATION"
    | "OPERATOR_PAYOUT_PLACEHOLDER";
  amountCents: number;
  currency: "USD";
  status: "PENDING";
  referralPartnerId: string;
  referralLinkId: string | null;
  referralCode: string | null;
  referralRole: string | null;
  metadata: {
    budgetUsd: number;
    capApplied: boolean;
  };
};

const conservationPct = 0.05;
const commissionPct = 0.15;
const commissionCapUsd = 750;
const creatorSharePct = 0.3;

export function calculateBluePassLedgerEstimate(input: BluePassLedgerEstimateInput): BluePassLedgerEstimate[] {
  if (!input.referralPartnerId) {
    return [];
  }

  const budgetUsd = parseBudgetUsd(input.budget);
  const uncappedCommission = budgetUsd * commissionPct;
  const commission = Math.min(uncappedCommission, commissionCapUsd);
  const conservation = budgetUsd * conservationPct;
  const creatorShare = input.referralRole === "CREATOR" ? commission * creatorSharePct : 0;
  const bluepassNet = commission - creatorShare;
  const operatorNet = Math.max(0, budgetUsd - commission - conservation);
  const base = {
    inquiryId: input.inquiryId,
    currency: "USD" as const,
    status: "PENDING" as const,
    referralPartnerId: input.referralPartnerId,
    referralLinkId: input.referralLinkId ?? null,
    referralCode: input.referralCode ?? null,
    referralRole: input.referralRole ?? null,
    metadata: {
      budgetUsd,
      capApplied: uncappedCommission > commissionCapUsd
    }
  };

  return [
    { ...base, kind: "CREATOR_COMMISSION_ESTIMATE", amountCents: usdToCents(creatorShare) },
    { ...base, kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: usdToCents(bluepassNet) },
    { ...base, kind: "CONSERVATION_ALLOCATION", amountCents: usdToCents(conservation) },
    { ...base, kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: usdToCents(operatorNet) }
  ];
}

export function parseBudgetUsd(value?: string | null) {
  if (!value) return 0;

  const match = value.replace(/,/g, "").match(/(?:USD|\$)?\s*(\d{2,7})/i);
  return match ? Number(match[1]) : 0;
}

function usdToCents(value: number) {
  return Math.round(value * 100);
}
