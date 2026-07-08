import {
  findBluePassAlternativeYachts,
  resolveBluePassCatalog,
  searchBluePassYachts,
  type BluePassCatalogSnapshotItem,
  type BluePassYachtCard,
  type BluePassYachtCatalogItem
} from "@/core/bluepass/catalog";
import {
  extractBluePassInquiryIntent,
  getMissingBluePassInquiryFields,
  mergeBluePassInquiryIntent,
  type BluePassRequiredInquiryField
} from "@/core/bluepass/intent";
import {
  buildBluePassInquiryConfirmationReply,
  buildBluePassInquiryReadyReply,
  buildBluePassInquiryStatusReply,
  buildBluePassMissingFieldsReply,
  buildBluePassRecommendationReply,
  buildBluePassSeasonReply,
  buildBluePassSmallTalkReply,
  buildBluePassValueReply,
  buildBluePassYachtComparisonReply,
  buildBluePassYachtOverviewReply
} from "@/core/bluepass/reply";
import type { BluePassReferralInput } from "./bluepass-inquiry-repository";
import {
  createOrReuseBluePassInquiry,
  dispatchBluePassOperatorWhatsApp,
  getActiveBluePassInquiryStatus,
  getLatestBluePassInquiryStatus,
  syncBluePassReferralLedgerEstimate
} from "./bluepass-inquiry-repository";

