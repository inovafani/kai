import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import {
  getBluePassStripeClient,
  handleBluePassCheckoutSessionCompleted,
  handleBluePassCheckoutSessionExpired,
  resolveBluePassStripeWebhookSecret
} from "@/server/payments/bluepass-stripe";

vi.mock("@/server/payments/bluepass-stripe", () => ({
  getBluePassStripeClient: vi.fn(),
  resolveBluePassStripeWebhookSecret: vi.fn(),
  handleBluePassCheckoutSessionCompleted: vi.fn(),
  handleBluePassCheckoutSessionExpired: vi.fn()
}));

const getBluePassStripeClientMock = vi.mocked(getBluePassStripeClient);
const resolveBluePassStripeWebhookSecretMock = vi.mocked(resolveBluePassStripeWebhookSecret);
const handleBluePassCheckoutSessionCompletedMock = vi.mocked(handleBluePassCheckoutSessionCompleted);
const handleBluePassCheckoutSessionExpiredMock = vi.mocked(handleBluePassCheckoutSessionExpired);

function webhookRequest(body: string, signature: string | null = "t=1,v1=fake") {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    headers: signature ? { "stripe-signature": signature } : {},
    body
  });
}

describe("POST /api/webhooks/stripe", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request with no Stripe-Signature header", async () => {
    const response = await POST(webhookRequest("{}", null));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("MISSING_SIGNATURE");
  });

  it("rejects a request whose signature fails verification", async () => {
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => {
          throw new Error("No signatures found matching the expected signature for payload.");
        })
      }
    } as never);

    const response = await POST(webhookRequest("{}"));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_SIGNATURE");
    expect(handleBluePassCheckoutSessionCompletedMock).not.toHaveBeenCalled();
  });

  it("handles a verified checkout.session.completed event", async () => {
    const session = { id: "cs_test_123" };
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({ type: "checkout.session.completed", data: { object: session } }))
      }
    } as never);

    const response = await POST(webhookRequest(JSON.stringify(session)));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true });
    expect(handleBluePassCheckoutSessionCompletedMock).toHaveBeenCalledWith(session);
    expect(handleBluePassCheckoutSessionExpiredMock).not.toHaveBeenCalled();
  });

  it("handles a verified checkout.session.expired event", async () => {
    const session = { id: "cs_test_456" };
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({ type: "checkout.session.expired", data: { object: session } }))
      }
    } as never);

    const response = await POST(webhookRequest(JSON.stringify(session)));

    expect(response.status).toBe(200);
    expect(handleBluePassCheckoutSessionExpiredMock).toHaveBeenCalledWith(session);
  });

  it("still acknowledges with 200 and reports the failure when the handler throws", async () => {
    const session = { id: "cs_test_789" };
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({ type: "checkout.session.completed", data: { object: session } }))
      }
    } as never);
    handleBluePassCheckoutSessionCompletedMock.mockRejectedValueOnce(new Error("DB unavailable"));

    const response = await POST(webhookRequest(JSON.stringify(session)));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, failures: ["DB unavailable"] });
  });

  it("acknowledges but ignores an event type it doesn't handle", async () => {
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({ type: "payment_intent.created", data: { object: {} } }))
      }
    } as never);

    const response = await POST(webhookRequest("{}"));

    expect(response.status).toBe(200);
    expect(handleBluePassCheckoutSessionCompletedMock).not.toHaveBeenCalled();
    expect(handleBluePassCheckoutSessionExpiredMock).not.toHaveBeenCalled();
  });
});
