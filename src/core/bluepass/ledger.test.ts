import { describe, expect, it } from "vitest";
import { calculateBluePassLedgerEstimate } from "./ledger";

describe("calculateBluePassLedgerEstimate", () => {
  it("splits a referred booking estimate into pending ledger rows", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_1",
      budget: "USD 10000",
      referralPartnerId: "partner_creator_1",
      referralCode: "CREATOR42",
      referralRole: "CREATOR"
    });

    expect(entries).toEqual([
      expect.objectContaining({ kind: "CREATOR_COMMISSION_ESTIMATE", amountCents: 22500 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", amountCents: 52500 }),
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", amountCents: 50000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", amountCents: 875000 })
    ]);
  });

  it("returns no entries without referral attribution", () => {
    expect(
      calculateBluePassLedgerEstimate({
        inquiryId: "inquiry_1",
        budget: "USD 10000"
      })
    ).toEqual([]);
  });

  it("tags an AUD budget as AUD and skips the USD-denominated commission cap", () => {
    const entries = calculateBluePassLedgerEstimate({
      inquiryId: "inquiry_2",
      budget: "AUD 10000",
      referralPartnerId: "partner_creator_1",
      referralCode: "CREATOR42",
      referralRole: "CREATOR"
    });

    // Same 10000 budget as the USD case above, but uncapped: 10000 * 0.15 = 1500 commission
    // instead of being clamped to the USD-denominated 750 cap.
    expect(entries).toEqual([
      expect.objectContaining({ kind: "CREATOR_COMMISSION_ESTIMATE", currency: "AUD", amountCents: 45000 }),
      expect.objectContaining({ kind: "BLUEPASS_PLATFORM_COMMISSION", currency: "AUD", amountCents: 105000 }),
      expect.objectContaining({ kind: "CONSERVATION_ALLOCATION", currency: "AUD", amountCents: 50000 }),
      expect.objectContaining({ kind: "OPERATOR_PAYOUT_PLACEHOLDER", currency: "AUD", amountCents: 800000 })
    ]);
    expect(entries[0].metadata).toEqual({ budgetAmount: 10000, capApplied: false });
  });
});
