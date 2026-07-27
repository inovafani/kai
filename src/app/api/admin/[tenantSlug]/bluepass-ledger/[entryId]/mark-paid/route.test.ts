import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { markBluePassLedgerEntryPaid } from "@/server/bluepass/bluepass-inquiry-repository";
import { releaseBluePassLedgerEntryPayoutViaStripe } from "@/server/payments/bluepass-stripe";

vi.mock("@/server/bluepass/bluepass-inquiry-repository", () => ({
  markBluePassLedgerEntryPaid: vi.fn()
}));

vi.mock("@/server/payments/bluepass-stripe", () => ({
  releaseBluePassLedgerEntryPayoutViaStripe: vi.fn()
}));

const markBluePassLedgerEntryPaidMock = vi.mocked(markBluePassLedgerEntryPaid);
const releaseBluePassLedgerEntryPayoutViaStripeMock = vi.mocked(releaseBluePassLedgerEntryPayoutViaStripe);

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/bluepass/bluepass-ledger/entry_1/mark-paid", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("POST /api/admin/[tenantSlug]/bluepass-ledger/[entryId]/mark-paid", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await POST(postRequest({ paidOutReference: "ref", reviewerEmail: "a@b.com" }), {
      params: Promise.resolve({ tenantSlug: "bluepass", entryId: "entry_1" })
    });

    expect(response.status).toBe(401);
    expect(markBluePassLedgerEntryPaidMock).not.toHaveBeenCalled();
  });

  it("rejects a request missing paidOutReference or reviewerEmail", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await POST(postRequest({ paidOutReference: "ref" }, { authorization: "Bearer admin_secret" }), {
      params: Promise.resolve({ tenantSlug: "bluepass", entryId: "entry_1" })
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MISSING_FIELDS");
    expect(markBluePassLedgerEntryPaidMock).not.toHaveBeenCalled();
  });

  it("marks the entry paid and returns it", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    markBluePassLedgerEntryPaidMock.mockResolvedValueOnce({
      id: "entry_1",
      status: "FINALIZED",
      paidOutAt: new Date("2026-07-20T10:00:00.000Z"),
      paidOutReference: "bank-ref-123",
      paidOutBy: "admin@bluepass.co"
    } as never);

    const response = await POST(
      postRequest(
        { paidOutReference: "bank-ref-123", reviewerEmail: "admin@bluepass.co" },
        { authorization: "Bearer admin_secret" }
      ),
      { params: Promise.resolve({ tenantSlug: "bluepass", entryId: "entry_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(markBluePassLedgerEntryPaidMock).toHaveBeenCalledWith({
      entryId: "entry_1",
      paidOutReference: "bank-ref-123",
      reviewerEmail: "admin@bluepass.co"
    });
    expect(body.entry).toMatchObject({ id: "entry_1", paidOutReference: "bank-ref-123" });
  });

  it("returns 400 when the repository rejects a non-finalized entry", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    markBluePassLedgerEntryPaidMock.mockRejectedValueOnce(
      new Error("BluePass ledger entry entry_1 is PENDING, not FINALIZED - only finalized entries can be marked paid.")
    );

    const response = await POST(
      postRequest({ paidOutReference: "ref", reviewerEmail: "admin@bluepass.co" }, { authorization: "Bearer admin_secret" }),
      { params: Promise.resolve({ tenantSlug: "bluepass", entryId: "entry_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MARK_PAID_FAILED");
    expect(body.error.message).toContain("not FINALIZED");
  });

  it("releases via Stripe transfer when stripeConnectAccountId is provided", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    releaseBluePassLedgerEntryPayoutViaStripeMock.mockResolvedValueOnce({
      id: "entry_1",
      status: "FINALIZED",
      paidOutAt: new Date("2026-07-24T10:00:00.000Z"),
      paidOutReference: "tr_test_123",
      paidOutBy: "admin@bluepass.co"
    } as never);

    const response = await POST(
      postRequest(
        { stripeConnectAccountId: "acct_operator_123", reviewerEmail: "admin@bluepass.co" },
        { authorization: "Bearer admin_secret" }
      ),
      { params: Promise.resolve({ tenantSlug: "bluepass", entryId: "entry_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(releaseBluePassLedgerEntryPayoutViaStripeMock).toHaveBeenCalledWith({
      entryId: "entry_1",
      stripeConnectAccountId: "acct_operator_123",
      reviewerEmail: "admin@bluepass.co"
    });
    expect(markBluePassLedgerEntryPaidMock).not.toHaveBeenCalled();
    expect(body.entry).toMatchObject({ id: "entry_1", paidOutReference: "tr_test_123" });
  });

  it("rejects a Stripe release request missing reviewerEmail", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await POST(
      postRequest({ stripeConnectAccountId: "acct_operator_123" }, { authorization: "Bearer admin_secret" }),
      { params: Promise.resolve({ tenantSlug: "bluepass", entryId: "entry_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MISSING_FIELDS");
    expect(releaseBluePassLedgerEntryPayoutViaStripeMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the Stripe release rejects a non-operator ledger kind", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    releaseBluePassLedgerEntryPayoutViaStripeMock.mockRejectedValueOnce(
      new Error(
        "BluePass ledger entry entry_1 is kind CONSERVATION_ALLOCATION, not OPERATOR_PAYOUT_PLACEHOLDER - only the operator's own payout share can be released via Stripe transfer."
      )
    );

    const response = await POST(
      postRequest(
        { stripeConnectAccountId: "acct_operator_123", reviewerEmail: "admin@bluepass.co" },
        { authorization: "Bearer admin_secret" }
      ),
      { params: Promise.resolve({ tenantSlug: "bluepass", entryId: "entry_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("STRIPE_RELEASE_FAILED");
    expect(body.error.message).toContain("OPERATOR_PAYOUT_PLACEHOLDER");
  });
});
