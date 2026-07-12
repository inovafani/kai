import {
  findBluePassAlternativeYachts,
  resolveBluePassCatalog,
  searchBluePassYachts,
  type BluePassCatalogSnapshotItem,
  type BluePassYachtCard,
  type BluePassYachtCatalogItem
} from "@/core/bluepass/catalog";
import {
  buildBluePassResetConversationReply,
  isBluePassResetConversationRequest
} from "@/core/bluepass/conversation-intent";
import {
  extractBluePassInquiryIntent,
  getMissingBluePassInquiryFields,
  mergeBluePassInquiryIntent,
  type BluePassInquiryIntent,
  type BluePassRequiredInquiryField
} from "@/core/bluepass/intent";
import { extractBluePassPersonaLead } from "@/core/bluepass/lead";
import {
  buildBluePassInquiryConfirmationReply,
  buildBluePassInquiryReadyReply,
  buildBluePassInquiryStatusReply,
  buildBluePassDestinationComparisonReply,
  buildBluePassMissingFieldsReply,
  buildBluePassRecommendationReply,
  buildBluePassSeasonReply,
  buildBluePassSmallTalkReply,
  buildBluePassValueReply,
  buildBluePassYachtComparisonReply,
  buildBluePassYachtOverviewReply
} from "@/core/bluepass/reply";
import {
  buildBluePassLeadCapturedReply,
  buildBluePassOperatorReply,
  buildBluePassPartnerReply,
  classifyBluePassPersona,
  type BluePassPersona
} from "@/core/bluepass/triage";
import {
  createOrReuseBluePassInquiry,
  dispatchBluePassOperatorWhatsApp,
  getActiveBluePassInquiryStatus,
  getLatestBluePassInquiryStatus,
  syncBluePassReferralLedgerEstimate,
  upsertBluePassPersonaLead,
  type BluePassReferralInput
} from "./bluepass-inquiry-repository";

export type BluePassMarketplaceMessageInput = {
  tenantId: string;
  conversationId: string;
  content: string;
  priorTravellerMessages: string[];
  referral?: BluePassReferralInput | null;
  catalog?: BluePassCatalogSnapshotItem[];
  travellerPhone?: string | null;
  identityPersona?: BluePassPersona | null;
  identityName?: string | null;
};

