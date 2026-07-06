import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";
import { approveBluePassQuote, getBluePassQuote } from "@/server/bluepass/bluepass-quote";

vi.mock("@/server/bluepass/bluepass-quote", () => ({
  approveBluePassQuote: vi.fn(),
  getBluePassQuote: vi.fn()
}));

const getBluePassQuoteMock = vi.mocked(getBluePassQuote);
const approveBluePassQuoteMock = vi.mocked(approveBluePassQuote);

describe("/api/bluepass/quotes/[quoteId]", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns a quote by id", async () => {
    getBluePassQuoteMock.mockResolvedValueOnce({
      id: "inq_1",
      inquiryId: "inq_1",
      status: "READY_FOR_TRAVELLER",
      operationalStatus: "READY_FOR_TRAVELLER",
      selectedYachtName: "Calico Jack",
      operatorName: "Calico Jack",
      destination: "Komodo",
      dateWindow: "6 July",
      guests: 2,
      currency: "USD",
      grossPriceCents: 390000,
      conservationContributionCents: 19500,
      inclusions: "full board meals",
      exclusions: "flights",
      terms: "30% deposit",
      paymentText: null,
      confirmationText: null,
      source: "operator_counter",
      quoteUrl: "https://bluepass.co/quotes/inq_1",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z"
    });

    const response = await GET(new Request("http://localhost/api/bluepass/quotes/inq_1"), {
      params: Promise.resolve({ quoteId: "inq_1" })
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(getBluePassQuoteMock).toHaveBeenCalledWith({ quoteId: "inq_1" });
    expect(body.quote).toMatchObject({
      id: "inq_1",
      status: "READY_FOR_TRAVELLER",
      grossPriceCents: 390000
    });
  });

  it("approves a quote", async () => {
    approveBluePassQuoteMock.mockResolvedValueOnce({
      id: "inq_1",
      inquiryId: "inq_1",
      status: "TRAVELLER_APPROVED",
      operationalStatus: "TRAVELLER_APPROVED",
      selectedYachtName: "Calico Jack",
      operatorName: "Calico Jack",
      destination: "Komodo",
      dateWindow: "6 July",
      guests: 2,
      currency: "USD",
      grossPriceCents: 390000,
      conservationContributionCents: 19500,
      inclusions: "full board meals",
      exclusions: "flights",
      terms: "30% deposit",
      paymentText: null,
      confirmationText: null,
      source: "operator_counter",
      quoteUrl: "https://bluepass.co/quotes/inq_1",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:01:00.000Z"
    });

    const response = await POST(
      new Request("http://localhost/api/bluepass/quotes/inq_1", {
        method: "POST",
        body: JSON.stringify({ action: "approve" })
      }),
      { params: Promise.resolve({ quoteId: "inq_1" }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(approveBluePassQuoteMock).toHaveBeenCalledWith({ quoteId: "inq_1" });
    expect(body.quote).toMatchObject({
      id: "inq_1",
      status: "TRAVELLER_APPROVED"
    });
  });
});