export type BluePassMarketplaceMessageInput = {
  tenantId: string;
  conversationId: string;
  content: string;
  priorTravellerMessages: string[];
  referral?: BluePassReferralInput | null;
  catalog?: BluePassCatalogSnapshotItem[];
  travellerPhone?: string | null;
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
    selectedYachtSlug: selectedYacht?.slug ?? messageIntent.selectedYachtSlug,
    travellerPhone: messageIntent.travellerPhone ?? input.travellerPhone ?? undefined
  });
  const bluepassMatches = searchBluePassYachts(intent, catalog);

  const declinedAlternative = isBluePassInquirySubmissionRequest(input.content)
    ? await resolveDeclinedInquiryAlternative({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        catalog
      })
    : null;

  if (declinedAlternative) {
    const created = await createOrReuseBluePassInquiry({
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      travellerMessage: input.content,
      intent: {
        destination: declinedAlternative.previous.destination ?? declinedAlternative.yacht.region,
        tripType: declinedAlternative.previous.tripType ?? undefined,
        dateWindow: declinedAlternative.previous.dateWindow ?? undefined,
        guests: declinedAlternative.previous.guests ?? undefined,
        budget: declinedAlternative.previous.budget ?? undefined,
        interests: Array.isArray(declinedAlternative.previous.interests)
          ? declinedAlternative.previous.interests.filter((interest): interest is string => typeof interest === "string")
          : undefined,
        travellerName: declinedAlternative.previous.travellerName ?? undefined,
        travellerEmail: declinedAlternative.previous.travellerEmail ?? undefined,
        travellerPhone: declinedAlternative.previous.travellerPhone ?? undefined,
        selectedYachtSlug: declinedAlternative.yacht.slug
      },
      selectedYacht: declinedAlternative.yacht,
      referral: {
        referralPartnerId: declinedAlternative.previous.referralPartnerId,
        referralLinkId: declinedAlternative.previous.referralLinkId,
        referralCode: declinedAlternative.previous.referralCode,
        referralRole: declinedAlternative.previous.referralRole
      },
      alternativeOf: {
        previousInquiryId: declinedAlternative.previous.id,
        previousYachtSlug: declinedAlternative.previous.selectedYachtSlug,
        alternativeYachtSlug: declinedAlternative.yacht.slug,
        reason: "operator_declined"
      }
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

  if (isBluePassSmallTalkRequest(input.content)) {
    return buildConciergeResponse(buildBluePassSmallTalkReply());
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

  if (isBluePassRecommendationRequest(input.content) && !isBluePassInquirySubmissionRequest(input.content)) {
    const recommendationMatches = searchBluePassYachts(
      {
        destination: intent.destination,
        guests: intent.guests,
        interests: intent.interests,
        selectedYachtSlug: selectedYacht?.slug
      },
      catalog
    );

    return buildConciergeResponse(
      buildBluePassRecommendationReply({
        destination: intent.destination,
        matches: recommendationMatches
      }),
      recommendationMatches
    );
  }

  const missingFields = getMissingBluePassInquiryFields(intent);

  if (missingFields.length > 0) {
    const promptMissingFields = getPromptMissingFields(missingFields);

    return {
      assistantContent: buildBluePassMissingFieldsReply({
        destination: intent.destination,
        selectedYacht,
        missingFields: promptMissingFields
      }),
      bluepassMatches: [],
      bluepassInquiry: null,
      bluepassLedger: [],
      bluepassDispatch: null,
      paymentRequest: null,
      contactRequest: shouldRequestContactForm(missingFields)
        ? {
            status: "CONTACT_DETAILS_REQUIRED" as const,
            fields: getContactRequestFields(missingFields)
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
  const normalizedContent = normalizeYachtText(content);

  return catalog
    .map((yacht) => ({
      yacht,
      mentionScore: scoreYachtMention(normalizedContent, yacht)
    }))
    .filter((match) => match.mentionScore > 0)
    .sort((a, b) => b.mentionScore - a.mentionScore || b.yacht.name.length - a.yacht.name.length)
    .map((match) => match.yacht);
}

function scoreYachtMention(normalizedContent: string, yacht: BluePassYachtCatalogItem) {
  if (normalizedContent.includes(normalizeYachtText(yacht.name))) {
    return 100;
  }

  if (normalizedContent.includes(normalizeYachtText(yacht.slug))) {
    return 95;
  }

  const nameWords = normalizeYachtText(yacht.name).split(" ").filter(Boolean);
  if (nameWords.length === 0) {
    return 0;
  }

  if (nameWords.length === 1) {
    return 0;
  }

  const contentWords = normalizedContent.split(" ").filter(Boolean);
  const matchedWords = nameWords.filter((nameWord) =>
    contentWords.some((contentWord) => areNearYachtWords(contentWord, nameWord))
  );

  return matchedWords.length === nameWords.length ? 60 + nameWords.length * 5 : 0;
}

function areNearYachtWords(input: string, expected: string) {
  if (input === expected) {
    return true;
  }

  if (expected.length < 5 || input.length < 5) {
    return false;
  }

  return levenshteinDistance(input, expected) <= 2;
}

function normalizeYachtText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
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

async function resolveDeclinedInquiryAlternative(input: {
  tenantId: string;
  conversationId: string;
  catalog: BluePassYachtCatalogItem[];
}) {
  const latest = await getLatestBluePassInquiryStatus({
    tenantId: input.tenantId,
    conversationId: input.conversationId
  });

  if (!latest || latest.inquiry.status !== "DECLINED") return null;

  const alternatives = findBluePassAlternativeYachts(
    {
      destination: latest.inquiry.destination ?? undefined,
      guests: latest.inquiry.guests ?? undefined,
      declinedYachtSlug: latest.inquiry.selectedYachtSlug
    },
    input.catalog
  );
  const yacht = alternatives[0] ?? null;

  return yacht
    ? {
        previous: latest.inquiry,
        yacht
      }
    : null;
}

function shouldRequestContactForm(missingFields: BluePassRequiredInquiryField[]) {
  const contactFields = new Set<BluePassRequiredInquiryField>([
    "travellerName",
    "travellerEmail",
    "travellerPhone"
  ]);

  return missingFields.length > 0 && missingFields.every((field) => contactFields.has(field));
}

function getContactRequestFields(missingFields: BluePassRequiredInquiryField[]) {
  const fields = [
    missingFields.includes("travellerName") ? "name" : null,
    missingFields.includes("travellerEmail") ? "email" : null,
    missingFields.includes("travellerPhone") ? "phone" : null
  ].filter((field): field is "name" | "email" | "phone" => Boolean(field));

  return fields as readonly ("name" | "email" | "phone")[];
}

function getPromptMissingFields(missingFields: BluePassRequiredInquiryField[]) {
  const contactFields = new Set<BluePassRequiredInquiryField>([
    "travellerName",
    "travellerEmail",
    "travellerPhone"
  ]);
  const tripFields = missingFields.filter((field) => !contactFields.has(field));

  return tripFields.length > 0 ? tripFields : missingFields;
}

function isBluePassValueQuestion(content: string) {
  const normalized = content.toLowerCase();

  return (
    /\b(?:what is|what's|tell me about|explain)\s+bluepass\b/.test(normalized) ||
    /\b(?:why|how)\s+(?:should\s+i\s+)?(?:use|book\s+with|choose)\s+bluepass\b/.test(normalized) ||
    /\b(?:why|how)\s+bluepass\b/.test(normalized) ||
    /\b(?:booking direct|book direct|direct booking|same price|conservation|give back|5%)\b/.test(normalized)
  );
}

function isBluePassSmallTalkRequest(content: string) {
  const normalized = content.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();
  const hasCommercialIntent =
    /\b(?:order|book|booking|reserve|hold|inquiry|operator|quote|availability|liveaboards?|yachts?|boats?|komodo|raja\s+ampat)\b/.test(
      normalized
    );

  if (hasCommercialIntent) return false;

  return (
    /^(?:yo|yow|hey|hi|hello|halo|hai|wassup|what's up|whats up|sup|bro|sis)(?:\s+(?:kai|there|bro|sis|what's up|whats up|wassup))?$/.test(
      normalized
    ) ||
    /\b(?:how are you|how's it going|hows it going|can you help me|help me|what can you do)\b/.test(normalized)
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

function isBluePassRecommendationRequest(content: string) {
  const normalized = content.toLowerCase();
  const explicitBookingIntent =
    /\b(?:order|book|booking|reserve|hold)\b/.test(normalized) ||
    /\b(?:send|submit|create|prepare)\s+(?:this\s+|the\s+|an?\s+)?(?:operator\s+)?inquir(?:y|ies)\b/.test(
      normalized
    );

  if (explicitBookingIntent) return false;

  return (
    /\b(?:recommend|recommendation|recommendations|suggest|option|options|alternative|alternatives)\b/.test(
      normalized
    ) ||
    /\b(?:liveaboards?|yachts?|boats?|trips?)\b/.test(normalized) ||
    /\b(?:show me|what are|which)\b.*\b(?:komodo|raja\s+ampat|liveaboards?|yachts?|boats?|trips?)\b/.test(
      normalized
    )
  );
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
