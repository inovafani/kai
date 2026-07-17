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
    | "OPERATOR_PAYOUT_PLACEHOLDER";
  amountCents: number;
  currency: BluePassLedgerCurrency;
  status: "PENDING";
  referralPartnerId: string;
  referralLinkId: string | null;
  referralCode: string | null;
  referralRole: string | null;
  metadata: {
    budgetAmount: number;
    capApplied: boolean;
  };
};

const conservationPct = 0.05;
const commissionPct = 0.15;
// Deliberately not converted per-currency: there's no authoritative exchange-rate source wired up
// here, and a fabricated converted cap would be worse than applying no cap at all. Only USD
// budgets get capped for now; other currencies fall through uncapped rather than being compared
// against a USD-denominated number.
const commissionCapUsd = 750;
const creatorSharePct = 0.3;

export function calculateBluePassLedgerEstimate(input: BluePassLedgerEstimateInput): BluePassLedgerEstimate[] {
  if (!input.referralPartnerId) {
    return [];
  }

  const { currency, amount: budgetAmount } = parseBudgetAmount(input.budget);
  const uncappedCommission = budgetAmount * commissionPct;
  const capApplied = currency === "USD" && uncappedCommission > commissionCapUsd;
  const commission = capApplied ? commissionCapUsd : uncappedCommission;
  const conservation = budgetAmount * conservationPct;
  const creatorShare = input.referralRole === "CREATOR" ? commission * creatorSharePct : 0;
  const bluepassNet = commission - creatorShare;
  const operatorNet = Math.max(0, budgetAmount - commission - conservation);
  const base = {
    inquiryId: input.inquiryId,
    currency,
    status: "PENDING" as const,
    referralPartnerId: input.referralPartnerId,
    referralLinkId: input.referralLinkId ?? null,
    referralCode: input.referralCode ?? null,
    referralRole: input.referralRole ?? null,
    metadata: {
      budgetAmount,
      capApplied
    }
  };

  return [
    { ...base, kind: "CREATOR_COMMISSION_ESTIMATE", amountCents: toCents(creatorShare) },
    { ...base, kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: toCents(bluepassNet) },
    { ...base, kind: "CONSERVATION_ALLOCATION", amountCents: toCents(conservation) },
    { ...base, kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: toCents(operatorNet) }
  ];
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
