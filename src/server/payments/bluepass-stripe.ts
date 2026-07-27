import Stripe from "stripe";
import { prisma } from "@/lib/prisma";
import {
  createBluePassInquiryEvent,
  finalizeBluePassLedgerForConfirmedBooking,
  markBluePassLedgerEntryPaid
} from "@/server/bluepass/bluepass-inquiry-repository";
import { getBluePassQuote } from "@/server/bluepass/bluepass-quote";

export type BluePassStripeEnv = Record<string, string | undefined>;

export function getBluePassStripeClient(env: BluePassStripeEnv = process.env): Stripe {
  const secretKey = env.BLUEPASS_STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("BLUEPASS_STRIPE_SECRET_KEY is not configured.");
  }

  return new Stripe(secretKey);
}

export function resolveBluePassStripeWebhookSecret(env: BluePassStripeEnv = process.env): string {
  const secret = env.BLUEPASS_STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("BLUEPASS_STRIPE_WEBHOOK_SECRET is not configured.");
  }

  return secret;
}

/**
 * Creates a real Stripe Checkout Session on BluePass's own account for a quote that's already
 * PAYMENT_READY (the operator has accepted and sent final pricing). This is a plain checkout with
 * no connected-account params - guests always pay BluePass directly ("separate charges and
 * transfers"); the operator's share is transferred out separately later, after payment succeeds.
 */
export async function createBluePassCheckoutSession(
  input: { quoteId: string },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
) {
  const env = deps.env ?? process.env;
  const quote = await getBluePassQuote({ quoteId: input.quoteId });
  if (!quote) {
    throw new Error(`BluePass quote ${input.quoteId} was not found.`);
  }
  if (quote.operationalStatus !== "PAYMENT_READY") {
    throw new Error(
      `BluePass quote ${input.quoteId} is not ready for payment (operational status: ${quote.operationalStatus}).`
    );
  }
  if (!quote.grossPriceCents || quote.grossPriceCents <= 0) {
    throw new Error(`BluePass quote ${input.quoteId} has no valid price to charge yet.`);
  }

  const inquiry = await prisma.bluePassInquiry.findUniqueOrThrow({ where: { id: input.quoteId } });
  const stripe = deps.stripeClient ?? getBluePassStripeClient(env);
  const appBaseUrl = (env.BLUEPASS_APP_URL ?? "https://bluepass.co").replace(/\/$/, "");
  const tripLabel = quote.selectedYachtName ?? quote.destination ?? "BluePass booking";

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: quote.currency.toLowerCase(),
          unit_amount: quote.grossPriceCents,
          product_data: {
            name: `BluePass booking - ${tripLabel}`
          }
        }
      }
    ],
    success_url: `${appBaseUrl}/quotes/${inquiry.id}?payment=success`,
    cancel_url: `${appBaseUrl}/quotes/${inquiry.id}?payment=cancelled`,
    metadata: {
      bluePassInquiryId: inquiry.id,
      tenantId: inquiry.tenantId
    }
  });

  if (!session.url) {
    throw new Error("Stripe did not return a checkout URL for this session.");
  }

  await prisma.bluePassPaymentIntent.create({
    data: {
      tenantId: inquiry.tenantId,
      bluePassInquiryId: inquiry.id,
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      amountCents: quote.grossPriceCents,
      currency: quote.currency.toUpperCase(),
      status: "PENDING"
    }
  });

  return { checkoutUrl: session.url, sessionId: session.id };
}

/**
 * Stripe webhook handler for a successful guest checkout - marks the BluePassPaymentIntent
 * SUCCEEDED, records a BLUEPASS_PAYMENT_CONFIRMED inquiry event, and finalizes the real commission
 * ledger split (finalizeBluePassLedgerForConfirmedBooking is itself idempotent, so this is safe to
 * run even if the operator's WhatsApp "booking confirmed" message already finalized it).
 */
export async function handleBluePassCheckoutSessionCompleted(session: Stripe.Checkout.Session) {
  const paymentIntent = await prisma.bluePassPaymentIntent.findUnique({
    where: { stripeCheckoutSessionId: session.id }
  });

  if (!paymentIntent) {
    console.warn("bluepass_stripe_webhook.unknown_checkout_session", { sessionId: session.id });
    return;
  }
  if (paymentIntent.status === "SUCCEEDED") {
    // Stripe can redeliver the same event - already processed, nothing more to do.
    return;
  }

  const stripePaymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : paymentIntent.stripePaymentIntentId;

  await prisma.bluePassPaymentIntent.update({
    where: { id: paymentIntent.id },
    data: { status: "SUCCEEDED", stripePaymentIntentId }
  });

  const inquiry = await prisma.bluePassInquiry.findUnique({ where: { id: paymentIntent.bluePassInquiryId } });
  if (!inquiry) {
    console.warn("bluepass_stripe_webhook.inquiry_not_found", { bluePassInquiryId: paymentIntent.bluePassInquiryId });
    return;
  }

  await createBluePassInquiryEvent({
    inquiry,
    type: "BLUEPASS_PAYMENT_CONFIRMED",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: {
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId: stripePaymentIntentId ?? null,
      amountCents: paymentIntent.amountCents,
      currency: paymentIntent.currency
    }
  });

  await finalizeBluePassLedgerForConfirmedBooking(inquiry);
}

