import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrReuseBluePassInquiry,
  handleBluePassOperatorResponse,
  syncBluePassReferralLedgerEstimate
} from "@/server/bluepass/bluepass-inquiry-repository";
import { approveBluePassQuote, getBluePassQuote } from "@/server/bluepass/bluepass-quote";
import { prisma } from "@/lib/prisma";
import {
  createBluePassCheckoutSession,
  createOrRefreshBluePassOperatorStripeConnectAccount,
  handleBluePassCheckoutSessionCompleted,
  handleBluePassCheckoutSessionExpired,
  releaseBluePassLedgerEntryPayoutViaStripe
} from "./bluepass-stripe";

const originalEnv = { ...process.env };

beforeEach(() => {
  delete process.env.META_GRAPH_VERSION;
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID_KAI;
  delete process.env.WHATSAPP_PHONE_ID_OPS;
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

function fakeStripeClient(sessionId: string) {
  return {
    checkout: {
      sessions: {
        create: vi.fn(async () => ({
          id: sessionId,
          url: `https://checkout.stripe.com/c/pay/${sessionId}`,
          payment_intent: null
        }))
      }
    }
  } as never;
}

async function createTestConversation(label: string) {
  const tenant = await prisma.tenant.create({
    data: {
      slug: `bluepass-stripe-${label}-${randomUUID()}`,
      name: `BluePass Stripe ${label}`,
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE"
    }
  });
  const conversation = await prisma.conversation.create({
    data: { tenantId: tenant.id, channel: "WEB_WIDGET" }
  });

  return { tenantId: tenant.id, conversationId: conversation.id };
}

async function createPaymentReadyInquiry(label: string) {
  const { tenantId, conversationId } = await createTestConversation(label);
  const created = await createOrReuseBluePassInquiry({
    tenantId,
    conversationId,
    travellerMessage: "Alila Purnama in Komodo for 2 guests",
    intent: {
      destination: "Komodo",
      dateWindow: "22 July 2026",
      guests: 2,
      travellerName: "Nadia",
      travellerEmail: "nadia@example.com",
      travellerPhone: "085100000199"
    },
    selectedYacht: {
      slug: "alila-purnama",
      name: "Alila Purnama",
      operatorId: "operator_alila_purnama",
      operatorName: "Alila Purnama",
      operatorPhone: "6281234567199"
    },
    referral: {
      referralPartnerId: `partner_stripe_${label}`,
      referralLinkId: `link_stripe_${label}`,
      referralCode: "STRIPE42",
      referralRole: "CREATOR"
    }
  });
  await syncBluePassReferralLedgerEstimate(created.inquiry);

  await handleBluePassOperatorResponse({
    inquiryId: created.inquiry.id,
    action: "counter",
    counterText: "Available 22 July 2026. Final price USD 5000. Includes full board. Excludes flights."
  });
  await approveBluePassQuote({ quoteId: created.inquiry.id });
  await handleBluePassOperatorResponse({
    inquiryId: created.inquiry.id,
    action: "payment_ready",
    counterText: "Payment link: https://pay.example/stripe-test."
  });

  return created.inquiry.id;
}

describe("BluePass Stripe payment collection", () => {
  it("creates a checkout session for a payment-ready quote and persists a pending payment intent", async () => {
    const quoteId = await createPaymentReadyInquiry("checkout-create");
    const sessionId = `cs_test_${randomUUID()}`;

    const result = await createBluePassCheckoutSession(
      { quoteId },
      { stripeClient: fakeStripeClient(sessionId), env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );

    expect(result).toEqual({ checkoutUrl: `https://checkout.stripe.com/c/pay/${sessionId}`, sessionId });

    const paymentIntent = await prisma.bluePassPaymentIntent.findUnique({
      where: { stripeCheckoutSessionId: sessionId }
    });
    expect(paymentIntent).toMatchObject({
      bluePassInquiryId: quoteId,
      status: "PENDING",
      amountCents: 500000,
      currency: "USD"
    });
  }, 45_000);

  it("throws when the quote is not yet payment-ready", async () => {
    const { tenantId, conversationId } = await createTestConversation("checkout-not-ready");
    const created = await createOrReuseBluePassInquiry({
      tenantId,
      conversationId,
      travellerMessage: "Calico Jack in Komodo for 2 guests",
      intent: {
        destination: "Komodo",
        dateWindow: "20 July 2026",
        guests: 2,
        travellerName: "Budi",
        travellerEmail: "budi@example.com",
        travellerPhone: "085100000299"
      },
      selectedYacht: {
        slug: "calico-jack",
        name: "Calico Jack",
        operatorId: "operator_calico_jack",
        operatorName: "Calico Jack",
        operatorPhone: "6281234567299"
      }
    });
    // Has a real drafted quote (READY_FOR_TRAVELLER) but the operator hasn't sent "payment ready"
    // yet - this is the actual "not ready for payment" scenario, distinct from "no quote exists".
    await handleBluePassOperatorResponse({
      inquiryId: created.inquiry.id,
      action: "counter",
      counterText: "Available 20 July 2026. Final price USD 3000."
    });

    await expect(
      createBluePassCheckoutSession({ quoteId: created.inquiry.id }, { stripeClient: fakeStripeClient("cs_unused") })
    ).rejects.toThrow(/not ready for payment/);
  }, 20_000);

  it("marks the payment succeeded, records a payment-confirmed event, and finalizes the real ledger split", async () => {
    const quoteId = await createPaymentReadyInquiry("checkout-completed");
    const sessionId = `cs_test_${randomUUID()}`;
    const paymentIntentId = `pi_test_${randomUUID()}`;
    await createBluePassCheckoutSession(
      { quoteId },
      { stripeClient: fakeStripeClient(sessionId), env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );

    await handleBluePassCheckoutSessionCompleted({ id: sessionId, payment_intent: paymentIntentId } as never);

    const paymentIntent = await prisma.bluePassPaymentIntent.findUnique({
      where: { stripeCheckoutSessionId: sessionId }
    });
    expect(paymentIntent).toMatchObject({ status: "SUCCEEDED", stripePaymentIntentId: paymentIntentId });

    const paidEvent = await prisma.bluePassInquiryEvent.findFirst({
      where: { bluePassInquiryId: quoteId, type: "BLUEPASS_PAYMENT_CONFIRMED" }
    });
    expect(paidEvent).not.toBeNull();

    const finalized = await prisma.bluePassLedgerEntry.findMany({
      where: { bluePassInquiryId: quoteId, status: "FINALIZED" }
    });
    expect(finalized.reduce((sum, entry) => sum + entry.amountCents, 0)).toBe(500000);
    expect(finalized.find((entry) => entry.kind === "CREATOR_COMMISSION_ESTIMATE")?.amountCents).toBe(25000);

    const quote = await getBluePassQuote({ quoteId });
    expect(quote?.operationalStatus).toBe("PAID");
  }, 45_000);

  it("is idempotent when the same checkout.session.completed event is redelivered", async () => {
    const quoteId = await createPaymentReadyInquiry("checkout-idempotent");
    const sessionId = `cs_test_${randomUUID()}`;
    const paymentIntentId = `pi_test_${randomUUID()}`;
    await createBluePassCheckoutSession(
      { quoteId },
      { stripeClient: fakeStripeClient(sessionId), env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );

    await handleBluePassCheckoutSessionCompleted({ id: sessionId, payment_intent: paymentIntentId } as never);
    await handleBluePassCheckoutSessionCompleted({ id: sessionId, payment_intent: paymentIntentId } as never);

    const finalized = await prisma.bluePassLedgerEntry.findMany({
      where: { bluePassInquiryId: quoteId, status: "FINALIZED" }
    });
    const paidEvents = await prisma.bluePassInquiryEvent.findMany({
      where: { bluePassInquiryId: quoteId, type: "BLUEPASS_PAYMENT_CONFIRMED" }
    });

    expect(finalized).toHaveLength(5);
    expect(paidEvents).toHaveLength(1);
  }, 45_000);

  it("marks a pending payment intent expired", async () => {
    const quoteId = await createPaymentReadyInquiry("checkout-expired");
    const sessionId = `cs_test_${randomUUID()}`;
    await createBluePassCheckoutSession(
      { quoteId },
      { stripeClient: fakeStripeClient(sessionId), env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );

    await handleBluePassCheckoutSessionExpired({ id: sessionId } as never);

    const paymentIntent = await prisma.bluePassPaymentIntent.findUnique({
      where: { stripeCheckoutSessionId: sessionId }
    });
    expect(paymentIntent?.status).toBe("EXPIRED");
  }, 45_000);

  it("does nothing for an unknown checkout session id", async () => {
    await expect(handleBluePassCheckoutSessionExpired({ id: "cs_never_created" } as never)).resolves.toBeUndefined();
    await expect(
      handleBluePassCheckoutSessionCompleted({ id: "cs_never_created", payment_intent: null } as never)
    ).resolves.toBeUndefined();
  });

  it("creates a new Stripe Connect account and onboarding link when the operator has none yet", async () => {
    const accountsCreate = vi.fn(async () => ({ id: "acct_new_123" }));
    const accountLinksCreate = vi.fn(async () => ({ url: "https://connect.stripe.com/setup/acct_new_123" }));
    const stripeClient = { accounts: { create: accountsCreate }, accountLinks: { create: accountLinksCreate } } as never;

    const result = await createOrRefreshBluePassOperatorStripeConnectAccount(
      { existingStripeAccountId: null },
      { stripeClient, env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );

    expect(accountsCreate).toHaveBeenCalledWith({ type: "express" });
    expect(accountLinksCreate).toHaveBeenCalledWith({
      account: "acct_new_123",
      refresh_url: "https://bluepass.co/dashboard",
      return_url: "https://bluepass.co/dashboard",
      type: "account_onboarding"
    });
    expect(result).toEqual({ stripeAccountId: "acct_new_123", onboardingUrl: "https://connect.stripe.com/setup/acct_new_123" });
  });

  it("reuses an existing Stripe Connect account instead of creating a new one", async () => {
    const accountsCreate = vi.fn();
    const accountLinksCreate = vi.fn(async () => ({ url: "https://connect.stripe.com/setup/acct_existing_456" }));
    const stripeClient = { accounts: { create: accountsCreate }, accountLinks: { create: accountLinksCreate } } as never;

    const result = await createOrRefreshBluePassOperatorStripeConnectAccount(
      { existingStripeAccountId: "acct_existing_456" },
      { stripeClient, env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );

    expect(accountsCreate).not.toHaveBeenCalled();
    expect(accountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_existing_456" })
    );
    expect(result.stripeAccountId).toBe("acct_existing_456");
  });

  it("releases the operator's payout share as a real Stripe transfer and marks the entry paid", async () => {
    const quoteId = await createPaymentReadyInquiry("payout-release");
    const sessionId = `cs_test_${randomUUID()}`;
    await createBluePassCheckoutSession(
      { quoteId },
      { stripeClient: fakeStripeClient(sessionId), env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );
    await handleBluePassCheckoutSessionCompleted({ id: sessionId, payment_intent: `pi_test_${randomUUID()}` } as never);

    const payoutEntry = await prisma.bluePassLedgerEntry.findFirstOrThrow({
      where: { bluePassInquiryId: quoteId, kind: "OPERATOR_PAYOUT_PLACEHOLDER", status: "FINALIZED" }
    });
    const transferId = `tr_test_${randomUUID()}`;
    const transfersCreate = vi.fn(async () => ({ id: transferId }));
    const stripeClient = { transfers: { create: transfersCreate } } as never;

    const result = await releaseBluePassLedgerEntryPayoutViaStripe(
      { entryId: payoutEntry.id, stripeConnectAccountId: "acct_operator_release", reviewerEmail: "admin@bluepass.co" },
      { stripeClient }
    );

    expect(transfersCreate).toHaveBeenCalledWith({
      amount: payoutEntry.amountCents,
      currency: payoutEntry.currency.toLowerCase(),
      destination: "acct_operator_release"
    });
    expect(result).toMatchObject({ paidOutReference: transferId, paidOutBy: "admin@bluepass.co" });

    const payoutRecord = await prisma.bluePassOperatorPayout.findUnique({
      where: { bluePassLedgerEntryId: payoutEntry.id }
    });
    expect(payoutRecord).toMatchObject({
      status: "TRANSFERRED",
      stripeTransferId: transferId,
      stripeConnectAccountId: "acct_operator_release"
    });
  }, 45_000);

  it("refuses to release a non-operator ledger entry via Stripe transfer", async () => {
    const quoteId = await createPaymentReadyInquiry("payout-guard");
    const sessionId = `cs_test_${randomUUID()}`;
    await createBluePassCheckoutSession(
      { quoteId },
      { stripeClient: fakeStripeClient(sessionId), env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );
    await handleBluePassCheckoutSessionCompleted({ id: sessionId, payment_intent: `pi_test_${randomUUID()}` } as never);

    const conservationEntry = await prisma.bluePassLedgerEntry.findFirstOrThrow({
      where: { bluePassInquiryId: quoteId, kind: "CONSERVATION_ALLOCATION", status: "FINALIZED" }
    });
    const transfersCreate = vi.fn();

    await expect(
      releaseBluePassLedgerEntryPayoutViaStripe(
        { entryId: conservationEntry.id, stripeConnectAccountId: "acct_operator_guard", reviewerEmail: "admin@bluepass.co" },
        { stripeClient: { transfers: { create: transfersCreate } } as never }
      )
    ).rejects.toThrow(/OPERATOR_PAYOUT_PLACEHOLDER/);
    expect(transfersCreate).not.toHaveBeenCalled();
  }, 45_000);

  it("records a failed payout attempt and rethrows when the Stripe transfer itself fails", async () => {
    const quoteId = await createPaymentReadyInquiry("payout-failure");
    const sessionId = `cs_test_${randomUUID()}`;
    await createBluePassCheckoutSession(
      { quoteId },
      { stripeClient: fakeStripeClient(sessionId), env: { BLUEPASS_APP_URL: "https://bluepass.co" } }
    );
    await handleBluePassCheckoutSessionCompleted({ id: sessionId, payment_intent: `pi_test_${randomUUID()}` } as never);

    const payoutEntry = await prisma.bluePassLedgerEntry.findFirstOrThrow({
      where: { bluePassInquiryId: quoteId, kind: "OPERATOR_PAYOUT_PLACEHOLDER", status: "FINALIZED" }
    });
    const transfersCreate = vi.fn(async () => {
      throw new Error("Your destination account's capabilities have not been enabled.");
    });

    await expect(
      releaseBluePassLedgerEntryPayoutViaStripe(
        { entryId: payoutEntry.id, stripeConnectAccountId: "acct_operator_failure", reviewerEmail: "admin@bluepass.co" },
        { stripeClient: { transfers: { create: transfersCreate } } as never }
      )
    ).rejects.toThrow("capabilities have not been enabled");

    const payoutRecord = await prisma.bluePassOperatorPayout.findUnique({
      where: { bluePassLedgerEntryId: payoutEntry.id }
    });
    expect(payoutRecord).toMatchObject({ status: "FAILED", failureReason: expect.stringContaining("capabilities") });

    const entryAfterFailure = await prisma.bluePassLedgerEntry.findUniqueOrThrow({ where: { id: payoutEntry.id } });
    expect(entryAfterFailure.paidOutAt).toBeNull();
  }, 45_000);
});
