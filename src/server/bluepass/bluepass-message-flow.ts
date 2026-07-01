import {
  resolveBluePassCatalog,
  searchBluePassYachts,
  type BluePassCatalogSnapshotItem,
  type BluePassYachtCard,
  type BluePassYachtCatalogItem
} from "@/core/bluepass/catalog";
import {
  extractBluePassInquiryIntent,
  getMissingBluePassInquiryFields,
  mergeBluePassInquiryIntent
} from "@/core/bluepass/intent";
import {
  buildBluePassInquiryConfirmationReply,
  buildBluePassInquiryReadyReply,
  buildBluePassInquiryStatusReply,
  buildBluePassMissingFieldsReply,
  buildBluePassSeasonReply,
  buildBluePassValueReply,
  buildBluePassYachtComparisonReply,
  buildBluePassYachtOverviewReply
} from "@/core/bluepass/reply";
import type { BluePassReferralInput } from "./bluepass-inquiry-repository";
import {
  createOrReuseBluePassInquiry,
  dispatchBluePassOperatorWhatsApp,
  getActiveBluePassInquiryStatus,
  syncBluePassReferralLedgerEstimate
} from "./bluepass-inquiry-repository";

export type BluePassMarketplaceMessageInput = {
  tenantId: string;
  conversationId: string;
  content: string;
  priorTravellerMessages: string[];
  referral?: BluePassReferralInput | null;
  catalog?: BluePassCatalogSnapshotItem[];
};

export async function handleBluePassMarketplaceMessage(input: BluePassMarketplaceMessageInput) {
  const catalog = resolveBluePassCatalog(input.catalog);
  const historyIntent = extractBluePassInquiryIntent(input.priorTravellerMessages);
  const messageIntent = extractBluePassInquiryIntent([input.content]);
  const latestMentionedYachts = resolveMentionedYachts(input.content, catalog);
  const selectedYacht = resolveSelectedYacht([input.content, ...input.priorTravellerMessages].join("\n"), catalog);
  const intent = mergeBluePassInquiryIntent(historyIntent, {
    ...messageIntent,
    destination: messageIntent.destination ?? (selectedYacht ? selectedYacht.region : undefined),
    selectedYachtSlug: selectedYacht?.slug ?? messageIntent.selectedYachtSlug
  });
  const bluepassMatches = searchBluePassYachts(intent, catalog);

  if (isBluePassInquiryStatusQuestion(input.content)) {
    const status = await getActiveBluePassInquiryStatus({
      tenantId: input.tenantId,
      conversationId: input.conversationId
    });

    if (!status) {
      return buildConciergeResponse(
        "I do not see an active BluePass inquiry in this chat yet. I can help shortlist options first, then prepare an operator inquiry once you share the trip details."
      );
    }

    return {
      assistantContent: buildBluePassInquiryStatusReply({
        inquiryId: status.inquiry.id,
        selectedYachtName: status.inquiry.selectedYachtName,
        status: status.inquiry.status
      }),
      bluepassMatches: [],
      bluepassInquiry: status.inquiry,
      bluepassLedger: status.ledger,
      bluepassDispatch: null,
      paymentRequest: null
    };
  }

  if (isBluePassValueQuestion(input.content)) {
    return buildConciergeResponse(buildBluePassValueReply());
  }

  const seasonDestination = resolveSeasonDestination(input.content);
  if (seasonDestination) {
    return buildConciergeResponse(buildBluePassSeasonReply(seasonDestination));
  }

  if (isBluePassYachtComparisonRequest(input.content) && latestMentionedYachts.length >= 2) {
    return buildConciergeResponse(buildBluePassYachtComparisonReply(latestMentionedYachts));
  }

  if (selectedYacht && isBluePassYachtInformationRequest(input.content)) {
    const overviewMatch = bluepassMatches.find((match) => match.slug === selectedYacht.slug) ?? bluepassMatches[0];

    return buildConciergeResponse(buildBluePassYachtOverviewReply(overviewMatch), [overviewMatch]);
  }

  const missingFields = getMissingBluePassInquiryFields(intent);

  if (missingFields.length > 0) {
    return {
      assistantContent: buildBluePassMissingFieldsReply({
        destination: intent.destination,
        selectedYacht,
        missingFields
      }),
      bluepassMatches: [],
      bluepassInquiry: null,
      bluepassLedger: [],
      bluepassDispatch: null,
      paymentRequest: null,
      contactRequest: shouldRequestContactForm(missingFields)
        ? {
            status: "CONTACT_DETAILS_REQUIRED" as const,
            fields: ["name", "email", "phone"] as const
          }
        : null
    };
  }

  if (!isBluePassInquirySubmissionRequest(input.content)) {
    return {
      assistantContent: buildBluePassInquiryConfirmationReply({
        selectedYachtName: selectedYacht?.name,
        destination: intent.destination,
        dateWindow: intent.dateWindow,
        guests: intent.guests,
        travellerName: intent.travellerName,
        travellerEmail: intent.travellerEmail,
        travellerPhone: intent.travellerPhone
      }),
      bluepassMatches: [],
      bluepassInquiry: null,
      bluepassLedger: [],
      bluepassDispatch: null,
      paymentRequest: null
    };
  }

  const created = await createOrReuseBluePassInquiry({
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    travellerMessage: input.content,
    intent,
    selectedYacht: selectedYacht ?? bluepassMatches[0] ?? null,
    referral: input.referral ?? null
  });
  const bluepassLedger = await syncBluePassReferralLedgerEstimate(created.inquiry);
  const bluepassDispatch = created.inquiry.operatorPhone
    ? await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id })
    : null;
  const status = await getActiveBluePassInquiryStatus({
    tenantId: input.tenantId,
    conversationId: input.conversationId
  });
  const bluepassInquiry = status?.inquiry ?? created.inquiry;

  return {
    assistantContent: buildBluePassInquiryReadyReply({
      inquiryId: bluepassInquiry.id,
      selectedYachtName: bluepassInquiry.selectedYachtName,
      dispatchQueued: bluepassDispatch?.status === "QUEUED" || bluepassDispatch?.status === "SENT",
      dispatchFailed: bluepassDispatch?.status === "FAILED"
    }),
    bluepassMatches: [],
    bluepassInquiry,
    bluepassLedger,
    bluepassDispatch,
    paymentRequest: null
  };
}

