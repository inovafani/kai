const REZDY_STRIPE_STAGING_PUBLISHABLE_KEY =
  "pk_test_51KW8A8ItvA6u4On8YM6AE95ytcqBr0LeRBEEFw4f5MDQPTDBWVt2TAWXhfynCn7NUVwaGc2eP431DNCkmfMaB0AF00firEVJ58";

const REZDY_STRIPE_PRODUCTION_PUBLISHABLE_KEY =
  "pk_live_51H4gSPHO6p5n6bFnuGRLb84FCiptIUAwmgYaBubvp5A09HujFx54ExvLkXOufEcqrHsaCWvnmZfO33efkIFVbpIv00PkoJDRDA";

export type RezdyPayEnvironment = Record<string, string | undefined>;

export function hasRezdyBookingWriteConfig(env: RezdyPayEnvironment) {
  return Boolean(env.REZDY_BASE_URL?.trim() && env.REZDY_API_KEY?.trim() && env.REZDY_BOOKING_PATH?.trim());
}

export function resolveRezdyStripePublishableKey(env: RezdyPayEnvironment) {
  const configuredKey = env.REZDY_STRIPE_PUBLISHABLE_KEY?.trim();
  if (configuredKey) return configuredKey;

  return env.REZDY_BASE_URL?.includes("staging")
    ? REZDY_STRIPE_STAGING_PUBLISHABLE_KEY
    : REZDY_STRIPE_PRODUCTION_PUBLISHABLE_KEY;
}
