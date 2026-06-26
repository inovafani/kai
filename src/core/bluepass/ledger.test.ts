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
});