function resolveSelectedYacht(content: string, catalog: BluePassYachtCatalogItem[]) {
  return resolveMentionedYachts(content, catalog)[0] ?? null;
}

function resolveMentionedYachts(content: string, catalog: BluePassYachtCatalogItem[]) {
  const lowerContent = content.toLowerCase();

  return catalog.filter(
    (yacht) => lowerContent.includes(yacht.name.toLowerCase()) || lowerContent.includes(yacht.slug)
  );
}

function buildConciergeResponse(assistantContent: string, bluepassMatches: BluePassYachtCard[] = []) {
  return {
    assistantContent,
    bluepassMatches,
    bluepassInquiry: null,
    bluepassLedger: [],
    bluepassDispatch: null,
    paymentRequest: null,
    contactRequest: null
  };
}

function shouldRequestContactForm(missingFields: string[]) {
  const contactFields = new Set(["travellerName", "travellerEmail", "travellerPhone"]);

  return missingFields.length > 0 && missingFields.every((field) => contactFields.has(field));
}

function isBluePassValueQuestion(content: string) {
  const normalized = content.toLowerCase();

  return (
    /\b(?:why|how)\s+(?:should\s+i\s+)?(?:use|book\s+with|choose)\s+bluepass\b/.test(normalized) ||
    /\b(?:why|how)\s+bluepass\b/.test(normalized) ||
    /\b(?:booking direct|book direct|direct booking|same price|conservation|give back|5%)\b/.test(normalized)
  );
}

function isBluePassInquiryStatusQuestion(content: string) {
  return /\b(?:status|update|operator replied|operator response|confirmed yet|any news|what happened)\b/i.test(content);
}

function resolveSeasonDestination(content: string) {
  const normalized = content.toLowerCase();
  const asksTiming =
    /\b(?:best|good|ideal|recommended)\s+(?:time|season|month)\b/.test(normalized) ||
    /\bwhen\s+(?:is\s+)?(?:the\s+)?best\b/.test(normalized);

  if (!asksTiming) return null;
  if (/\b(?:raja\s+ampat|misool|sorong|wayag)\b/.test(normalized)) return "Raja Ampat";
  if (/\b(?:komodo|labuan\s+bajo|flores)\b/.test(normalized)) return "Komodo";

  return null;
}

function isBluePassYachtComparisonRequest(content: string) {
  return /\b(?:compare|versus|vs\.?|difference|which is better)\b/i.test(content);
}

function isBluePassYachtInformationRequest(content: string) {
  const normalized = content.toLowerCase();
  const asksForInformation =
    /\b(?:tell me about|what is|what's|explain|describe|info about|learn about|details about)\b/.test(normalized) ||
    /\?$/.test(normalized.trim());
  const asksForCommercialAction =
    /\b(?:send|create|prepare|make|start|submit)\s+(?:an?\s+)?inquir(?:y|ies)\b/.test(normalized) ||
    /\b(?:check|confirm)\s+(?:live\s+)?availability\b/.test(normalized) ||
    /\b(?:book|booking|reserve|hold|quote|operator|whatsapp|proceed)\b/.test(normalized);

  return asksForInformation && !asksForCommercialAction;
}

function isBluePassInquirySubmissionRequest(content: string) {
  const normalized = content.toLowerCase();
  const affirmativeOnly = /^(?:yes|yep|yeah|ok|okay|sure|please|yes please|go ahead|proceed|confirm|confirmed)[.! ]*$/;

  return (
    affirmativeOnly.test(normalized.trim()) ||
    /\b(?:send|submit|create|prepare)\s+(?:this\s+|the\s+|an?\s+)?(?:operator\s+)?inquir(?:y|ies)\b/.test(
      normalized
    ) ||
    /\b(?:send|submit)\s+(?:this|it|that)\s+(?:to\s+the\s+)?operator\b/.test(normalized) ||
    /\b(?:yes|yep|yeah|ok|okay|sure|confirm|confirmed|go ahead|proceed)\b.*\b(?:send|submit|inquiry|operator|it|this)\b/.test(
      normalized
    )
  );
}
