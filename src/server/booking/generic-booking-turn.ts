import { formatDateAndTime } from "@/core/booking/friendly-date";
import type { BookingMemoryState } from "@/core/booking/booking-memory";
import { updateBookingMemoryState } from "@/core/booking/booking-memory";
import { handleTravellerBookingMessage, formatCurrencyAmount, type BookingOrchestratorResult } from "@/core/booking/booking-orchestrator";
import { calculateConservationContributionCents } from "@/core/bluepass/ledger";
import { formatCancellationPolicySummary } from "@/core/cancellation/rules";
import type { AssistantConversationMessage, AssistantLlmClient } from "@/core/llm/assistant-reply-composer";
import type { GenericBookingRouterLlmClient } from "@/core/llm/generic-booking-router";
import { parseKnowledgePack, summarizeKnowledgePack } from "@/core/knowledge/knowledge-matcher";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import type { PmsProvider } from "@/core/tenant/types";
import { buildBookingFailureManualInquiry } from "@/server/conversation/manual-inquiry-fallback";
import { createManualInquiry, upsertConversationBookingState } from "@/server/conversation/conversation-repository";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";
import { BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE, REZDY_CHECKOUT_HANDOFF_FEATURE } from "@/core/tenant/feature-flags";
import { buildRezdyCheckoutUrl } from "@/server/payments/rezdy-checkout-link";
import { createBluePassPmsCheckoutClient, type BluePassPmsCheckoutClient } from "@/server/payments/bluepass-pms-checkout-client";
import { resolveOperatorPayoutAccount } from "@/server/payments/operator-payout-account-client";

export interface GenericBookingTurnTenant {
  id: string;
  slug: string;
  name: string;
  config: {
    pmsProvider: PmsProvider;
    publicProductCatalog: unknown;
    operatorKnowledgePack?: unknown;
    bookingWriteEnabled?: boolean | null;
    responseGuardrails?: string[] | null;
    enabledFeatures?: string[] | null;
  } | null;
  branding: {
    brandVoice: string | null;
  } | null;
}

export interface RunGenericBookingTurnInput {
  tenant: GenericBookingTurnTenant;
  conversationId: string;
  content: string;
  previousBookingState: BookingMemoryState | null;
  priorTravellerMessages: string[];
  priorConversationMessages: AssistantConversationMessage[];
  llmClient?: AssistantLlmClient | null;
  routerClient?: GenericBookingRouterLlmClient | null;
  bluePassPmsCheckoutClient?: BluePassPmsCheckoutClient;
  /** Threaded into resolveOperatorPayoutAccount for the cancellation-policy disclosure lookup -
   * same injection point bluepass-pms-stripe.ts already uses for that call, so a test can fake the
   * cross-repo HTTP call instead of hitting it for real. */
  fetcher?: typeof fetch;
  /** WhatsApp already has the traveller's number, so a handoff to a person never asks for it. */
  channel?: "whatsapp" | "web";
}

export interface RunGenericBookingTurnResult {
  bookingResult: BookingOrchestratorResult | null;
  assistantContent: string;
  manualInquiry: Awaited<ReturnType<typeof createManualInquiry>> | null;
  contactRequest: {
    conversationId: string;
    fields: ["name", "email", "phone"];
    status: "CONTACT_DETAILS_REQUIRED";
  } | null;
  paymentRequest: {
    conversationId: string;
    productTitle: string | null;
    dateText: string | null;
    guests: number | null;
    checkoutUrl: string | null;
    status: "PAYMENT_PENDING";
  } | null;
}