export async function handleBluePassMarketplaceMessage(input: BluePassMarketplaceMessageInput) {
  if (isBluePassResetConversationRequest(input.content)) {
    return buildConciergeResponse(
      buildBluePassResetConversationReply({
        persona: input.identityPersona ?? null,
        identityName: input.identityName
      })
    );
  }

  const persona = classifyBluePassPersona({
    messages: [input.content, ...input.priorTravellerMessages],
    identityPersona: input.identityPersona
  });

  if (persona === "OPERATOR") {
    const lead = resolvePersonaLead({
      persona,
      content: input.content,
      priorTravellerMessages: input.priorTravellerMessages
    });
    if (lead) {
      await upsertBluePassPersonaLead({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        persona,
        lead,
        sourceMessage: input.content
      });

      return buildConciergeResponse(buildBluePassLeadCapturedReply({ persona, lead }));
    }

    return buildConciergeResponse(
      buildBluePassOperatorReply({
        latestMessage: input.content,
        operatorName: input.identityName
      })
    );
  }

  if (persona === "PARTNER") {
    const lead = resolvePersonaLead({
      persona,
      content: input.content,
      priorTravellerMessages: input.priorTravellerMessages
    });
    if (lead) {
      await upsertBluePassPersonaLead({
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        persona,
        lead,
        sourceMessage: input.content
      });

      return buildConciergeResponse(buildBluePassLeadCapturedReply({ persona, lead }));
    }

    return buildConciergeResponse(
      buildBluePassPartnerReply({
        latestMessage: input.content
      })
    );
  }

  const catalog = resolveBluePassCatalog(input.catalog);
  const historyIntent = extractBluePassInquiryIntent(input.priorTravellerMessages);
  const messageIntent = extractBluePassInquiryIntent([input.content]);
  const latestMentionedYachts = resolveMentionedYachts(input.content, catalog);
  const historyMentionedYachts = resolveMentionedYachts(input.priorTravellerMessages.join("\n"), catalog);
  const selectedYacht =
    latestMentionedYachts[0] ??
    (shouldCarryBluePassHistoryYacht({
      content: input.content,
      messageIntent,
      priorTravellerMessages: input.priorTravellerMessages
    })
      ? historyMentionedYachts[0] ?? null
      : null);
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
      replyMode: "ACTION" as const,
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
      replyMode: "ACTION" as const,
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
    return buildConciergeResponse(
      buildBluePassSmallTalkReply({
        gratitude: isBluePassGratitudeRequest(input.content)
      })
    );
  }

  const seasonDestination = resolveSeasonDestination(input.content);
  if (seasonDestination) {
    return buildConciergeResponse(buildBluePassSeasonReply(seasonDestination));
  }

  if (isBluePassDestinationComparisonRequest(input.content)) {
    return buildConciergeResponse(buildBluePassDestinationComparisonReply());
  }

  if (isBluePassYachtComparisonRequest(input.content) && latestMentionedYachts.length >= 2) {
    return buildConciergeResponse(buildBluePassYachtComparisonReply(latestMentionedYachts));
  }

  if (isBluePassRecommendationRequest(input.content) && !isBluePassInquirySubmissionRequest(input.content)) {
    const recommendationDestination = resolveRecommendationDestination({
      content: input.content,
      intentDestination: intent.destination,
      priorTravellerMessages: input.priorTravellerMessages
    });
    const excludedYachts = resolveRecommendationExcludedYachts({
      content: input.content,
      selectedYacht,
      latestMentionedYachts,
      historyMentionedYachts
    });
    const excludedYachtSlugs = new Set(excludedYachts.map((yacht) => yacht.slug));
    if (isBluePassOtherOptionsRequest(input.content) && excludedYachtSlugs.size === 0 && recommendationDestination) {
      for (const yacht of searchBluePassYachts({ destination: recommendationDestination }, catalog, 3)) {
        excludedYachtSlugs.add(yacht.slug);
        excludedYachts.push(yacht);
      }
    }

    const recommendationMatches = searchBluePassYachts(
      {
        destination: recommendationDestination,
        guests: intent.guests,
        interests: intent.interests
      },
      catalog,
      12
    )
      .filter((match) =>
        recommendationDestination ? match.region.toLowerCase().includes(recommendationDestination.toLowerCase()) : true
      )
      .filter((match) => !excludedYachtSlugs.has(match.slug))
      .slice(0, 3);

    return buildConciergeResponse(
      buildBluePassRecommendationReply({
        destination: recommendationDestination,
        matches: recommendationMatches,
        excludedYachtNames: excludedYachts.map((yacht) => yacht.name)
      }),
      recommendationMatches
    );
  }

  if (isBluePassTravelInspirationRequest(input.content) && !isBluePassInquirySubmissionRequest(input.content)) {
    const inspirationMatches = buildBluePassInspirationMatches(catalog);

    return buildConciergeResponse(
      buildBluePassRecommendationReply({
        matches: inspirationMatches
      }),
      inspirationMatches
    );
  }

  const overviewYacht =
    latestMentionedYachts[0] ??
    (isBluePassYachtFollowUpInformationRequest(input.content) ? historyMentionedYachts[0] ?? null : null);

  if (overviewYacht && isBluePassYachtInformationRequest(input.content)) {
    const overviewMatch =
      searchBluePassYachts({ selectedYachtSlug: overviewYacht.slug }, catalog, 1)[0] ??
      bluepassMatches.find((match) => match.slug === overviewYacht.slug) ??
      bluepassMatches[0];

    return buildConciergeResponse(buildBluePassYachtOverviewReply(overviewMatch), [overviewMatch]);
  }

  const missingFields = getMissingBluePassInquiryFields(intent);

  if (missingFields.length > 0) {
    const promptMissingFields = getPromptMissingFields(missingFields);

    return {
      replyMode: "ACTION" as const,
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
      replyMode: "ACTION" as const,
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
    replyMode: "ACTION" as const,
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
    replyMode: "CONCIERGE" as const,
    assistantContent,
    bluepassMatches,
    bluepassInquiry: null,
    bluepassLedger: [],
    bluepassDispatch: null,
    paymentRequest: null,
    contactRequest: null
  };
}

function buildBluePassInspirationMatches(catalog: BluePassYachtCatalogItem[]) {
  const komodoMatches = searchBluePassYachts({ destination: "Komodo" }, catalog, 2);
  const rajaAmpatMatches = searchBluePassYachts({ destination: "Raja Ampat" }, catalog, 2);
  const merged = new Map<string, BluePassYachtCard>();

  for (const yacht of [...rajaAmpatMatches, ...komodoMatches]) {
    merged.set(yacht.slug, yacht);
  }

  return Array.from(merged.values()).slice(0, 4);
}

