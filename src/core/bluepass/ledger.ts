export type BluePassLedgerEstimateInput = {
  inquiryId: string;
  budget?: string | null;
  referralPartnerId?: string | null;
  referralLinkId?: string | null;
  referralCode?: string | null;
  referralRole?: string | null;
};

export type BluePassLedgerCurrency = "USD" | "IDR" | "EUR" | "AUD";

export type BluePassLedgerEstimate = {
  inquiryId: string;
  kind:
    | "CREATOR_COMMISSION_ESTIMATE"
    | "BLUEPASS_PLATFORM_COMMISSION"
    | "CONSERVATION_ALLOCATION"
    | "PAYMENT_PROCESSING_ALLOCATION"
    | "OPERATOR_PAYOUT_PLACEHOLDER";
  amountCents: number;
  currency: BluePassLedgerCurrency;
  status: "PENDING" | "FINALIZED";
  referralPartnerId: string | null;
  referralLinkId: string | null;
  referralCode: string | null;
  referralRole: string | null;
  metadata: {
    budgetAmount: number;
  };
};

export type BluePassLedgerSplitInput = {
  inquiryId: string;
  grossAmountCents: number;
  currency: BluePassLedgerCurrency;
  status: "PENDING" | "FINALIZED";
  referralPartnerId?: string | null;
  referralLinkId?: string | null;
  referralCode?: string | null;
  referralRole?: string | null;
};

// The real, tested split - Tony's own "Economics stated by the playbooks (source of truth)"
// (kai-persona-triage.md) and its test-guard in kai-refinement-loop.md ("82% / 18% (5/5/3/5); never
// invent commission %") - already live in Kai's own chat copy (reply.ts's
// buildBluePassCommissionReply, triage.ts). Conservation and payment-processing always apply;
// partner commission only applies when a referral is attached, in which case BluePass's own
// platform-fee bucket is smaller (5% vs 10%) so the operator's 82% net never depends on whether a
// referral happened to be attached. No dollar cap - the previous 15%/$750-cap/30%-of-commission
// figures were an outdated first draft that was never reconciled with the refined 18% figure.
const conservationPct = 0.05;
const partnerCommissionPct = 0.05;
const paymentProcessingPct = 0.03;
const platformFeePctReferred = 0.05;
const platformFeePctUnreferred = 0.1;

// Core split, operating directly on a real amount in cents - shared by the pre-booking PENDING
// estimate (parsed from operator free text, see calculateBluePassLedgerEstimate below) and the
// post-booking FINALIZED ledger (computed from the actual confirmed price, see
// finalizeBluePassLedgerForConfirmedBooking in bluepass-inquiry-repository.ts), so both paths use
// the identical percentage math rather than two copies that could drift apart.
export function calculateBluePassLedgerSplit(input: BluePassLedgerSplitInput): BluePassLedgerEstimate[] {
  const budgetAmount = input.grossAmountCents / 100;
  const hasReferral = Boolean(input.referralPartnerId);
  const conservation = budgetAmount * conservationPct;
  const partnerCommission = hasReferral ? budgetAmount * partnerCommissionPct : 0;
  const paymentProcessing = budgetAmount * paymentProcessingPct;
  const platformFee = budgetAmount * (hasReferral ? platformFeePctReferred : platformFeePctUnreferred);
  // Derived as the remainder (not a separate budgetAmount * 0.82) so the four ledger rows always
  // sum to exactly budgetAmount, with no rounding-cent leakage between buckets.
  const operatorNet = budgetAmount - conservation - partnerCommission - paymentProcessing - platformFee;

  const base = {
    inquiryId: input.inquiryId,
    currency: input.currency,
    status: input.status,
    referralPartnerId: input.referralPartnerId ?? null,
    referralLinkId: input.referralLinkId ?? null,
    referralCode: input.referralCode ?? null,
    referralRole: input.referralRole ?? null,
    metadata: {
      budgetAmount
    }
  };

  const entries: BluePassLedgerEstimate[] = [
    { ...base, kind: "CONSERVATION_ALLOCATION", amountCents: toCents(conservation) },
    { ...base, kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: toCents(paymentProcessing) },
    { ...base, kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: toCents(platformFee) },
    { ...base, kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: toCents(operatorNet) }
  ];

  if (hasReferral) {
    entries.push({ ...base, kind: "CREATOR_COMMISSION_ESTIMATE", amountCents: toCents(partnerCommission) });
  }

  return entries;
}

export function calculateBluePassLedgerEstimate(input: BluePassLedgerEstimateInput): BluePassLedgerEstimate[] {
  const { currency, amount: budgetAmount } = parseBudgetAmount(input.budget);

  return calculateBluePassLedgerSplit({
    inquiryId: input.inquiryId,
    grossAmountCents: toCents(budgetAmount),
    currency,
    status: "PENDING",
    referralPartnerId: input.referralPartnerId,
    referralLinkId: input.referralLinkId,
    referralCode: input.referralCode,
    referralRole: input.referralRole
  });
}

const knownLedgerCurrencies: BluePassLedgerCurrency[] = ["USD", "IDR", "EUR", "AUD"];

// Mirrors bluepass-quote.ts's parsePrice currency detection: an explicit currency code wins,
// otherwise USD is the existing default (unchanged behavior for budgets with no code at all).
export function parseBudgetAmount(value?: string | null): { currency: BluePassLedgerCurrency; amount: number } {
  if (!value) return { currency: "USD", amount: 0 };

  const match = value.replace(/,/g, "").match(/(USD|IDR|EUR|AUD)?\s*\$?\s*(\d{2,7})/i);
  if (!match) return { currency: "USD", amount: 0 };

  const detectedCurrency = match[1]?.toUpperCase();
  const currency: BluePassLedgerCurrency =
    detectedCurrency && (knownLedgerCurrencies as string[]).includes(detectedCurrency)
      ? (detectedCurrency as BluePassLedgerCurrency)
      : "USD";

  return { currency, amount: Number(match[2]) };
}

function toCents(value: number) {
  return Math.round(value * 100);
}

// Shared with bluepass-quote.ts's operator-quote conservation display so the two never drift to
// different percentages of the same real (not budget-text-parsed) price.
export function calculateConservationContributionCents(grossPriceCents: number): number {
  return Math.round(grossPriceCents * conservationPct);
}