// Shared core of "run one traveller turn through the generic tenant/PMS booking engine" - extracted
// from src/app/api/widget/messages/route.ts so the WhatsApp channel can drive the exact same PMS
// adapter construction, booking-state persistence, and manual-inquiry side effects as the web
// widget, rather than a second, drifting copy. The web widget route calls this too; its own tests
// are the regression guard that this extraction didn't change its behavior.
export async function runGenericBookingTurn(
  input: RunGenericBookingTurnInput
): Promise<RunGenericBookingTurnResult> {
  const provider = (input.tenant.config?.pmsProvider ?? "MOCK") as PmsProvider;
  let bookingResult: BookingOrchestratorResult | null = null;
  let assistantContent: string;
  let manualInquiry: Awaited<ReturnType<typeof createManualInquiry>> | null = null;
  let paymentRequest: RunGenericBookingTurnResult["paymentRequest"] = null;
  let contactRequest: RunGenericBookingTurnResult["contactRequest"] = null;
  let assistantContentOverride: string | null = null;

  const enabledFeatures = input.tenant.config?.enabledFeatures ?? [];
  // A tenant that sends travellers to the operator's own Rezdy page never charges through BluePass,
  // even if it still carries the Stripe flag.
  const rezdyCheckoutHandoffEnabled = enabledFeatures.includes(REZDY_CHECKOUT_HANDOFF_FEATURE);
  const bluePassStripeCheckoutEnabled =
    enabledFeatures.includes(BLUEPASS_STRIPE_PMS_CHECKOUT_FEATURE) && !rezdyCheckoutHandoffEnabled;

  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(input.tenant.id, provider, process.env);
    const sourcePmsAdapter = getPmsAdapter(provider, tenantPmsEnv, fetch, input.tenant.slug);
    const publicProductCatalog = parsePublicProductCatalog(input.tenant.config?.publicProductCatalog);
    const pmsAdapter =
      publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;
    const knowledgePack = parseKnowledgePack(input.tenant.config?.operatorKnowledgePack);
    const products = await pmsAdapter.listProducts();
    const bookingState = updateBookingMemoryState({
      previousState: input.previousBookingState,
      message: input.content,
      products
    });

    await upsertConversationBookingState({
      tenantId: input.tenant.id,
      conversationId: input.conversationId,
      state: bookingState
    });

    bookingResult = await handleTravellerBookingMessage({
      message: input.content,
      priorTravellerMessages: input.priorTravellerMessages,
      conversationHistory: [...input.priorConversationMessages, { role: "traveller", content: input.content }],
      bookingMemory: bookingState,
      pmsAdapter,
      channel: input.channel ?? "web",
      bookingWriteEnabled: input.tenant.config?.bookingWriteEnabled ?? false,
      allowUnpaidExternalBooking: false,
      bluePassStripeCheckoutEnabled,
      rezdyCheckoutHandoff: rezdyCheckoutHandoffEnabled
        ? { buildUrl: (args) => buildRezdyCheckoutUrl({ tenantSlug: input.tenant.slug, ...args }) }
        : null,
      llmClient: input.llmClient ?? null,
      routerClient: input.routerClient ?? null,
      knowledgePack,
      tenantContext: {
        tenantName: input.tenant.name,
        brandVoice: input.tenant.branding?.brandVoice ?? null,
        pmsProvider: provider,
        responseGuardrails: input.tenant.config?.responseGuardrails ?? [],
        productTitles: products.map((product) => product.title),
        knowledgeSummary: summarizeKnowledgePack(knowledgePack)
      }
    });

    if (bookingResult.action === "MANUAL_INQUIRY_REQUIRED") {
      manualInquiry = await createManualInquiry({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: bookingState,
        travellerMessage: input.content
      });
    }

    const bookingStatePatch = bookingResult.bookingStatePatch;

    if (bookingStatePatch) {
      await upsertConversationBookingState({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: bookingStatePatch
      });

      if (bookingResult.action === "BOOKING_PAYMENT_REQUIRED") {
        let checkoutUrl = bookingResult.paymentHandoffUrl ?? null;

        if (bookingResult.pmsCheckoutHold && bluePassStripeCheckoutEnabled) {
          const checkoutClient = input.bluePassPmsCheckoutClient ?? createBluePassPmsCheckoutClient(process.env);
          try {
            const session = await checkoutClient.createCheckoutSession({
              tenantId: input.tenant.id,
              conversationId: input.conversationId,
              ...bookingResult.pmsCheckoutHold
            });
            checkoutUrl = session.checkoutUrl;
            assistantContentOverride = `Thanks, I've got everything for ${bookingResult.pmsCheckoutHold.productTitle} ${formatDateAndTime(bookingResult.pmsCheckoutHold.dateText)} for ${bookingResult.pmsCheckoutHold.guests} guest${bookingResult.pmsCheckoutHold.guests === 1 ? "" : "s"}. You can pay securely here: ${session.checkoutUrl}. I never see or store your card details.`;
          } catch (error) {
            checkoutUrl = null;
            assistantContentOverride =
              "I've saved this for the operator, but I couldn't set up the secure payment link just now, so someone will follow up with you to finish the booking.";
            console.error("generic_booking_turn.bluepass_pms_checkout_failed", {
              conversationId: input.conversationId,
              error: error instanceof Error ? error.message : String(error)
            });
          }
        }

        paymentRequest = {
          conversationId: input.conversationId,
          productTitle: bookingStatePatch.productTitle,
          dateText: bookingStatePatch.dateText,
          guests: bookingStatePatch.guests,
          checkoutUrl,
          status: "PAYMENT_PENDING"
        };
      }
    }

    const bookingFailureInquiry = buildBookingFailureManualInquiry(bookingResult);
    if (bookingFailureInquiry) {
      manualInquiry = await createManualInquiry({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: bookingFailureInquiry.state,
        travellerMessage: input.content,
        travellerName: bookingFailureInquiry.travellerName,
        travellerEmail: bookingFailureInquiry.travellerEmail,
        travellerPhone: bookingFailureInquiry.travellerPhone
      });
    }

    if (
      (bookingResult.action === "BOOKING_INQUIRY_READY" ||
        bookingResult.action === "BOOKING_WRITE_DISABLED" ||
        bookingResult.action === "BOOKING_CHECKOUT_READY" ||
        bookingResult.action === "BOOKING_PAYMENT_REQUIRED") &&
      bookingResult.inquiryDraft
    ) {
      manualInquiry = await createManualInquiry({
        tenantId: input.tenant.id,
        conversationId: input.conversationId,
        state: {
          productExternalId: bookingResult.inquiryDraft.productExternalId,
          productTitle: bookingResult.inquiryDraft.productTitle,
          dateText: bookingResult.inquiryDraft.dateText,
          guests: bookingResult.inquiryDraft.guests
        },
        travellerMessage: input.content,
        travellerName: bookingResult.inquiryDraft.travellerName,
        travellerEmail: bookingResult.inquiryDraft.travellerEmail,
        travellerPhone: bookingResult.inquiryDraft.travellerPhone
      });
    }

    assistantContent = assistantContentOverride ?? bookingResult.reply;

    // Disclose the real cancellation terms whenever a live payment link is actually going out - not
    // on every BOOKING_PAYMENT_REQUIRED turn, since that action also covers the Stripe-checkout-
    // failed and no-handoff-url-yet replies above, where nothing is actually payable yet. Sourced
    // from the operator's own saved tiers (falls back to the platform default inside
    // formatCancellationPolicySummary when they haven't set one) rather than the disconnected
    // free-text knowledge-pack answer, so what Kai says here always matches what a real cancellation
    // would actually refund.
    // Not for a hand-off to the operator's own Rezdy page: BluePass's refund tiers do not apply to a
    // booking that Rezdy takes and the operator confirms, so quoting them would promise the wrong thing.
    if (bookingResult.action === "BOOKING_PAYMENT_REQUIRED" && paymentRequest?.checkoutUrl && !bookingResult.rezdyHandoff) {
      const payoutAccount = await resolveOperatorPayoutAccount(input.tenant.slug, { fetcher: input.fetcher });
      const cancellationSummary = formatCancellationPolicySummary(payoutAccount?.cancellationPolicyTiers ?? null);
      assistantContent = `${assistantContent}\n\nCancellation policy: ${cancellationSummary}.`;
    }

    // Same guard as the cancellation disclosure just above - only when a live payment link
    // actually went out. The dollar figure is real: 5% of the actual gross fare, the same
    // constant Kai's own ledger uses to book a CONSERVATION_ALLOCATION row once payment clears
    // (see confirm-bluepass-pms-payment.ts). The partner name is deliberately generic - a real
    // Rezdy/Boattime booking has no per-trip named conservation partner recorded anywhere
    // server-side. Only bluepass-redesign's 6 curated demo trips have named partners, and those
    // aren't real bookable inventory; naming one here would misattribute this booking's
    // contribution to a project it was never actually routed to.
    if (bookingResult.action === "BOOKING_PAYMENT_REQUIRED" && paymentRequest?.checkoutUrl && bookingResult.pmsCheckoutHold) {
      const conservationCents = calculateConservationContributionCents(bookingResult.pmsCheckoutHold.grossAmountCents);
      const conservationAmount = formatCurrencyAmount(bookingResult.pmsCheckoutHold.currency, conservationCents);
      assistantContent = `${assistantContent}\n\n${conservationAmount} of this fare funds ocean and reef conservation - built into the price you see, never added to it.`;
    }

    const asksForContactDetails =
      bookingResult.action === "BOOKING_DETAILS_REQUIRED" &&
      /name,\s*email,\s*and\s*phone/i.test(bookingResult.reply);

    if (asksForContactDetails) {
      contactRequest = {
        conversationId: input.conversationId,
        fields: ["name", "email", "phone"],
        status: "CONTACT_DETAILS_REQUIRED"
      };
    }
  } catch (error) {
    assistantContent =
      error instanceof Error
        ? "I can help with this, but " + error.message
        : "I can help with this, but the PMS adapter is not available right now.";
  }

  return {
    bookingResult,
    assistantContent,
    manualInquiry,
    contactRequest,
    paymentRequest
  };
}
