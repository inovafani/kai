import {
  createBluePassCheckoutSessionForPmsBooking,
  type CreateBluePassCheckoutSessionForPmsBookingInput
} from "./bluepass-pms-stripe";
import type { BluePassStripeEnv } from "./bluepass-stripe";

export interface BluePassPmsCheckoutClient {
  createCheckoutSession(
    input: CreateBluePassCheckoutSessionForPmsBookingInput
  ): Promise<{ checkoutUrl: string; sessionId: string; attemptId: string }>;
}

// Thin factory so generic-booking-turn.ts depends on a small, mockable interface rather than
// importing the Stripe-calling module directly - mirrors createAssistantLlmClient/
// createGenericBookingRouterClient's shape in this same directory tree.
export function createBluePassPmsCheckoutClient(env: BluePassStripeEnv = process.env): BluePassPmsCheckoutClient {
  return {
    createCheckoutSession: (input) => createBluePassCheckoutSessionForPmsBooking(input, { env })
  };
}