/** Marks an unpaid checkout session's payment intent EXPIRED once Stripe reports the session lapsed. */
export async function handleBluePassCheckoutSessionExpired(session: Stripe.Checkout.Session) {
  const paymentIntent = await prisma.bluePassPaymentIntent.findUnique({
    where: { stripeCheckoutSessionId: session.id }
  });

  if (!paymentIntent || paymentIntent.status !== "PENDING") return;

  await prisma.bluePassPaymentIntent.update({
    where: { id: paymentIntent.id },
    data: { status: "EXPIRED" }
  });
}

/**
 * Creates a Stripe Connect Express account for an operator (or reuses an existing one bluepass-app
 * already stored), then generates a fresh Stripe-hosted onboarding link for it. Kai has no operator
 * model of its own - bluepass-app is the source of truth for whether an operator already has a
 * stripeConnectAccountId; it passes that in to resume/refresh onboarding instead of creating a
 * second Stripe account for the same operator.
 */
export async function createOrRefreshBluePassOperatorStripeConnectAccount(
  input: { existingStripeAccountId?: string | null },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
) {
  const env = deps.env ?? process.env;
  const stripe = deps.stripeClient ?? getBluePassStripeClient(env);
  const appBaseUrl = (env.BLUEPASS_APP_URL ?? "https://bluepass.co").replace(/\/$/, "");

  const trimmedExistingId = input.existingStripeAccountId?.trim();
  const stripeAccountId = trimmedExistingId || (await stripe.accounts.create({ type: "express" })).id;

  const accountLink = await stripe.accountLinks.create({
    account: stripeAccountId,
    refresh_url: `${appBaseUrl}/dashboard`,
    return_url: `${appBaseUrl}/dashboard`,
    type: "account_onboarding"
  });

  return { stripeAccountId, onboardingUrl: accountLink.url };
}

/**
 * Releases one FINALIZED ledger entry's operator share as a real Stripe transfer, then delegates to
 * the existing markBluePassLedgerEntryPaid so the audit trail/idempotency stays a single source of
 * truth regardless of whether an entry was paid manually or via Stripe. The destination Connect
 * account id is admin-supplied (same manual-trust model as the existing paidOutReference field) -
 * kai has no first-party link to bluepass-app's OperatorProfile rows to look this up automatically.
 * Gated to OPERATOR_PAYOUT_PLACEHOLDER entries only: every other ledger kind (conservation, platform
 * commission, creator commission, payment processing) is BluePass's/the partner's own revenue, not
 * money that belongs to the operator - transferring those to an operator's account would be a real
 * money-safety bug, not just a data-modeling nicety.
 */
export async function releaseBluePassLedgerEntryPayoutViaStripe(
  input: { entryId: string; stripeConnectAccountId: string; reviewerEmail: string },
  deps: { stripeClient?: Stripe; env?: BluePassStripeEnv } = {}
) {
  const entry = await prisma.bluePassLedgerEntry.findUniqueOrThrow({ where: { id: input.entryId } });

  if (entry.kind !== "OPERATOR_PAYOUT_PLACEHOLDER") {
    throw new Error(
      `BluePass ledger entry ${input.entryId} is kind ${entry.kind}, not OPERATOR_PAYOUT_PLACEHOLDER - only the operator's own payout share can be released via Stripe transfer.`
    );
  }
  if (entry.status !== "FINALIZED") {
    throw new Error(
      `BluePass ledger entry ${input.entryId} is ${entry.status}, not FINALIZED - only finalized entries can be paid out.`
    );
  }
  if (entry.paidOutAt) {
    // Already paid out (manually or via a previous Stripe transfer) - idempotent no-op.
    return entry;
  }

  const stripe = deps.stripeClient ?? getBluePassStripeClient(deps.env);

  let transfer: Stripe.Transfer;
  try {
    transfer = await stripe.transfers.create({
      amount: entry.amountCents,
      currency: entry.currency.toLowerCase(),
      destination: input.stripeConnectAccountId
    });
  } catch (error) {
    await prisma.bluePassOperatorPayout.upsert({
      where: { bluePassLedgerEntryId: entry.id },
      create: {
        tenantId: entry.tenantId,
        bluePassLedgerEntryId: entry.id,
        stripeConnectAccountId: input.stripeConnectAccountId,
        amountCents: entry.amountCents,
        currency: entry.currency,
        status: "FAILED",
        releasedBy: input.reviewerEmail,
        failureReason: error instanceof Error ? error.message : String(error)
      },
      update: {
        status: "FAILED",
        releasedBy: input.reviewerEmail,
        failureReason: error instanceof Error ? error.message : String(error)
      }
    });
    throw error;
  }

  await prisma.bluePassOperatorPayout.upsert({
    where: { bluePassLedgerEntryId: entry.id },
    create: {
      tenantId: entry.tenantId,
      bluePassLedgerEntryId: entry.id,
      stripeConnectAccountId: input.stripeConnectAccountId,
      stripeTransferId: transfer.id,
      amountCents: entry.amountCents,
      currency: entry.currency,
      status: "TRANSFERRED",
      releasedBy: input.reviewerEmail,
      releasedAt: new Date()
    },
    update: {
      stripeTransferId: transfer.id,
      status: "TRANSFERRED",
      releasedBy: input.reviewerEmail,
      releasedAt: new Date(),
      failureReason: null
    }
  });

  return markBluePassLedgerEntryPaid({
    entryId: entry.id,
    paidOutReference: transfer.id,
    reviewerEmail: input.reviewerEmail
  });
}
