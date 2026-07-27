import { describe, expect, it } from "vitest";
import { calculateBluePassLedgerEstimate, calculateConservationContributionCents } from "./ledger";

describe("calculateBluePassLedgerEstimate", () => {
  it("splits a referred booking into the real 18% (5/5/3/5) breakdown, operator keeps 82%", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_1",
      budget: "USD 10000",
      referralPartnerId: "partner_creator_1",
      referralCode: "CREATOR42",
      referralRole: "CREATOR"
    });

    expect(entries).toEqual([
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", amountCents: 50000 }),
      expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: 30000 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 50000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 820000 }),
      expect.objectContaining({ kind: "CREATOR_COMMISSION_ESTIMATE", amountCents: 50000 })
    ]);
    // All rows sum to exactly the budget - no rounding leakage between buckets.
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(1_000_000);
  });

  it("still posts conservation, payments, platform fee, and operator payout without a referral - only the partner line is skipped", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_1",
      budget: "USD 10000"
    });

    // No CREATOR_COMMISSION_ESTIMATE row at all when unreferred - the platform-fee bucket absorbs
    // the unused partner slice (10% instead of 5%) so operator net still lands on 82%.
    expect(entries).toEqual([
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", amountCents: 50000 }),
      expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", amountCents: 30000 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 100000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 820000 })
    ]);
    expect(entries.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(1_000_000);
  });

  it("applies the identical percentage split to a large AUD budget - no dollar cap", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_2",
      budget: "AUD 100000",
      referralPartnerId: "partner_creator_1",
      referralCode: "CREATOR42",
      referralRole: "CREATOR"
    });

    // Same percentages as the USD case, just 10x the budget and no cap kicking in at any size.
    expect(entries).toEqual([
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", currency: "AUD", amountCents: 500000 }),
      expect.objectContaining({ kind: "PAYMENT_PROCESSING_ALLOCATION", currency: "AUD", amountCents: 300000 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", currency: "AUD", amountCents: 500000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", currency: "AUD", amountCents: 8200000 }),
      expect.objectContaining({ kind: "CREATOR_COMMISSION_ESTIMATE", currency: "AUD", amountCents: 500000 })
    ]);
    expect(entries[0].metadata).toEqual({ budgetAmount: 100000 });
  });

  it("pays the partner commission for any referral role, not only CREATOR", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_3",
      budget: "USD 10000",
      referralPartnerId: "partner_dive_shop_1",
      referralRole: "DIVE_SHOP"
    });

    expect(entries).toContainEqual(
      expect.objectContaining({ kind: "CREATOR_COMMISSION_ESTIMATE", amountCents: 50000 })
    );
  });
});

describe("calculateConservationContributionCents", () => {
  it("matches the ledger's own 5% conservation figure for a real gross price", () => {
    expect(calculateConservationContributionCents(1_000_000)).toBe(50000);
  });
});
