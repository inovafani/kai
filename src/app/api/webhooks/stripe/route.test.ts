import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import {
  getBluePassStripeClient,
  handleBluePassCheckoutSessionCompleted,
  handleBluePassCheckoutSessionExpired,
  resolveBluePassStripeWebhookSecret
} from "@/server/payments/bluepass-stripe";
import {
  handlePmsBookingCheckoutSessionCompleted,
  handlePmsBookingCheckoutSessionExpired
} from "@/server/payments/confirm-bluepass-pms-payment";

vi.mock("@/server/payments/bluepass-stripe", () => ({
  getBluePassStripeClient: vi.fn(),
  resolveBluePassStripeWebhookSecret: vi.fn(),
  handleBluePassCheckoutSessionCompleted: vi.fn(),
  handleBluePassCheckoutSessionExpired: vi.fn()
}));

vi.mock("@/server/payments/confirm-bluepass-pms-payment", () => ({
  handlePmsBookingCheckoutSessionCompleted: vi.fn(),
  handlePmsBookingCheckoutSessionExpired: vi.fn()
}));

const getBluePassStripeClientMock = vi.mocked(getBluePassStripeClient);
const resolveBluePassStripeWebhookSecretMock = vi.mocked(resolveBluePassStripeWebhookSecret);
const handleBluePassCheckoutSessionCompletedMock = vi.mocked(handleBluePassCheckoutSessionCompleted);
const handleBluePassCheckoutSessionExpiredMock = vi.mocked(handleBluePassCheckoutSessionExpired);
const handlePmsBookingCheckoutSessionCompletedMock = vi.mocked(handlePmsBookingCheckoutSessionCompleted);
const handlePmsBookingCheckoutSessionExpiredMock = vi.mocked(handlePmsBookingCheckoutSessionExpired);

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

  it("routes a checkout.session.completed event with kaiFlow PMS_BOOKING_DIRECT metadata to the PMS booking handler, not the BluePass marketplace handler", async () => {
    const session = { id: "cs_test_pms_1", metadata: { kaiFlow: "PMS_BOOKING_DIRECT" } };
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({ type: "checkout.session.completed", data: { object: session } }))
      }
    } as never);

    const response = await POST(webhookRequest(JSON.stringify(session)));

    expect(response.status).toBe(200);
    expect(handlePmsBookingCheckoutSessionCompletedMock).toHaveBeenCalledWith(session);
    expect(handleBluePassCheckoutSessionCompletedMock).not.toHaveBeenCalled();
  });

  it("routes a checkout.session.expired event with kaiFlow PMS_BOOKING_DIRECT metadata to the PMS booking handler", async () => {
    const session = { id: "cs_test_pms_2", metadata: { kaiFlow: "PMS_BOOKING_DIRECT" } };
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({ type: "checkout.session.expired", data: { object: session } }))
      }
    } as never);

    const response = await POST(webhookRequest(JSON.stringify(session)));

    expect(response.status).toBe(200);
    expect(handlePmsBookingCheckoutSessionExpiredMock).toHaveBeenCalledWith(session);
    expect(handleBluePassCheckoutSessionExpiredMock).not.toHaveBeenCalled();
  });

  it("still routes an event with no kaiFlow metadata to the existing BluePass marketplace handler (regression guard)", async () => {
    const session = { id: "cs_test_marketplace", metadata: null };
    resolveBluePassStripeWebhookSecretMock.mockReturnValue("whsec_test");
    getBluePassStripeClientMock.mockReturnValue({
      webhooks: {
        constructEvent: vi.fn(() => ({ type: "checkout.session.completed", data: { object: session } }))
      }
    } as never);

    const response = await POST(webhookRequest(JSON.stringify(session)));

    expect(response.status).toBe(200);
    expect(handleBluePassCheckoutSessionCompletedMock).toHaveBeenCalledWith(session);
    expect(handlePmsBookingCheckoutSessionCompletedMock).not.toHaveBeenCalled();
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