function resolvePersonaLead(input: {
  persona: Extract<BluePassPersona, "OPERATOR" | "PARTNER">;
  content: string;
  priorTravellerMessages: string[];
}) {
  const latestLead = extractBluePassPersonaLead({
    persona: input.persona,
    messages: [input.content]
  });
  if (!latestLead) return null;

  return (
    extractBluePassPersonaLead({
      persona: input.persona,
      messages: [...input.priorTravellerMessages, input.content]
    }) ?? latestLead
  );
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
    isBluePassGratitudeRequest(content) ||
    /^(?:yo|yow|hey|hi|hello|halo|hai|wassup|what's up|whats up|sup|bro|sis)(?:\s+(?:kai|there|bro|sis|what's up|whats up|wassup))?$/.test(
      normalized
    ) ||
    /\b(?:how are you|how's it going|hows it going|can you help me|help me|what can you do)\b/.test(normalized)
  );
}

function isBluePassGratitudeRequest(content: string) {
  const normalized = content.toLowerCase().replace(/[^\w\s']/g, " ").replace(/\s+/g, " ").trim();

  return /\b(?:thanks|thank you|thx|makasih|terima kasih)\b/.test(normalized);
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

function isBluePassDestinationComparisonRequest(content: string) {
  const normalized = content.toLowerCase();
  const mentionsKomodo = /\bkomodo\b/.test(normalized);
  const mentionsRajaAmpat = /\braja\s+ampat\b/.test(normalized);
  const asksComparison =
    /\b(?:compare|versus|vs\.?|difference|which is better|what'?s better|whats better|better)\b/.test(normalized) ||
    /\b(?:komodo|raja\s+ampat)\b.*\b(?:or|and)\b.*\b(?:komodo|raja\s+ampat)\b/.test(normalized);

  return mentionsKomodo && mentionsRajaAmpat && asksComparison;
}

function isBluePassYachtInformationRequest(content: string) {
  const normalized = content.toLowerCase();
  const asksForInformation =
    /\b(?:tell me about|what is|what's|explain|describe|info about|learn about|details about)\b/.test(normalized) ||
    isBluePassYachtFollowUpInformationRequest(content);
  const asksForCommercialAction =
    /\b(?:send|create|prepare|make|start|submit)\s+(?:an?\s+)?inquir(?:y|ies)\b/.test(normalized) ||
    /\b(?:check|confirm)\s+(?:live\s+)?availability\b/.test(normalized) ||
    /\b(?:order|book|booking|reserve|hold|quote|operator|whatsapp|proceed)\b/.test(normalized);

  return asksForInformation && !asksForCommercialAction;
}

function isBluePassYachtFollowUpInformationRequest(content: string) {
  const normalized = content
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return /\b(?:tell me more|more details|more info|what about it|what about that|that yacht|this yacht|that boat|this boat|that one|this one)\b/.test(
    normalized
  );
}

function isBluePassRecommendationRequest(content: string) {
  const normalized = content.toLowerCase();
  const asksForRecommendationOrAlternative =
    /\b(?:recommend|recommendation|recommendations|suggest|option|options|alternative|alternatives)\b/.test(
      normalized
    ) ||
    /\b(?:anything else|something else|another|other than|rather than|besides|instead of)\b/.test(normalized) ||
    /\b(?:better|best|beautiful|most beautiful|nicest)\s+(?:place|destination|spot|island|area)s?\b/.test(
      normalized
    );
  const asksForBrowsing =
    /\b(?:liveaboards?|yachts?|boats?|trips?)\b/.test(normalized) ||
    /\b(?:show me|what are|which)\b.*\b(?:komodo|raja\s+ampat|liveaboards?|yachts?|boats?|trips?)\b/.test(
      normalized
    );
  const explicitBookingIntent =
    /\b(?:order|book|booking|reserve|hold)\b/.test(normalized) ||
    /\b(?:send|submit|create|prepare)\s+(?:this\s+|the\s+|an?\s+)?(?:operator\s+)?inquir(?:y|ies)\b/.test(
      normalized
    );

  if (explicitBookingIntent && !asksForRecommendationOrAlternative) return false;

  return asksForRecommendationOrAlternative || asksForBrowsing;
}

function isBluePassTravelInspirationRequest(content: string) {
  const normalized = content.toLowerCase();

  return (
    /\b(?:where\s+(?:to|should)\s+(?:go|i go)|where\s+can\s+i\s+go|confus(?:e|ed)|not sure|no idea|inspire|inspiration)\b/.test(
      normalized
    ) ||
    /\b(?:healing|relax|relaxing|chill|honeymoon|romantic|solo|couple|family|friends|retreat|escape)\b/.test(
      normalized
    ) ||
    /\b(?:what\s+(?:trip|destination|place)\s+(?:fits|suits)\s+me|help\s+me\s+choose)\b/.test(normalized) ||
    /\b(?:better|best|beautiful|most beautiful|nicest)\s+(?:place|destination|spot|island|area)s?\b/.test(
      normalized
    ) ||
    /\b(?:place|destination|spot|island|area)s?\s+(?:to\s+go|in\s+indonesia)\b/.test(normalized) ||
    /\bindonesia\b.*\b(?:better|best|beautiful|destination|place|where|go)\b/.test(normalized)
  );
}

function shouldCarryBluePassHistoryYacht(input: {
  content: string;
  messageIntent: BluePassInquiryIntent;
  priorTravellerMessages: string[];
}) {
  const normalized = input.content.toLowerCase();

  if (isBluePassValueQuestion(input.content)) return false;
  if (isBluePassSmallTalkRequest(input.content)) return false;
  if (resolveSeasonDestination(input.content)) return false;
  if (isBluePassDestinationComparisonRequest(input.content)) return false;
  if (isBluePassTravelInspirationRequest(input.content) && !isBluePassInquirySubmissionRequest(input.content)) {
    return false;
  }
  if (isBluePassRecommendationRequest(input.content) && !isBluePassInquirySubmissionRequest(input.content)) {
    return false;
  }

  if (isBluePassYachtFollowUpInformationRequest(input.content) || isBluePassInquirySubmissionRequest(input.content)) {
    return true;
  }

  const hasBookingLanguage =
    /\b(?:order|book|booking|reserve|hold|quote|operator|inquiry|availability|send|submit|create|prepare|proceed|confirm)\b/.test(
      normalized
    );
  const hasTripOrContactDetails = Boolean(
    input.messageIntent.dateWindow ||
      input.messageIntent.guests ||
      input.messageIntent.travellerName ||
      input.messageIntent.travellerEmail ||
      input.messageIntent.travellerPhone ||
      input.messageIntent.budget
  );
  const priorHasBookingLanguage = /\b(?:order|book|booking|reserve|hold|quote|operator|inquiry|availability)\b/.test(
    input.priorTravellerMessages.join("\n").toLowerCase()
  );

  return hasBookingLanguage || hasTripOrContactDetails || (priorHasBookingLanguage && Boolean(input.messageIntent.destination));
}

function resolveRecommendationDestination(input: {
  content: string;
  intentDestination?: string;
  priorTravellerMessages: string[];
}) {
  const normalized = input.content.toLowerCase();
  const asksForDifferentDestination =
    /\b(?:somewhere else|another destination|other destination|outside)\b/.test(normalized) ||
    /\b(?:instead of|rather than|besides)\s+(?:komodo|raja\s+ampat)\b/.test(normalized);

  if (/\braja\s+ampat\b/.test(normalized)) {
    return asksForDifferentDestination ? "Komodo" : "Raja Ampat";
  }

  if (/\bkomodo\b/.test(normalized)) {
    return asksForDifferentDestination ? "Raja Ampat" : "Komodo";
  }

  if (asksForDifferentDestination) {
    const priorText = input.priorTravellerMessages.join("\n").toLowerCase();
    if (input.intentDestination === "Komodo" || /\bkomodo\b/.test(priorText)) return "Raja Ampat";
    if (input.intentDestination === "Raja Ampat" || /\braja\s+ampat\b/.test(priorText)) return "Komodo";
  }

  return input.intentDestination;
}

function isBluePassOtherOptionsRequest(content: string) {
  return /\b(?:anything else|something else|another|other than|rather than|besides|instead of|those\s+\d+|the other ones)\b/i.test(
    content
  );
}

function resolveRecommendationExcludedYachts(input: {
  content: string;
  selectedYacht: BluePassYachtCatalogItem | null;
  latestMentionedYachts: BluePassYachtCatalogItem[];
  historyMentionedYachts: BluePassYachtCatalogItem[];
}) {
  const normalized = input.content.toLowerCase();
  const asksForOtherOptions = isBluePassOtherOptionsRequest(normalized);

  if (!asksForOtherOptions) return [];

  const excluded = new Map<string, BluePassYachtCatalogItem>();
  for (const yacht of input.latestMentionedYachts) {
    excluded.set(yacht.slug, yacht);
  }

  if (input.selectedYacht) {
    excluded.set(input.selectedYacht.slug, input.selectedYacht);
  }

  for (const yacht of input.historyMentionedYachts) {
    excluded.set(yacht.slug, yacht);
  }

  return Array.from(excluded.values());
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
