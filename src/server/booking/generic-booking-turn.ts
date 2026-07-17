import type { BookingMemoryState } from "@/core/booking/booking-memory";
import { updateBookingMemoryState } from "@/core/booking/booking-memory";
import { handleTravellerBookingMessage, type BookingOrchestratorResult } from "@/core/booking/booking-orchestrator";
import type { AssistantConversationMessage, AssistantLlmClient } from "@/core/llm/assistant-reply-composer";
import type { GenericBookingRouterLlmClient } from "@/core/llm/generic-booking-router";
import { MappedPmsAdapter } from "@/core/pms/mapped-pms-adapter";
import { parsePublicProductCatalog } from "@/core/pms/public-product-catalog";
import type { PmsProvider } from "@/core/tenant/types";
import { buildBookingFailureManualInquiry } from "@/server/conversation/manual-inquiry-fallback";
import { createManualInquiry, upsertConversationBookingState } from "@/server/conversation/conversation-repository";
import { getPmsAdapter } from "@/server/pms/pms-adapter-registry";
import { resolveTenantPmsEnv } from "@/server/pms/tenant-pms-credentials";

export interface GenericBookingTurnTenant {
  id: string;
  slug: string;
  name: string;
  config: {
    pmsProvider: PmsProvider;
    publicProductCatalog: unknown;
    bookingWriteEnabled?: boolean | null;
    responseGuardrails?: string[] | null;
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

  try {
    const tenantPmsEnv = await resolveTenantPmsEnv(input.tenant.id, provider, process.env);
    const sourcePmsAdapter = getPmsAdapter(provider, tenantPmsEnv, fetch, input.tenant.slug);
    const publicProductCatalog = parsePublicProductCatalog(input.tenant.config?.publicProductCatalog);
    const pmsAdapter =
      publicProductCatalog.length > 0 ? new MappedPmsAdapter(sourcePmsAdapter, publicProductCatalog) : sourcePmsAdapter;
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
      bookingWriteEnabled: input.tenant.config?.bookingWriteEnabled ?? false,
      allowUnpaidExternalBooking: false,
      llmClient: input.llmClient ?? null,
      routerClient: input.routerClient ?? null,
      tenantContext: {
        tenantName: input.tenant.name,
        brandVoice: input.tenant.branding?.brandVoice ?? null,
        pmsProvider: provider,
        responseGuardrails: input.tenant.config?.responseGuardrails ?? [],
        productTitles: products.map((product) => product.title)
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
        paymentRequest = {
          conversationId: input.conversationId,
          productTitle: bookingStatePatch.productTitle,
          dateText: bookingStatePatch.dateText,
          guests: bookingStatePatch.guests,
          checkoutUrl: null,
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

    assistantContent = bookingResult.reply;
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
