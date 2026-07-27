import { NextResponse } from "next/server";
import type Stripe from "stripe";
import {
  getBluePassStripeClient,
  handleBluePassCheckoutSessionCompleted,
  handleBluePassCheckoutSessionExpired,
  resolveBluePassStripeWebhookSecret
} from "@/server/payments/bluepass-stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  // Raw text, not .json() - Stripe's signature check is over the exact request bytes.
  const rawBody = await request.text();

  if (!signature) {
    return NextResponse.json(
      { error: { code: "MISSING_SIGNATURE", message: "Missing Stripe-Signature header." } },
      { status: 400 }
    );
  }

  let event: Stripe.Event;
  try {
    const stripe = getBluePassStripeClient();
    const webhookSecret = resolveBluePassStripeWebhookSecret();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("bluepass_stripe_webhook.signature_verification_failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    return NextResponse.json(
      { error: { code: "INVALID_SIGNATURE", message: "Stripe webhook signature verification failed." } },
      { status: 400 }
    );
  }

  // Always ack with 200 once the signature is verified - one handler failure should not make Stripe
  // retry-storm the whole event; failures are logged and surfaced in the response body instead.
  const failures: string[] = [];

  try {
    if (event.type === "checkout.session.completed") {
      await handleBluePassCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
    } else if (event.type === "checkout.session.expired") {
      await handleBluePassCheckoutSessionExpired(event.data.object as Stripe.Checkout.Session);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push(message);
    console.error("bluepass_stripe_webhook.handler_failed", { eventType: event.type, error: message });
  }

  return NextResponse.json({ received: true, ...(failures.length > 0 ? { failures } : {}) });
}
