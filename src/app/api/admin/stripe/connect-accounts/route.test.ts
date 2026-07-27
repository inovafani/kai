import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { createOrRefreshBluePassOperatorStripeConnectAccount } from "@/server/payments/bluepass-stripe";

vi.mock("@/server/payments/bluepass-stripe", () => ({
  createOrRefreshBluePassOperatorStripeConnectAccount: vi.fn()
}));

const createOrRefreshMock = vi.mocked(createOrRefreshBluePassOperatorStripeConnectAccount);

function postRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/admin/stripe/connect-accounts", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("POST /api/admin/stripe/connect-accounts", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.KAI_ADMIN_TOKEN;
  });

  it("requires the Kai admin token", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";

    const response = await POST(postRequest({}));

    expect(response.status).toBe(401);
    expect(createOrRefreshMock).not.toHaveBeenCalled();
  });

  it("creates a Connect account and returns the onboarding link", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    createOrRefreshMock.mockResolvedValueOnce({
      stripeAccountId: "acct_123",
      onboardingUrl: "https://connect.stripe.com/setup/acct_123"
    });

    const response = await POST(postRequest({}, { authorization: "Bearer admin_secret" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(createOrRefreshMock).toHaveBeenCalledWith({ existingStripeAccountId: null });
    expect(body).toEqual({ stripeAccountId: "acct_123", onboardingUrl: "https://connect.stripe.com/setup/acct_123" });
  });

  it("passes through an existing account id to resume onboarding", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    createOrRefreshMock.mockResolvedValueOnce({
      stripeAccountId: "acct_existing",
      onboardingUrl: "https://connect.stripe.com/setup/acct_existing"
    });

    await POST(
      postRequest({ existingStripeAccountId: "acct_existing" }, { authorization: "Bearer admin_secret" })
    );

    expect(createOrRefreshMock).toHaveBeenCalledWith({ existingStripeAccountId: "acct_existing" });
  });

  it("returns a 400 when the Stripe call fails", async () => {
    process.env.KAI_ADMIN_TOKEN = "admin_secret";
    createOrRefreshMock.mockRejectedValueOnce(new Error("BLUEPASS_STRIPE_SECRET_KEY is not configured."));

    const response = await POST(postRequest({}, { authorization: "Bearer admin_secret" }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toEqual({
      code: "CONNECT_ACCOUNT_FAILED",
      message: "BLUEPASS_STRIPE_SECRET_KEY is not configured."
    });
  });
});
