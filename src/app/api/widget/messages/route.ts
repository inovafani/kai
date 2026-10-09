import { alertTeam } from "@/server/conversation/team-alert";
import { isEmergencyMessage } from "@/core/conversation/emergency";
import { NextRequest, NextResponse } from "next/server";
import {
  captureConversationReferralAttribution,
  createAssistantMessage,
  createManualInquiry,
  createTravellerMessage,
  createWidgetConversation,
  findConversationAmongTenants,
  findConversationBookingState,
  findTenantConversation,
  listRecentConversationMessages,
  listRecentTravellerMessageContents
} from "@/server/conversation/conversation-repository";
import { findTenantById } from "@/server/tenant/tenant-repository";
import { runGenericBookingTurn } from "@/server/booking/generic-booking-turn";
import { createAssistantLlmClient } from "@/server/llm/assistant-llm-client";
import { createGenericBookingRouterClient } from "@/server/llm/generic-booking-router-client";
import { createBluePassRouterClient } from "@/server/llm/bluepass-router-client";
import { handleBluePassMarketplaceMessage,
  readBluePassTeamSignals } from "@/server/bluepass/bluepass-message-flow";
import { composeBluePassMarketplaceAssistantReply } from "@/server/bluepass/bluepass-marketplace-reply-composer";
import { shouldPolishBluePassMarketplaceReply } from "@/server/bluepass/bluepass-marketplace-reply-gate";
import type { BluePassCatalogSnapshotItem } from "@/core/bluepass/catalog";
import { WHATSAPP_GENERIC_ELIGIBLE_FEATURE } from "@/core/tenant/feature-flags";
import { resolveTenantBusinessPack } from "@/server/business-pack/resolve-tenant-business-pack";
import { getWidgetRequestOrigin } from "@/server/widget/request-origin";
import { resolveWidgetRequest } from "@/server/widget/resolve-widget-request";
import {
  buildAuOperatorRecommendationReply,
  buildTenantProductsHandoffCards,
  listAuRecommendationCandidates,
  resolveAuOperatorRecommendationSelection,
  type AuRecommendationCandidate
} from "@/server/whatsapp/au-operator-recommendation";
import type { BookingProductCard } from "@/core/booking/booking-orchestrator";
import { shouldUseGenericBookingFlow } from "./business-pack-gate";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    key?: string;
    conversationId?: string;
    content?: string;
    referral?: {
      referralPartnerId?: string | null;
      referralLinkId?: string | null;
      referralCode?: string | null;
      referralRole?: string | null;
    } | null;
    bluepassCatalog?: BluePassCatalogSnapshotItem[];
  } | null;

  if (!body?.key) {
    return NextResponse.json(
      {
        error: {
          code: "WIDGET_KEY_REQUIRED",
          message: "Missing widget key."
        }
      },
      { status: 400 }
    );
  }

  if (!body.conversationId) {
    return NextResponse.json(
      {
        error: {
          code: "CONVERSATION_REQUIRED",
          message: "Missing conversation id."
        }
      },
      { status: 400 }
    );
  }

  const content = body.content?.trim();
  if (!content) {
    return NextResponse.json(
      {
        error: {
          code: "MESSAGE_CONTENT_REQUIRED",
          message: "Message content is required."
        }
      },
      { status: 400 }
    );
  }

  let resolved = await resolveWidgetRequest({
    widgetKey: body.key,
    origin: getWidgetRequestOrigin(request)
  });

  if (!resolved.ok) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.status });
  }

  let conversation = await findTenantConversation({
    tenantId: resolved.tenant.id,
    conversationId: body.conversationId
  });

  // Not found under the tenant the static widget key resolves to - if that tenant is itself
  // AU-recommendation-eligible, this may be a conversation an earlier turn already handed off to a
  // different real AU tenant (see the cross-tenant handoff below). The client keeps sending the same
  // static key on every turn (it has no way to know a handoff happened), so this fallback is what
  // lets turn 2+ of a handed-off conversation keep working instead of 404ing the moment it moves.
  if (!conversation && resolved.tenant.config?.enabledFeatures?.includes(WHATSAPP_GENERIC_ELIGIBLE_FEATURE)) {
    const candidates = await listAuRecommendationCandidates();
    const realCandidateTenantIds = candidates.filter((candidate) => !candidate.isPlaceholder).map((candidate) => candidate.tenantId);
    const handedOffConversation = await findConversationAmongTenants({
      conversationId: body.conversationId,
      tenantIds: realCandidateTenantIds
    });

    if (handedOffConversation) {
      const handedOffTenant = await findTenantById(handedOffConversation.tenantId);
      if (handedOffTenant) {
        resolved = { ok: true as const, tenant: handedOffTenant };
        conversation = handedOffConversation;
      }
    }
  }

  if (!conversation) {
    return NextResponse.json(
      {
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: "No conversation exists for this tenant."
        }
      },
      { status: 404 }
    );
  }

  await captureConversationReferralAttribution({ conversation, referral: body.referral });

  const businessPack = resolveTenantBusinessPack(resolved.tenant);

  if (!shouldUseGenericBookingFlow(businessPack)) {
    const priorTravellerMessages = await listRecentTravellerMessageContents({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id
    });
    const message = await createTravellerMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content
    });
    const priorConversationMessages = await listRecentConversationMessages({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id
    });
    const bluepassResult = await handleBluePassMarketplaceMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content,
      priorTravellerMessages,
      referral: body.referral ?? null,
      catalog: body.bluepassCatalog,
      routerClient: createBluePassRouterClient(process.env),
      lastAssistantMessage: priorConversationMessages.filter((item) => item.role === "assistant").at(-1)?.content ?? null,
      priorAssistantMessages: priorConversationMessages
        .filter((item) => item.role === "assistant")
        .map((item) => item.content)
    });
    const shouldPolish = shouldPolishBluePassMarketplaceReply({
      persona: bluepassResult.persona,
      replyMode: bluepassResult.replyMode
    });
    console.log(shouldPolish ? "bluepass_llm.polish_call_made" : "bluepass_llm.polish_call_skipped", {
      channel: "widget",
      persona: bluepassResult.persona,
      replyMode: bluepassResult.replyMode
    });

    const composedBluePassReply = await composeBluePassMarketplaceAssistantReply({
      deterministicReply: bluepassResult.assistantContent,
      latestMessage: content,
      conversationHistory: priorConversationMessages,
      llmClient: shouldPolish ? createAssistantLlmClient(process.env) : null,
      marketplaceResult: bluepassResult,
      catalogInput: body.bluepassCatalog
    });

    const assistantMessage = await createAssistantMessage({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      content: composedBluePassReply.reply
    });

    // Nobody can reply into the web widget, so a person reaches them on WhatsApp: the team hears
    // about the request now, and again with the number once the visitor leaves it.
    const teamSignals = readBluePassTeamSignals(bluepassResult);
    const bluePassAlertReason = teamSignals.emergency
      ? "EMERGENCY"
      : teamSignals.humanHandoff === "CALLBACK_NUMBER"
        ? "CALLBACK_NUMBER"
        : teamSignals.humanHandoff === "REQUESTED"
          ? "PERSON_REQUESTED"
          : null;
    if (bluePassAlertReason) {
      await alertTeam({
        tenantId: resolved.tenant.id,
        conversationId: conversation.id,
        reason: bluePassAlertReason,
        channel: "web",
        callbackNumber: teamSignals.callbackNumber ?? null,
        latestMessage: content
      });
    }

    return NextResponse.json({
      message: {
        id: message.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content
      },
      assistantMessage: {
        id: assistantMessage.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: assistantMessage.conversationId,
        role: assistantMessage.role,
        content: assistantMessage.content
      },
      businessPack: {
        kind: businessPack.kind,
        paymentPolicy: businessPack.paymentPolicy,
        truthPolicy: businessPack.truthPolicy
      },
      bluepassMatches: bluepassResult.bluepassMatches,
      bluepassInquiry: bluepassResult.bluepassInquiry
        ? {
            id: bluepassResult.bluepassInquiry.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: bluepassResult.bluepassInquiry.conversationId,
            status: bluepassResult.bluepassInquiry.status,
            destination: bluepassResult.bluepassInquiry.destination,
            tripType: bluepassResult.bluepassInquiry.tripType,
            dateWindow: bluepassResult.bluepassInquiry.dateWindow,
            guests: bluepassResult.bluepassInquiry.guests,
            budget: bluepassResult.bluepassInquiry.budget,
            selectedYachtSlug: bluepassResult.bluepassInquiry.selectedYachtSlug,
            selectedYachtName: bluepassResult.bluepassInquiry.selectedYachtName,
            travellerName: bluepassResult.bluepassInquiry.travellerName,
            travellerEmail: bluepassResult.bluepassInquiry.travellerEmail,
            travellerPhone: bluepassResult.bluepassInquiry.travellerPhone,
            referralCode: bluepassResult.bluepassInquiry.referralCode
          }
        : null,
      bluepassLedger: bluepassResult.bluepassLedger.map((entry) => ({
        id: entry.id,
        tenantSlug: resolved.tenant.slug,
        conversationId: entry.conversationId,
        kind: entry.kind,
        amountCents: entry.amountCents,
        currency: entry.currency,
        status: entry.status,
        referralCode: entry.referralCode
      })),
      bluepassDispatch: bluepassResult.bluepassDispatch
        ? {
            id: bluepassResult.bluepassDispatch.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: bluepassResult.bluepassDispatch.conversationId,
            status: bluepassResult.bluepassDispatch.status,
            operatorId: bluepassResult.bluepassDispatch.operatorId,
            operatorName: bluepassResult.bluepassDispatch.operatorName,
            operatorPhone: bluepassResult.bluepassDispatch.operatorPhone
          }
        : null,
      manualInquiry: null,
      paymentRequest: null,
      contactRequest: bluepassResult.contactRequest
        ? {
            conversationId: conversation.id,
            fields: bluepassResult.contactRequest.fields,
            status: bluepassResult.contactRequest.status
          }
        : null
    });
  }

  const previousBookingState = await findConversationBookingState({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });
  const priorTravellerMessages = await listRecentTravellerMessageContents({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });
  const priorConversationMessages = await listRecentConversationMessages({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id
  });

  // AU recommend-then-pick moment, mirrored from the WhatsApp side (au-operator-recommendation.ts):
  // scoped to widget tenants themselves flagged eligible for the shared recommendation (same flag
  // WhatsApp's explicit-match tier uses), so no other generic-flow tenant is affected, and the
  // candidate list (real + placeholder operators) is identical across both channels.
  const tenantConfigForAuRecommendation = resolved.tenant.config;
  if (tenantConfigForAuRecommendation?.enabledFeatures?.includes(WHATSAPP_GENERIC_ELIGIBLE_FEATURE)) {
    const candidates = await listAuRecommendationCandidates();

    // Shared by the explicit-pick branch below and the single-operator auto-skip (item 13): a lone
    // candidate goes straight to the same handoff a traveller would reach by picking option 1.
    //
    // `handoff` is set only when the pick moved this conversation to a different tenant than the one
    // this request started on - the caller must write the assistant reply under that new
    // tenant/conversation (not the original one) so its conversationId reaches the client and future
    // turns can find it again via the CONVERSATION_NOT_FOUND fallback above.
    const buildPickedReply = async (
      picked: AuRecommendationCandidate
    ): Promise<{
      reply: string;
      productCards: BookingProductCard[];
      handoff?: { tenantId: string; tenantSlug: string; conversationId: string };
    }> => {
      if (picked.isPlaceholder) {
        return {
          reply: `Sorry, ${picked.name} is not available right now - want to try one of the other options instead?`,
          productCards: []
        };
      }
      if (picked.tenantId === resolved.tenant.id && tenantConfigForAuRecommendation) {
        // Shows this tenant's actual live product list (with item 9's cards) right away, instead of
        // a vague "what would you like to explore?" the traveller has no way to answer without
        // already knowing the catalog.
        return buildTenantProductsHandoffCards(
          {
            id: resolved.tenant.id,
            slug: resolved.tenant.slug,
            name: resolved.tenant.name,
            config: tenantConfigForAuRecommendation
          },
          process.env,
          content
        );
      }

      // A genuinely different operator than the one this widget conversation started on - mirrors
      // WhatsApp's own cross-tenant handoff (resolveAuOperatorRecommendationHandoff): start a fresh
      // conversation scoped to the picked tenant and reply from there, rather than the apology this
      // used to give ("no cross-tenant hand-off on the website today"). Keeps the same travellerId
      // (if logged in) so a returning traveller's handed-off conversation is still resumable.
      const pickedTenant = await findTenantById(picked.tenantId);
      if (!pickedTenant || !pickedTenant.config) {
        return {
          reply: `I can only help with ${resolved.tenant.name} directly from this site right now - want to continue with them?`,
          productCards: []
        };
      }

      const handoffConversation = await createWidgetConversation({
        tenantId: pickedTenant.id,
        travellerId: conversation.travellerId ?? undefined
      });
      const { reply, productCards } = await buildTenantProductsHandoffCards(
        { id: pickedTenant.id, slug: pickedTenant.slug, name: pickedTenant.name, config: pickedTenant.config },
        process.env,
        content
      );

      return {
        reply,
        productCards,
        handoff: { tenantId: pickedTenant.id, tenantSlug: pickedTenant.slug, conversationId: handoffConversation.id }
      };
    };

    if (candidates.length > 0) {
      const lastAssistantMessage =
        [...priorConversationMessages].reverse().find((entry) => entry.role === "assistant")?.content ?? null;
      const picked = resolveAuOperatorRecommendationSelection({
        lastAssistantMessage,
        message: content,
        candidates
      });

      if (picked) {
        const message = await createTravellerMessage({
          tenantId: resolved.tenant.id,
          conversationId: conversation.id,
          content
        });
        const { reply, productCards, handoff } = await buildPickedReply(picked);
        const assistantMessage = handoff
          ? await createAssistantMessage({
              tenantId: handoff.tenantId,
              conversationId: handoff.conversationId,
              content: reply
            })
          : await createAssistantMessage({
              tenantId: resolved.tenant.id,
              conversationId: conversation.id,
              content: reply
            });

        return NextResponse.json({
          message: {
            id: message.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: message.conversationId,
            role: message.role,
            content: message.content
          },
          assistantMessage: {
            id: assistantMessage.id,
            tenantSlug: handoff?.tenantSlug ?? resolved.tenant.slug,
            conversationId: assistantMessage.conversationId,
            role: assistantMessage.role,
            content: assistantMessage.content
          },
          manualInquiry: null,
          paymentRequest: null,
          contactRequest: null,
          productCards
        });
      }

      if (priorConversationMessages.length === 0) {
        const message = await createTravellerMessage({
          tenantId: resolved.tenant.id,
          conversationId: conversation.id,
          content
        });
        // kai-conversation-flow-notes.md item 13: a single operator never needs the "which one?"
        // turn - skip straight to the same handoff a traveller would reach by picking option 1.
        const { reply: singleReply, productCards: singleProductCards } =
          candidates.length === 1
            ? await buildPickedReply(candidates[0])
            : { reply: buildAuOperatorRecommendationReply(candidates), productCards: [] as BookingProductCard[] };
        const assistantMessage = await createAssistantMessage({
          tenantId: resolved.tenant.id,
          conversationId: conversation.id,
          content: singleReply
        });

        return NextResponse.json({
          message: {
            id: message.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: message.conversationId,
            role: message.role,
            content: message.content
          },
          assistantMessage: {
            id: assistantMessage.id,
            tenantSlug: resolved.tenant.slug,
            conversationId: assistantMessage.conversationId,
            role: assistantMessage.role,
            content: assistantMessage.content
          },
          manualInquiry: null,
          paymentRequest: null,
          contactRequest: null,
          productCards: singleProductCards
        });
      }
    }
  }

  const message = await createTravellerMessage({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id,
    content
  });

  const llmClient = createAssistantLlmClient(process.env);
  const routerClient = createGenericBookingRouterClient(process.env);

  const { assistantContent, manualInquiry, paymentRequest, contactRequest, bookingResult } = await runGenericBookingTurn({
    tenant: resolved.tenant,
    conversationId: conversation.id,
    content,
    previousBookingState,
    priorTravellerMessages,
    priorConversationMessages,
    llmClient,
    routerClient
  });

  const assistantMessage = await createAssistantMessage({
    tenantId: resolved.tenant.id,
    conversationId: conversation.id,
    content: assistantContent
  });

  const genericAlertReason = isEmergencyMessage(content)
    ? "EMERGENCY"
    : bookingResult?.callbackNumber
      ? "CALLBACK_NUMBER"
      : bookingResult?.action === "HUMAN_HANDOFF"
        ? "PERSON_REQUESTED"
        : null;
  if (genericAlertReason) {
    await alertTeam({
      tenantId: resolved.tenant.id,
      conversationId: conversation.id,
      reason: genericAlertReason,
      channel: "web",
      callbackNumber: bookingResult?.callbackNumber ?? null,
      latestMessage: content
    });
  }

  return NextResponse.json({
    message: {
      id: message.id,
      tenantSlug: resolved.tenant.slug,
      conversationId: message.conversationId,
      role: message.role,
      content: message.content
    },
    assistantMessage: {
      id: assistantMessage.id,
      tenantSlug: resolved.tenant.slug,
      conversationId: assistantMessage.conversationId,
      role: assistantMessage.role,
      content: assistantMessage.content
    },
    manualInquiry: manualInquiry
      ? {
          id: manualInquiry.id,
          tenantSlug: resolved.tenant.slug,
          conversationId: manualInquiry.conversationId,
          status: manualInquiry.status,
          productExternalId: manualInquiry.productExternalId,
          productTitle: manualInquiry.productTitle,
          dateText: manualInquiry.dateText,
          guests: manualInquiry.guests,
          travellerName: manualInquiry.travellerName,
          travellerEmail: manualInquiry.travellerEmail,
          travellerPhone: manualInquiry.travellerPhone
        }
      : null,
    paymentRequest,
    contactRequest,
    productCards: bookingResult?.productCards ?? null,
    dateOptions: bookingResult?.dateOptions ?? null,
    timeOptions: bookingResult?.timeOptions ?? null,
    ticketOptions: bookingResult?.ticketOptions ?? null,
    extraOptions: bookingResult?.extraOptions ?? null
  });
}
