import type { BluePassInquiry, Prisma } from "@prisma/client";
import { findBluePassAlternativeYachts, type BluePassYachtCard } from "@/core/bluepass/catalog";
import { buildBluePassDispatchText } from "@/core/bluepass/dispatch";
import type { BluePassInquiryIntent } from "@/core/bluepass/intent";
import { calculateBluePassLedgerEstimate } from "@/core/bluepass/ledger";
import { prisma } from "@/lib/prisma";
import { createAssistantMessage, createTravellerMessage } from "@/server/conversation/conversation-repository";
import { sendTemplateMessage, sendWhatsAppText } from "@/server/whatsapp/client";
import { resolveBluePassOperatorDirectoryPhone } from "./bluepass-operator-directory";
import { createBluePassQuoteDraftForOperatorResponse, getBluePassQuote } from "./bluepass-quote";
import {
  buildOperatorInquiryFreeText,
  buildOperatorInquiryTemplatePayload,
  type WhatsAppTemplateComponent
} from "@/server/whatsapp/operator-dispatch";
import {
  buildTravellerInquiryUpdateParams,
  whatsappTemplateNames,
  type OperatorInquiryTemplateInput
} from "@/server/whatsapp/templates";

const activeInquiryStatuses = ["DRAFT", "READY_TO_DISPATCH", "OPERATOR_PENDING", "COUNTER_OFFERED"] as const;

export type BluePassSelectedYachtInput = {
  slug: string;
  name: string;
  operatorId?: string | null;
  operatorName?: string | null;
  operatorPhone?: string | null;
};

export type BluePassReferralInput = {
  referralPartnerId?: string | null;
  referralLinkId?: string | null;
  referralCode?: string | null;
  referralRole?: string | null;
};

export type CreateOrReuseBluePassInquiryInput = {
  tenantId: string;
  conversationId: string;
  sourceChannel?: string;
  travellerMessage: string;
  intent: BluePassInquiryIntent;
  selectedYacht?: BluePassSelectedYachtInput | null;
  referral?: BluePassReferralInput | null;
  alternativeOf?: {
    previousInquiryId: string;
    previousYachtSlug?: string | null;
    alternativeYachtSlug: string;
    reason: "operator_declined";
  } | null;
  notes?: string | null;
};

export type BluePassOperatorResponseAction = "accept" | "decline" | "counter" | "payment_ready" | "booking_confirmed";

export type HandleBluePassOperatorResponseInput = {
  inquiryId: string;
  action: BluePassOperatorResponseAction;
  counterText?: string | null;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
};

export type RecordBluePassTravellerWhatsAppDeliveryStatusInput = {
  providerMessageId: string;
  status: string;
  timestamp?: string | null;
  recipientId?: string | null;
  errors?: Array<{
    code: number | null;
    title: string | null;
    message: string | null;
    details: string | null;
  }>;
};

export type HandleBluePassWhatsAppContextMessageInput = {
  from: string;
  body: string;
  providerMessageId?: string | null;
};

export async function createOrReuseBluePassInquiry(input: CreateOrReuseBluePassInquiryInput) {
  const existing = await prisma.bluePassInquiry.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      status: { in: [...activeInquiryStatuses] }
    },
    orderBy: { createdAt: "desc" }
  });

  if (existing) {
    const inquiry = await prisma.bluePassInquiry.update({
      where: { id: existing.id },
      data: await buildInquiryData(input, existing)
    });

    await createBluePassInquiryEvent({
      inquiry,
      type: "INQUIRY_UPDATED",
      fromStatus: existing.status,
      toStatus: inquiry.status,
      metadata: buildAlternativeInquiryMetadata(input.alternativeOf)
    });

    return {
      inquiry,
      reusedExisting: true as const
    };
  }

  const inquiry = await prisma.bluePassInquiry.create({
    data: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      sourceChannel: input.sourceChannel ?? "WEB_WIDGET",
      ...(await buildInquiryData(input))
    }
  });

  await createBluePassInquiryEvent({
    inquiry,
    type: "INQUIRY_CREATED",
    fromStatus: null,
    toStatus: inquiry.status,
    metadata: buildAlternativeInquiryMetadata(input.alternativeOf)
  });

  return {
    inquiry,
    reusedExisting: false as const
  };
}

export async function syncBluePassReferralLedgerEstimate(inquiry: BluePassInquiry) {
  const estimates = calculateBluePassLedgerEstimate({
    inquiryId: inquiry.id,
    budget: inquiry.budget,
    referralPartnerId: inquiry.referralPartnerId,
    referralLinkId: inquiry.referralLinkId,
    referralCode: inquiry.referralCode,
    referralRole: inquiry.referralRole
  });

  await prisma.bluePassLedgerEntry.deleteMany({
    where: {
      bluePassInquiryId: inquiry.id,
      status: "PENDING"
    }
  });

  if (estimates.length === 0) {
    return [];
  }

  await prisma.bluePassLedgerEntry.createMany({
    data: estimates.map((estimate) => ({
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      bluePassInquiryId: inquiry.id,
      kind: estimate.kind,
      amountCents: estimate.amountCents,
      currency: estimate.currency,
      status: estimate.status,
      referralPartnerId: estimate.referralPartnerId,
      referralLinkId: estimate.referralLinkId,
      referralCode: estimate.referralCode,
      referralRole: estimate.referralRole,
      metadata: estimate.metadata as Prisma.InputJsonValue
    }))
  });

  await createBluePassInquiryEvent({
    inquiry,
    type: "LEDGER_ESTIMATE_SYNCED",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: { entryCount: estimates.length }
  });

  return prisma.bluePassLedgerEntry.findMany({
    where: {
      bluePassInquiryId: inquiry.id,
      status: "PENDING"
    },
    orderBy: { createdAt: "asc" }
  });
}

export async function dispatchBluePassOperatorWhatsApp(input: { inquiryId: string }) {
  const inquiry = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: input.inquiryId }
  });

  if (!inquiry.operatorPhone) {
    throw new Error("BluePass inquiry has no operator phone target.");
  }

  const outboundText = buildBluePassDispatchText({
    inquiryId: inquiry.id,
    selectedYachtName: inquiry.selectedYachtName,
    travellerName: inquiry.travellerName,
    travellerPhone: inquiry.travellerPhone,
    destination: inquiry.destination,
    dateWindow: inquiry.dateWindow,
    guests: inquiry.guests,
    budget: inquiry.budget,
    referralCode: inquiry.referralCode
  });

  const dispatch = await prisma.bluePassOperatorDispatch.create({
    data: {
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      bluePassInquiryId: inquiry.id,
      status: "QUEUED",
      operatorId: inquiry.operatorId,
      operatorName: inquiry.operatorName,
      operatorPhone: inquiry.operatorPhone,
      outboundText
    }
  });

  const sendMode = resolveOperatorInquirySendMode();
  if (sendMode !== "queue") {
    try {
      const templateInput = buildOperatorInquiryTemplateInput({
        inquiry,
        operatorPhone: inquiry.operatorPhone
      });
      const template = buildOperatorInquiryTemplatePayload(templateInput);
      const sendResult = await sendOperatorInquiryMessage({
        mode: sendMode,
        to: template.to,
        templateName: template.template.name,
        languageCode: template.template.language.code,
        components: template.template.components,
        textBody: buildOperatorInquiryFreeText(templateInput)
      });

      await prisma.bluePassOperatorDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: "SENT",
          sentAt: new Date(),
          providerMessageId: sendResult.providerMessageId,
          metadata: {
            messageKind: sendResult.messageKind,
            templateName:
              sendResult.messageKind === "template" ? whatsappTemplateNames.bookingInquiryOperator : "operator_inquiry_text"
          }
        }
      });
    } catch (error) {
      await prisma.bluePassOperatorDispatch.update({
        where: { id: dispatch.id },
        data: {
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : "WhatsApp send failed."
        }
      });

      await createBluePassInquiryEvent({
        inquiry,
        type: "OPERATOR_DISPATCH_FAILED",
        fromStatus: inquiry.status,
        toStatus: inquiry.status,
        metadata: { dispatchId: dispatch.id }
      });

      return prisma.bluePassOperatorDispatch.findUniqueOrThrow({
        where: { id: dispatch.id }
      });
    }
  }

  const updated = await prisma.bluePassInquiry.update({
    where: { id: inquiry.id },
    data: { status: "OPERATOR_PENDING" }
  });

  await createBluePassInquiryEvent({
    inquiry: updated,
    type: "OPERATOR_DISPATCH_QUEUED",
    fromStatus: inquiry.status,
    toStatus: updated.status,
    metadata: { dispatchId: dispatch.id }
  });

  return prisma.bluePassOperatorDispatch.findUniqueOrThrow({
    where: { id: dispatch.id }
  });
}

export async function getActiveBluePassInquiryStatus(input: { tenantId: string; conversationId: string }) {
  const inquiry = await prisma.bluePassInquiry.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      status: { in: [...activeInquiryStatuses] }
    },
    orderBy: { createdAt: "desc" },
    include: {
      events: { orderBy: { createdAt: "asc" } },
      ledger: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      dispatches: { orderBy: { createdAt: "desc" } }
    }
  });

  return inquiry
    ? {
        inquiry,
        events: inquiry.events,
        ledger: inquiry.ledger,
        dispatches: inquiry.dispatches
      }
    : null;
}

function buildAlternativeInquiryMetadata(input?: CreateOrReuseBluePassInquiryInput["alternativeOf"]) {
  return input
    ? {
        reason: input.reason,
        previousInquiryId: input.previousInquiryId,
        previousYachtSlug: input.previousYachtSlug ?? null,
        alternativeYachtSlug: input.alternativeYachtSlug
      }
    : undefined;
}

export async function getLatestBluePassInquiryStatus(input: { tenantId: string; conversationId: string }) {
  const inquiry = await prisma.bluePassInquiry.findFirst({
    where: {
      tenantId: input.tenantId,
      conversationId: input.conversationId
    },
    orderBy: { createdAt: "desc" },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 5 },
      ledger: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      dispatches: { orderBy: { createdAt: "desc" }, take: 1 }
    }
  });

  return inquiry
    ? {
        inquiry,
        events: inquiry.events,
        ledger: inquiry.ledger,
        dispatches: inquiry.dispatches
      }
    : null;
}

export async function handleBluePassOperatorResponse(input: HandleBluePassOperatorResponseInput) {
  const inquiry = await prisma.bluePassInquiry.findUnique({
    where: { id: input.inquiryId }
  });
  if (!inquiry) {
    throw new Error(`BluePass inquiry ${input.inquiryId} was not found for operator response.`);
  }

  if (input.action === "counter" && !input.counterText?.trim()) {
    const operatorFollowUp = await requestOperatorCounterDetails({
      inquiry,
      providerMessageId: input.providerMessageId,
      operatorPhone: input.operatorPhone
    });

    return {
      inquiry,
      travellerNotification: null,
      operatorFollowUp
    };
  }

  if (input.action === "payment_ready") {
    return handleBluePassPaymentReadyOperatorResponse({
      inquiry,
      paymentText: input.counterText,
      providerMessageId: input.providerMessageId,
      operatorPhone: input.operatorPhone
    });
  }

  if (input.action === "booking_confirmed") {
    return handleBluePassBookingConfirmedOperatorResponse({
      inquiry,
      confirmationText: input.counterText,
      providerMessageId: input.providerMessageId,
      operatorPhone: input.operatorPhone
    });
  }

  const nextStatus = resolveOperatorResponseStatus(input.action);
  const eventType = resolveOperatorResponseEventType(input.action);
  const updated = await prisma.bluePassInquiry.update({
    where: { id: inquiry.id },
    data: {
      status: nextStatus
    }
  });

  await createBluePassInquiryEvent({
    inquiry: updated,
    type: eventType,
    fromStatus: inquiry.status,
    toStatus: updated.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null,
      counterText: input.counterText ?? null
    }
  });

  let quoteUrl: string | null = null;
  if (input.action === "accept" || input.action === "counter") {
    await createBluePassQuoteDraftForOperatorResponse({
      inquiry: updated,
      action: input.action,
      counterText: input.counterText
    });
    quoteUrl = (await getBluePassQuote({ quoteId: updated.id }))?.quoteUrl ?? null;
  }

  const notificationContent = buildOperatorResponseTravellerNotification({
    inquiry: updated,
    action: input.action,
    counterText: input.counterText,
    quoteUrl
  });

  await createAssistantMessage({
    tenantId: updated.tenantId,
    conversationId: updated.conversationId,
    content: notificationContent
  });

  const whatsappNotification = await sendTravellerWhatsAppNotification({
    inquiry: updated,
    content: notificationContent
  });

  return {
    inquiry: updated,
    travellerNotification: whatsappNotification,
    operatorFollowUp: null
  };
}

export async function resolveLatestPendingBluePassInquiryIdForOperatorPhone(operatorPhone?: string | null) {
  const candidates = buildOperatorPhoneCandidates(operatorPhone);
  if (candidates.length === 0) return null;

  const dispatch = await prisma.bluePassOperatorDispatch.findFirst({
    where: {
      operatorPhone: { in: candidates },
      inquiry: {
        status: { in: ["READY_TO_DISPATCH", "OPERATOR_PENDING", "OPERATOR_ACCEPTED", "COUNTER_OFFERED"] }
      }
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      bluePassInquiryId: true
    }
  });

  return dispatch?.bluePassInquiryId ?? null;
}

export async function recordBluePassTravellerWhatsAppDeliveryStatus(
  input: RecordBluePassTravellerWhatsAppDeliveryStatusInput
) {
  const sentEvent = await findTravellerWhatsAppSentEvent(input.providerMessageId);
  if (!sentEvent) {
    throw new Error(`No BluePass traveller WhatsApp notification matched ${input.providerMessageId}.`);
  }

  const inquiry = await prisma.bluePassInquiry.findUnique({
    where: { id: sentEvent.bluePassInquiryId }
  });
  if (!inquiry) {
    throw new Error(`BluePass inquiry ${sentEvent.bluePassInquiryId} was not found for WhatsApp delivery status.`);
  }

  const statusEvent = await createBluePassInquiryEvent({
    inquiry,
    type: "TRAVELLER_WHATSAPP_DELIVERY_STATUS",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: {
      providerMessageId: input.providerMessageId,
      status: input.status,
      timestamp: input.timestamp ?? null,
      recipientId: input.recipientId ?? null,
      errors: input.errors ?? []
    }
  });

  if (shouldFallbackTravellerTemplateFromDeliveryStatus(input, sentEvent.metadata)) {
    await resendTravellerTemplateAfterDeliveryFailure({
      inquiry,
      failedProviderMessageId: input.providerMessageId,
      errors: input.errors ?? []
    });
  }

  return statusEvent;
}

export async function handleBluePassWhatsAppContextMessage(input: HandleBluePassWhatsAppContextMessageInput) {
  const context = await findLatestBluePassParticipantContext(input.from);
  if (!context) {
    return {
      handled: false as const,
      sent: false as const,
      inquiry: null,
      participant: null,
      reply: null
    };
  }

  const { inquiry, participant } = context;
  const alternativeDispatch =
    participant === "traveller"
      ? await dispatchDeclinedAlternativeFromTravellerApproval({
          inquiry,
          travellerMessage: input.body
        })
      : null;
  const replyInquiry = alternativeDispatch?.inquiry ?? inquiry;
  const reply =
    alternativeDispatch?.reply ??
    buildBluePassWhatsAppContextReply({
      inquiry,
      participant
    });

  await createBluePassInquiryEvent({
    inquiry,
    type: "WHATSAPP_CONTEXT_MESSAGE_RECEIVED",
    fromStatus: inquiry.status,
    toStatus: inquiry.status,
    metadata: {
      participant,
      from: input.from,
      body: input.body,
      providerMessageId: input.providerMessageId ?? null
    }
  });

  if (participant === "traveller") {
    await createTravellerMessage({
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      content: input.body
    });
    await createAssistantMessage({
      tenantId: replyInquiry.tenantId,
      conversationId: replyInquiry.conversationId,
      content: reply
    });
  }

  try {
    const sendResult = await sendWhatsAppText({
      to: input.from,
      role: participant === "operator" ? "ops" : "kai",
      body: reply
    });

    await createBluePassInquiryEvent({
      inquiry: replyInquiry,
      type: "WHATSAPP_CONTEXT_REPLY_SENT",
      fromStatus: replyInquiry.status,
      toStatus: replyInquiry.status,
      metadata: {
        participant,
        providerMessageId: sendResult.providerMessageId,
        inboundProviderMessageId: input.providerMessageId ?? null,
        alternativeDispatchId: alternativeDispatch?.dispatch?.id ?? null
      }
    });

    return {
      handled: true as const,
      sent: true as const,
      inquiry: replyInquiry,
      participant,
      reply,
      providerMessageId: sendResult.providerMessageId
    };
  } catch (error) {
    await createBluePassInquiryEvent({
      inquiry: replyInquiry,
      type: "WHATSAPP_CONTEXT_REPLY_FAILED",
      fromStatus: replyInquiry.status,
      toStatus: replyInquiry.status,
      metadata: {
        participant,
        inboundProviderMessageId: input.providerMessageId ?? null,
        reason: error instanceof Error ? error.message : "WhatsApp context reply failed."
      }
    });

    return {
      handled: true as const,
      sent: false as const,
      inquiry: replyInquiry,
      participant,
      reply,
      skippedReason: error instanceof Error ? error.message : "WhatsApp context reply failed."
    };
  }
}

export async function listBluePassInquiriesForTenantSlug(input: { tenantSlug: string; take?: number }) {
  const tenant = await prisma.tenant.findUnique({
    where: { slug: input.tenantSlug },
    select: { id: true, slug: true, name: true }
  });

  if (!tenant) {
    return [];
  }

  const inquiries = await prisma.bluePassInquiry.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: input.take ?? 50,
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 5 },
      ledger: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "asc" }
      },
      dispatches: { orderBy: { createdAt: "desc" } }
    }
  });

  return inquiries.map((inquiry) => ({
    ...inquiry,
    tenant,
    events: inquiry.events,
    ledger: inquiry.ledger,
    dispatches: inquiry.dispatches
  }));
}

async function buildInquiryData(input: CreateOrReuseBluePassInquiryInput, existing?: BluePassInquiry) {
  const selectedYacht = resolveInquirySelectedYacht(input.selectedYacht, existing);
  const operatorDirectoryPhone = await resolveBluePassOperatorDirectoryPhone({
    selectedYacht
  });
  const operatorPhone = resolveBluePassOperatorPhone({
    selectedYacht,
    existingOperatorPhone: existing?.operatorPhone,
    operatorDirectoryPhone
  });

  return {
    status: "READY_TO_DISPATCH" as const,
    travellerName: input.intent.travellerName ?? existing?.travellerName,
    travellerEmail: input.intent.travellerEmail ?? existing?.travellerEmail,
    travellerPhone: input.intent.travellerPhone ?? existing?.travellerPhone,
    destination: input.intent.destination ?? existing?.destination,
    tripType: input.intent.tripType ?? existing?.tripType,
    dateWindow: input.intent.dateWindow ?? existing?.dateWindow,
    guests: input.intent.guests ?? existing?.guests,
    budget: input.intent.budget ?? existing?.budget,
    interests: input.intent.interests ? (input.intent.interests as Prisma.InputJsonArray) : undefined,
    selectedYachtSlug: selectedYacht?.slug ?? existing?.selectedYachtSlug,
    selectedYachtName: selectedYacht?.name ?? existing?.selectedYachtName,
    operatorId: selectedYacht?.operatorId ?? existing?.operatorId,
    operatorName: selectedYacht?.operatorName ?? existing?.operatorName,
    operatorPhone,
    notes: input.notes ?? existing?.notes,
    travellerMessage: input.travellerMessage,
    referralPartnerId: input.referral?.referralPartnerId ?? existing?.referralPartnerId,
    referralLinkId: input.referral?.referralLinkId ?? existing?.referralLinkId,
    referralCode: input.referral?.referralCode ?? existing?.referralCode,
    referralRole: input.referral?.referralRole ?? existing?.referralRole
  };
}

function resolveBluePassOperatorPhone(input: {
  selectedYacht?: BluePassSelectedYachtInput | null;
  existingOperatorPhone?: string | null;
  operatorDirectoryPhone?: string | null;
}) {
  const forcedTestPhone = shouldForceBluePassTestOperatorPhone() ? normalizeConfiguredPhone(process.env.BLUEPASS_TEST_OPERATOR_PHONE) : null;
  if (forcedTestPhone) return forcedTestPhone;

  const operatorDirectoryPhone = normalizeRuntimeOperatorPhone(input.operatorDirectoryPhone);
  if (operatorDirectoryPhone) return operatorDirectoryPhone;

  const overridePhone = resolveBluePassOperatorPhoneOverride(input.selectedYacht);
  if (overridePhone) return overridePhone;

  const selectedOperatorPhone = normalizeRuntimeOperatorPhone(input.selectedYacht?.operatorPhone);
  if (selectedOperatorPhone) return selectedOperatorPhone;

  const existingOperatorPhone = normalizeRuntimeOperatorPhone(input.existingOperatorPhone);
  if (existingOperatorPhone) return existingOperatorPhone;

  return null;
}

function resolveBluePassOperatorPhoneOverride(selectedYacht?: BluePassSelectedYachtInput | null) {
  const overrides = parseBluePassOperatorPhoneOverrides();
  if (!selectedYacht || overrides.size === 0) return null;

  const keys = [selectedYacht.slug, selectedYacht.operatorId, selectedYacht.operatorName, selectedYacht.name]
    .map((value) => normalizeOperatorPhoneOverrideKey(value))
    .filter((value): value is string => Boolean(value));

  for (const key of keys) {
    const phone = normalizeConfiguredPhone(overrides.get(key));
    if (phone) return phone;
  }

  return null;
}

function parseBluePassOperatorPhoneOverrides() {
  const raw = process.env.BLUEPASS_OPERATOR_PHONE_OVERRIDES?.trim();
  const overrides = new Map<string, string>();
  if (!raw) return overrides;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return overrides;

    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value !== "string") continue;
      const normalizedKey = normalizeOperatorPhoneOverrideKey(key);
      const phone = normalizeConfiguredPhone(value);
      if (normalizedKey && phone) overrides.set(normalizedKey, phone);
    }
  } catch {
    return overrides;
  }

  return overrides;
}

function normalizeOperatorPhoneOverrideKey(value?: string | null) {
  return value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeConfiguredPhone(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeRuntimeOperatorPhone(value?: string | null) {
  const phone = normalizeConfiguredPhone(value);
  if (!phone) return null;
  if (isProductionRuntime() && isPreviewCatalogOperatorPhone(phone)) return null;

  return phone;
}

function isPreviewCatalogOperatorPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^6281234567\d+$/.test(digits);
}

function shouldForceBluePassTestOperatorPhone() {
  if (isProductionRuntime()) return false;
  return /^(1|true|yes|on)$/i.test(process.env.BLUEPASS_FORCE_TEST_OPERATOR_PHONE?.trim() ?? "");
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

function buildOperatorPhoneCandidates(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "");
  return Array.from(new Set([raw, digits, digits ? `+${digits}` : ""])).filter(Boolean);
}

function buildParticipantPhoneCandidates(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "");
  const indonesiaLocal = digits.startsWith("62") ? `0${digits.slice(2)}` : null;
  const indonesiaInternational = digits.startsWith("0") ? `62${digits.slice(1)}` : null;
  const candidates = [
    raw,
    digits,
    digits ? `+${digits}` : null,
    indonesiaLocal,
    indonesiaLocal ? `+${indonesiaLocal}` : null,
    indonesiaInternational,
    indonesiaInternational ? `+${indonesiaInternational}` : null
  ];

  return Array.from(new Set(candidates.filter((candidate): candidate is string => Boolean(candidate))));
}

async function dispatchDeclinedAlternativeFromTravellerApproval(input: {
  inquiry: BluePassInquiry;
  travellerMessage: string;
}) {
  if (input.inquiry.status !== "DECLINED") {
    return null;
  }

  const selection = resolveDeclinedAlternativeSelection({
    inquiry: input.inquiry,
    travellerMessage: input.travellerMessage
  });
  if (!selection.approved) {
    return null;
  }

  const alternative = selection.alternative;
  if (!alternative) {
    return {
      inquiry: input.inquiry,
      dispatch: null,
      reply:
        "I checked the BluePass catalog but do not have a strong similar alternative ready for this request yet. BluePass will follow up before sending another operator inquiry."
    };
  }

  const created = await createOrReuseBluePassInquiry({
    tenantId: input.inquiry.tenantId,
    conversationId: input.inquiry.conversationId,
    sourceChannel: "WHATSAPP",
    travellerMessage: input.travellerMessage,
    intent: {
      destination: input.inquiry.destination ?? alternative.region,
      tripType: input.inquiry.tripType ?? undefined,
      dateWindow: input.inquiry.dateWindow ?? undefined,
      guests: input.inquiry.guests ?? undefined,
      budget: input.inquiry.budget ?? undefined,
      interests: Array.isArray(input.inquiry.interests)
        ? input.inquiry.interests.filter((interest): interest is string => typeof interest === "string")
        : undefined,
      travellerName: input.inquiry.travellerName ?? undefined,
      travellerEmail: input.inquiry.travellerEmail ?? undefined,
      travellerPhone: input.inquiry.travellerPhone ?? undefined,
      selectedYachtSlug: alternative.slug
    },
    selectedYacht: alternative,
    referral: {
      referralPartnerId: input.inquiry.referralPartnerId,
      referralLinkId: input.inquiry.referralLinkId,
      referralCode: input.inquiry.referralCode,
      referralRole: input.inquiry.referralRole
    },
    alternativeOf: {
      previousInquiryId: input.inquiry.id,
      previousYachtSlug: input.inquiry.selectedYachtSlug,
      alternativeYachtSlug: alternative.slug,
      reason: "operator_declined"
    }
  });
  await syncBluePassReferralLedgerEstimate(created.inquiry);
  const dispatch = created.inquiry.operatorPhone
    ? await dispatchBluePassOperatorWhatsApp({ inquiryId: created.inquiry.id })
    : null;
  const updatedInquiry = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: created.inquiry.id }
  });

  return {
    inquiry: updatedInquiry,
    dispatch,
    reply: buildAlternativeDispatchReply({
      inquiry: updatedInquiry,
      previousInquiry: input.inquiry,
      dispatchFailed: dispatch?.status === "FAILED"
    })
  };
}

function resolveInquirySelectedYacht(
  selectedYacht?: BluePassSelectedYachtInput | null,
  existing?: BluePassInquiry
): BluePassSelectedYachtInput | null {
  if (selectedYacht) return selectedYacht;
  if (!existing?.selectedYachtSlug && !existing?.selectedYachtName && !existing?.operatorId && !existing?.operatorName) return null;

  return {
    slug: existing.selectedYachtSlug ?? existing.operatorId ?? existing.selectedYachtName ?? "unknown",
    name: existing.selectedYachtName ?? existing.selectedYachtSlug ?? existing.operatorName ?? "Unknown yacht",
    operatorId: existing.operatorId,
    operatorName: existing.operatorName,
    operatorPhone: existing.operatorPhone
  };
}

function resolveDeclinedAlternativeSelection(input: { inquiry: BluePassInquiry; travellerMessage: string }) {
  const alternatives = findBluePassAlternativeYachts({
    destination: input.inquiry.destination ?? undefined,
    guests: input.inquiry.guests ?? undefined,
    declinedYachtSlug: input.inquiry.selectedYachtSlug
  });
  const mentionedAlternative = alternatives.find((alternative) =>
    messageMentionsAlternative(input.travellerMessage, alternative)
  );

  if (mentionedAlternative && hasTravellerAlternativeDispatchIntent(input.travellerMessage)) {
    return {
      approved: true,
      alternative: mentionedAlternative,
      alternatives
    };
  }

  if (isTravellerAlternativeApproval(input.travellerMessage)) {
    return {
      approved: true,
      alternative: alternatives[0] ?? null,
      alternatives
    };
  }

  return {
    approved: false,
    alternative: null,
    alternatives
  };
}

async function findLatestBluePassParticipantContext(from: string) {
  const candidates = buildParticipantPhoneCandidates(from);
  if (candidates.length === 0) return null;

  const dispatch = await prisma.bluePassOperatorDispatch.findFirst({
    where: {
      operatorPhone: { in: candidates }
    },
    orderBy: { createdAt: "desc" },
    select: { bluePassInquiryId: true }
  });

  if (dispatch) {
    const inquiry = await findBluePassInquiryWithRecentEvents(dispatch.bluePassInquiryId);
    if (inquiry) {
      return {
        participant: "operator" as const,
        inquiry
      };
    }
  }

  const inquiry = await prisma.bluePassInquiry.findFirst({
    where: {
      travellerPhone: { in: candidates }
    },
    orderBy: { createdAt: "desc" },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 8 }
    }
  });

  return inquiry
    ? {
        participant: "traveller" as const,
        inquiry
      }
    : null;
}

function isTravellerAlternativeApproval(value: string) {
  return hasTravellerAlternativeDispatchIntent(value);
}

function hasTravellerAlternativeDispatchIntent(value: string) {
  const normalized = normalizeAlternativeSelectionText(value);

  return /\b(?:yes|yep|yeah|ok|okay|sure|please|go ahead|proceed|send|submit|try)\b/.test(normalized);
}

function messageMentionsAlternative(message: string, alternative: BluePassYachtCard) {
  const normalizedMessage = normalizeAlternativeSelectionText(message);

  return [alternative.name, alternative.slug].some((value) =>
    normalizedMessage.includes(normalizeAlternativeSelectionText(value))
  );
}

function normalizeAlternativeSelectionText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildAlternativeDispatchReply(input: {
  inquiry: BluePassInquiry;
  previousInquiry: BluePassInquiry;
  dispatchFailed: boolean;
}) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the next operator";
  const previousYachtName =
    input.previousInquiry.selectedYachtName ?? input.previousInquiry.operatorName ?? "the previous operator";
  const dispatchLine = input.dispatchFailed
    ? "I tried to send the next operator inquiry, but WhatsApp dispatch failed. BluePass will retry from the operator pipeline."
    : "I sent the next operator inquiry and will update you when the operator replies.";

  return `${previousYachtName} was not available, so I moved to a similar BluePass option: ${yachtName} for ${formatTripSummary(input.inquiry)}. ${dispatchLine} This is still not a confirmed booking; availability, final price, and payment wait for operator confirmation.`;
}

async function findBluePassInquiryWithRecentEvents(inquiryId: string) {
  return prisma.bluePassInquiry.findUnique({
    where: { id: inquiryId },
    include: {
      events: { orderBy: { createdAt: "desc" }, take: 8 }
    }
  });
}

function buildBluePassWhatsAppContextReply(input: {
  inquiry: BluePassInquiry & { events?: Array<{ type: string; metadata: Prisma.JsonValue }> };
  participant: "traveller" | "operator";
}) {
  const inquiry = input.inquiry;
  const yachtName = inquiry.selectedYachtName ?? inquiry.operatorName ?? "the operator";
  const tripSummary = formatTripSummary(inquiry);
  const quoteUrl = buildBluePassQuoteUrl(inquiry.id);
  const paymentText = findLatestEventMetadataString(inquiry.events, "OPERATOR_PAYMENT_READY", "paymentText");
  const confirmationText = findLatestEventMetadataString(
    inquiry.events,
    "OPERATOR_BOOKING_CONFIRMED",
    "confirmationText"
  );
  const hasQuoteApproval = Boolean(inquiry.events?.some((event) => event.type === "BLUEPASS_QUOTE_APPROVED"));

  if (input.participant === "operator") {
    if (inquiry.status === "CLOSED" || confirmationText) {
      return `I found ${inquiry.travellerName ?? "the traveller"}'s ${yachtName} inquiry for ${tripSummary}. Booking is marked confirmed. ${confirmationText ? `Latest confirmation: ${confirmationText}` : "BluePass will keep the traveller updated."}`;
    }

    if (paymentText) {
      return `I found ${inquiry.travellerName ?? "the traveller"}'s ${yachtName} inquiry for ${tripSummary}. Payment details are already with the traveller: ${paymentText} Please reply here once payment is received and booking is confirmed.`;
    }

    if (hasQuoteApproval) {
      return `I found ${inquiry.travellerName ?? "the traveller"}'s ${yachtName} inquiry for ${tripSummary}. The traveller approved the BluePass quote. Please hold the slot and send the payment link, deposit terms, and booking reference here.`;
    }

    if (inquiry.status === "COUNTER_OFFERED") {
      return `I found ${inquiry.travellerName ?? "the traveller"}'s ${yachtName} inquiry for ${tripSummary}. Your counter-offer has been sent to the traveller. BluePass is waiting for traveller approval or negotiation.`;
    }

    return `I found ${inquiry.travellerName ?? "the traveller"}'s ${yachtName} inquiry for ${tripSummary}. Current status: ${formatStatusForReply(inquiry.status)}. You can reply with availability, a counter-offer, payment details, or booking confirmation.`;
  }

  if (inquiry.status === "CLOSED" || confirmationText) {
    return `I found your latest BluePass inquiry with ${yachtName} for ${tripSummary}. Booking is confirmed. ${confirmationText ? `Operator confirmation: ${confirmationText}` : "BluePass can still help if you need pre-departure support."}`;
  }

  if (paymentText) {
    return `I found your latest BluePass inquiry with ${yachtName} for ${tripSummary}. The operator has sent payment instructions: ${paymentText} Your booking is not confirmed until payment and final operator confirmation are complete.`;
  }

  if (hasQuoteApproval) {
    return `I found your latest BluePass inquiry with ${yachtName} for ${tripSummary}. You approved the quote, and BluePass is waiting for the operator to hold the slot and send payment instructions. Quote: ${quoteUrl}`;
  }

  if (inquiry.status === "COUNTER_OFFERED") {
    return `I found your latest BluePass inquiry with ${yachtName} for ${tripSummary}. A counter-offer is ready for review. You can approve it, negotiate, or compare alternatives here: ${quoteUrl}`;
  }

  if (inquiry.status === "DECLINED") {
    return `I found your latest BluePass inquiry with ${yachtName} for ${tripSummary}. The operator is not available. BluePass can compare similar alternatives before sending another inquiry.`;
  }

  if (inquiry.status === "OPERATOR_ACCEPTED") {
    return `I found your latest BluePass inquiry with ${yachtName} for ${tripSummary}. The operator accepted, but this is not a confirmed booking yet. BluePass is waiting for final quote and payment instructions.`;
  }

  return `I found your latest BluePass inquiry with ${yachtName} for ${tripSummary}. Current status: ${formatStatusForReply(inquiry.status)}. BluePass will keep coordinating operator confirmation, quote, and payment readiness here.`;
}

function findLatestEventMetadataString(
  events: Array<{ type: string; metadata: Prisma.JsonValue }> | undefined,
  type: string,
  key: string
) {
  const event = events?.find((item) => item.type === type);
  if (!event || !event.metadata || typeof event.metadata !== "object" || Array.isArray(event.metadata)) {
    return null;
  }

  const value = event.metadata[key as keyof typeof event.metadata];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function formatStatusForReply(status: BluePassInquiry["status"]) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildBluePassQuoteUrl(quoteId: string) {
  const baseUrl =
    process.env.BLUEPASS_APP_URL?.trim() || process.env.NEXT_PUBLIC_BLUEPASS_APP_URL?.trim() || "https://bluepass.co";
  return `${baseUrl.replace(/\/$/, "")}/quotes/${quoteId}`;
}

async function findTravellerWhatsAppSentEvent(providerMessageId: string) {
  const recentSentEvents = await prisma.bluePassInquiryEvent.findMany({
    where: {
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT"
    },
    orderBy: { createdAt: "desc" },
    take: 500
  });

  return (
    recentSentEvents.find((event) => {
      const metadata = event.metadata;
      return (
        metadata !== null &&
        typeof metadata === "object" &&
        !Array.isArray(metadata) &&
        "providerMessageId" in metadata &&
        metadata.providerMessageId === providerMessageId
      );
    }) ?? null
  );
}

async function createBluePassInquiryEvent(input: {
  inquiry: BluePassInquiry;
  type: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  return prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: input.inquiry.tenantId,
      conversationId: input.inquiry.conversationId,
      bluePassInquiryId: input.inquiry.id,
      type: input.type,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      metadata: input.metadata
    }
  });
}

function resolveOperatorInquirySendMode() {
  if (process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE === "template") return "template";
  if (process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE === "text") return "text";
  return "queue";
}

function resolveOperatorResponseStatus(action: BluePassOperatorResponseAction) {
  if (action === "accept") return "OPERATOR_ACCEPTED" as const;
  if (action === "decline") return "DECLINED" as const;
  return "COUNTER_OFFERED" as const;
}

function resolveOperatorResponseEventType(action: BluePassOperatorResponseAction) {
  if (action === "accept") return "OPERATOR_ACCEPTED";
  if (action === "decline") return "OPERATOR_DECLINED";
  return "OPERATOR_COUNTER_OFFERED";
}

function buildOperatorResponseTravellerNotification(input: {
  inquiry: BluePassInquiry;
  action: Exclude<BluePassOperatorResponseAction, "payment_ready" | "booking_confirmed">;
  counterText?: string | null;
  quoteUrl?: string | null;
}) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the operator";
  const quoteLink = input.quoteUrl ? ` Quote link: ${input.quoteUrl}` : "";

  if (input.action === "accept") {
    return `${yachtName} accepted your BluePass inquiry for ${formatTripSummary(input.inquiry)}. This is still not a confirmed booking yet; BluePass will follow up with the final price, payment path, and operator confirmation.${quoteLink}`;
  }

  if (input.action === "decline") {
    const alternatives = formatDeclineAlternatives(input.inquiry);
    return `${yachtName} is not available for ${formatTripSummary(input.inquiry)}.${alternatives}`;
  }

  const counterText = input.counterText?.trim();
  const details = counterText ? ` Details: ${counterText}` : " BluePass needs the operator's counter details before this becomes actionable.";

  return `${yachtName} sent a counter-offer for ${formatTripSummary(input.inquiry)}.${details} You can accept the counter, negotiate, or compare alternatives with BluePass.${quoteLink}`;
}

function buildPaymentReadyTravellerNotification(input: { inquiry: BluePassInquiry; paymentText: string }) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the operator";

  return `${yachtName} has held your BluePass trip for ${formatTripSummary(input.inquiry)}. Payment and booking instructions: ${input.paymentText} This is not a confirmed booking until payment and final operator confirmation are complete.`;
}

function buildBookingConfirmedTravellerNotification(input: { inquiry: BluePassInquiry; confirmationText: string }) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the operator";

  return `Your BluePass booking with ${yachtName} is confirmed for ${formatTripSummary(input.inquiry)}. Operator confirmation: ${input.confirmationText} BluePass will keep this thread available if you need help before departure.`;
}

async function handleBluePassPaymentReadyOperatorResponse(input: {
  inquiry: BluePassInquiry;
  paymentText?: string | null;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  const paymentText = input.paymentText?.trim();
  const quote = await getBluePassQuote({ quoteId: input.inquiry.id });

  if (!paymentText) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_PAYMENT_READY_IGNORED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "payment details missing",
        providerMessageId: input.providerMessageId ?? null,
        operatorPhone: input.operatorPhone ?? null
      }
    });

    return {
      inquiry: input.inquiry,
      travellerNotification: null,
      operatorFollowUp: null
    };
  }

  if (quote?.status !== "TRAVELLER_APPROVED") {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_PAYMENT_READY_WAITING_FOR_TRAVELLER_APPROVAL",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        providerMessageId: input.providerMessageId ?? null,
        operatorPhone: input.operatorPhone ?? null,
        paymentText
      }
    });

    return {
      inquiry: input.inquiry,
      travellerNotification: null,
      operatorFollowUp: null
    };
  }

  await createBluePassInquiryEvent({
    inquiry: input.inquiry,
    type: "OPERATOR_PAYMENT_READY",
    fromStatus: input.inquiry.status,
    toStatus: input.inquiry.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null,
      paymentText,
      quoteId: quote.id
    }
  });

  const notificationContent = buildPaymentReadyTravellerNotification({
    inquiry: input.inquiry,
    paymentText
  });

  await createAssistantMessage({
    tenantId: input.inquiry.tenantId,
    conversationId: input.inquiry.conversationId,
    content: notificationContent
  });

  const whatsappNotification = await sendTravellerWhatsAppNotification({
    inquiry: input.inquiry,
    content: notificationContent
  });

  return {
    inquiry: input.inquiry,
    travellerNotification: whatsappNotification,
    operatorFollowUp: null
  };
}

async function handleBluePassBookingConfirmedOperatorResponse(input: {
  inquiry: BluePassInquiry;
  confirmationText?: string | null;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  const confirmationText = input.confirmationText?.trim();

  if (!confirmationText) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_BOOKING_CONFIRMATION_IGNORED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "confirmation details missing",
        providerMessageId: input.providerMessageId ?? null,
        operatorPhone: input.operatorPhone ?? null
      }
    });

    return {
      inquiry: input.inquiry,
      travellerNotification: null,
      operatorFollowUp: null
    };
  }

  const updated = await prisma.bluePassInquiry.update({
    where: { id: input.inquiry.id },
    data: { status: "CLOSED" }
  });

  await createBluePassInquiryEvent({
    inquiry: updated,
    type: "OPERATOR_BOOKING_CONFIRMED",
    fromStatus: input.inquiry.status,
    toStatus: updated.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null,
      confirmationText
    }
  });

  const notificationContent = buildBookingConfirmedTravellerNotification({
    inquiry: updated,
    confirmationText
  });

  await createAssistantMessage({
    tenantId: updated.tenantId,
    conversationId: updated.conversationId,
    content: notificationContent
  });

  const whatsappNotification = await sendTravellerWhatsAppNotification({
    inquiry: updated,
    content: notificationContent
  });

  return {
    inquiry: updated,
    travellerNotification: whatsappNotification,
    operatorFollowUp: null
  };
}

function formatDeclineAlternatives(inquiry: BluePassInquiry) {
  const alternatives = findBluePassAlternativeYachts({
    destination: inquiry.destination ?? undefined,
    guests: inquiry.guests ?? undefined,
    declinedYachtSlug: inquiry.selectedYachtSlug
  });

  if (alternatives.length === 0) {
    return " BluePass will compare similar alternatives next and ask before dispatching the next operator inquiry.";
  }

  const optionLines = alternatives.map((alternative, index) => `${index + 1}. ${alternative.name}`).join("\n");
  const firstAlternative = alternatives[0]?.name ?? "the best match";

  return `\n\nSimilar BluePass options:\n${optionLines}\n\nReply "try ${firstAlternative}" to send that operator inquiry, or ask Kai to compare before BluePass dispatches another operator.`;
}

function formatTripSummary(inquiry: BluePassInquiry) {
  const parts = [
    inquiry.destination,
    inquiry.dateWindow,
    inquiry.guests ? `${inquiry.guests} guests` : null
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "your requested trip";
}

async function sendTravellerWhatsAppNotification(input: { inquiry: BluePassInquiry; content: string }) {
  const mode = resolveTravellerWhatsAppNotificationMode();
  if (mode === "disabled") {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SKIPPED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "traveller WhatsApp notification mode is not enabled"
      }
    });

    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null
    };
  }

  if (!input.inquiry.travellerPhone) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SKIPPED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: "traveller phone missing"
      }
    });

    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null,
      skippedReason: "traveller phone missing"
    };
  }

  try {
    const result = await sendTravellerWhatsAppNotificationByMode(input, mode);

    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        providerMessageId: result.providerMessageId,
        messageType: mode,
        templateName: mode === "template" ? resolveTravellerUpdateTemplateName() : null
      }
    });

    return {
      channel: "whatsapp" as const,
      sent: true,
      providerMessageId: result.providerMessageId
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Traveller WhatsApp notification failed.";

    if (mode === "text" && isWhatsAppReEngagementError(error)) {
      try {
        const result = await sendTravellerWhatsAppNotificationByMode(input, "template");

        await createBluePassInquiryEvent({
          inquiry: input.inquiry,
          type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
          fromStatus: input.inquiry.status,
          toStatus: input.inquiry.status,
          metadata: {
            providerMessageId: result.providerMessageId,
            messageType: "template",
            templateName: resolveTravellerUpdateTemplateName(),
            fallbackFrom: "text",
            fallbackReason: reason
          }
        });

        return {
          channel: "whatsapp" as const,
          sent: true,
          providerMessageId: result.providerMessageId
        };
      } catch (fallbackError) {
        const fallbackReason =
          fallbackError instanceof Error ? fallbackError.message : "Traveller WhatsApp template fallback failed.";

        await createBluePassInquiryEvent({
          inquiry: input.inquiry,
          type: "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED",
          fromStatus: input.inquiry.status,
          toStatus: input.inquiry.status,
          metadata: {
            reason: fallbackReason,
            fallbackFrom: "text",
            fallbackReason: reason
          }
        });

        return {
          channel: "conversation" as const,
          sent: true,
          providerMessageId: null,
          skippedReason: fallbackReason
        };
      }
    }

    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason
      }
    });

    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null,
      skippedReason: reason
    };
  }
}

function sendTravellerWhatsAppNotificationByMode(
  input: { inquiry: BluePassInquiry; content: string },
  mode: "text" | "template"
) {
  if (mode === "template") {
    return sendTemplateMessage({
      to: input.inquiry.travellerPhone ?? "",
      role: "kai",
      name: resolveTravellerUpdateTemplateName(),
      languageCode: resolveTravellerUpdateTemplateLanguage(),
      components: [
        {
          type: "body",
          parameters: buildTravellerInquiryUpdateParams({
            travellerName: input.inquiry.travellerName ?? "BluePass traveller",
            tripSummary: formatTripSummary(input.inquiry),
            operatorName: input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "BluePass operator",
            status: formatTravellerTemplateStatus(input.inquiry.status, input.content)
          }).map((text) => ({
            type: "text",
            text
          }))
        }
      ]
    });
  }

  return sendWhatsAppText({
    to: input.inquiry.travellerPhone ?? "",
    role: "kai",
    body: input.content
  });
}

function isWhatsAppReEngagementError(error: unknown) {
  return error instanceof Error && /\bcode=131047\b|re-engagement/i.test(error.message);
}

function shouldFallbackTravellerTemplateFromDeliveryStatus(
  input: RecordBluePassTravellerWhatsAppDeliveryStatusInput,
  sentMetadata: Prisma.JsonValue
) {
  if (input.status !== "failed") return false;
  if (!hasWhatsAppReEngagementStatusError(input.errors)) return false;
  if (!sentMetadata || typeof sentMetadata !== "object" || Array.isArray(sentMetadata)) return false;

  return sentMetadata.messageType === "text";
}

function hasWhatsAppReEngagementStatusError(
  errors?: Array<{ code?: number | null; title?: string | null; message?: string | null; details?: string | null }>
) {
  return Boolean(
    errors?.some(
      (error) =>
        error.code === 131047 ||
        /re-engagement/i.test(error.title ?? "") ||
        /more than 24 hours/i.test(error.message ?? "") ||
        /more than 24 hours/i.test(error.details ?? "")
    )
  );
}

async function resendTravellerTemplateAfterDeliveryFailure(input: {
  inquiry: BluePassInquiry;
  failedProviderMessageId: string;
  errors: Array<{ code?: number | null; title?: string | null; message?: string | null; details?: string | null }>;
}) {
  if (!input.inquiry.travellerPhone) return null;

  const content = buildDeliveryStatusFallbackTravellerContent(input.inquiry);

  try {
    const result = await sendTravellerWhatsAppNotificationByMode(
      {
        inquiry: input.inquiry,
        content
      },
      "template"
    );

    return createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        providerMessageId: result.providerMessageId,
        messageType: "template",
        templateName: resolveTravellerUpdateTemplateName(),
        fallbackFrom: "delivery_status_131047",
        failedProviderMessageId: input.failedProviderMessageId
      }
    });
  } catch (error) {
    return createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: error instanceof Error ? error.message : "Traveller WhatsApp template fallback failed.",
        fallbackFrom: "delivery_status_131047",
        failedProviderMessageId: input.failedProviderMessageId,
        errors: input.errors
      }
    });
  }
}

function buildDeliveryStatusFallbackTravellerContent(inquiry: BluePassInquiry) {
  if (inquiry.status === "DECLINED") {
    return buildOperatorResponseTravellerNotification({
      inquiry,
      action: "decline"
    });
  }

  if (inquiry.status === "OPERATOR_ACCEPTED") {
    return buildOperatorResponseTravellerNotification({
      inquiry,
      action: "accept",
      quoteUrl: buildBluePassQuoteUrl(inquiry.id)
    });
  }

  return `BluePass update for ${formatTripSummary(inquiry)}. Current status: ${formatStatusForReply(inquiry.status)}.`;
}

function resolveTravellerWhatsAppNotificationMode(): "disabled" | "text" | "template" {
  const configuredMode = process.env.WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE?.trim().toLowerCase();
  if (configuredMode === "text" || configuredMode === "template") return configuredMode;
  if (configuredMode) return "disabled";

  return process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
    process.env.WHATSAPP_PHONE_ID_KAI?.trim() &&
    process.env.META_GRAPH_VERSION?.trim()
    ? "text"
    : "disabled";
}

function resolveTravellerUpdateTemplateName() {
  return process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE?.trim() || whatsappTemplateNames.bluePassInquiryUpdate;
}

function resolveTravellerUpdateTemplateLanguage() {
  return process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE_LANGUAGE?.trim() || "en";
}

function formatTravellerTemplateStatus(status: BluePassInquiry["status"], content?: string) {
  const quoteUrl = extractQuoteUrl(content);
  const quoteSuffix = quoteUrl ? `. Quote: ${quoteUrl}` : "";

  if (status === "OPERATOR_ACCEPTED") return `Accepted by operator${quoteSuffix}`;
  if (status === "DECLINED") return formatDeclinedTravellerTemplateStatus(content);
  if (status === "COUNTER_OFFERED") return `Counter-offer received${quoteSuffix}`;

  return "Update received";
}

function formatDeclinedTravellerTemplateStatus(content?: string) {
  const alternatives = extractDeclineAlternativeNames(content);
  if (alternatives.length === 0) return "Not available. BluePass is checking similar options.";

  return `Not available. Similar options: ${alternatives.join(", ")}. Reply try ${alternatives[0]}.`;
}

function extractDeclineAlternativeNames(content?: string) {
  const alternativeSection = content?.match(/Similar BluePass options:\s*([\s\S]*?)(?:\n\s*\n|$)/i)?.[1];
  if (!alternativeSection) return [];

  return alternativeSection
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+\.\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function extractQuoteUrl(content?: string) {
  return content?.match(/\bQuote link:\s*(https?:\/\/\S+)/i)?.[1] ?? null;
}

async function requestOperatorCounterDetails(input: {
  inquiry: BluePassInquiry;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  const operatorPhone = input.operatorPhone ?? input.inquiry.operatorPhone;
  const prompt = [
    `Please reply with the counter-offer details for ${input.inquiry.travellerName ?? "this traveller"}'s ${input.inquiry.selectedYachtName ?? "BluePass"} inquiry.`,
    "",
    "Suggested format:",
    "Available 18 July 2026. Final price USD 3,900 per cabin/night. Includes meals, dives, crew, tanks and weights. Excludes flights, park fees, alcohol and tips. Condition: 30% deposit to hold.",
    "",
    "BluePass will attach your reply to the latest pending inquiry automatically."
  ].join("\n");

  await createBluePassInquiryEvent({
    inquiry: input.inquiry,
    type: "OPERATOR_COUNTER_DETAILS_REQUESTED",
    fromStatus: input.inquiry.status,
    toStatus: input.inquiry.status,
    metadata: {
      providerMessageId: input.providerMessageId ?? null,
      operatorPhone: input.operatorPhone ?? null
    }
  });

  if (!operatorPhone || process.env.WHATSAPP_OPERATOR_COUNTER_REQUEST_SEND_MODE !== "text") {
    return {
      requested: true,
      channel: "event" as const,
      sent: false,
      prompt
    };
  }

  try {
    const result = await sendWhatsAppText({
      to: operatorPhone,
      role: "ops",
      body: prompt
    });

    return {
      requested: true,
      channel: "whatsapp" as const,
      sent: true,
      providerMessageId: result.providerMessageId,
      prompt
    };
  } catch (error) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "OPERATOR_COUNTER_DETAILS_REQUEST_FAILED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: error instanceof Error ? error.message : "Operator counter detail request failed."
      }
    });

    return {
      requested: true,
      channel: "event" as const,
      sent: false,
      prompt,
      skippedReason: error instanceof Error ? error.message : "Operator counter detail request failed."
    };
  }
}

async function sendOperatorInquiryMessage(input: {
  mode: "template" | "text";
  to: string;
  templateName: string;
  languageCode: string;
  components: WhatsAppTemplateComponent[];
  textBody: string;
}): Promise<{
  messageKind: "template" | "text";
  providerMessageId: string | null;
}> {
  if (input.mode === "text") {
    const result = await sendWhatsAppText({
      to: input.to,
      role: "ops",
      body: input.textBody
    });

    return { messageKind: "text", providerMessageId: result.providerMessageId };
  }

  try {
    const result = await sendTemplateMessage({
      to: input.to,
      role: "ops",
      name: input.templateName,
      languageCode: input.languageCode,
      components: input.components
    });

    return { messageKind: "template", providerMessageId: result.providerMessageId };
  } catch {
    const result = await sendWhatsAppText({
      to: input.to,
      role: "ops",
      body: input.textBody
    });

    return { messageKind: "text", providerMessageId: result.providerMessageId };
  }
}

function buildOperatorInquiryTemplateInput(input: {
  inquiry: BluePassInquiry;
  operatorPhone: string;
}): OperatorInquiryTemplateInput {
  const inquiryTitle = [
    input.inquiry.destination,
    input.inquiry.tripType,
    input.inquiry.guests ? `${input.inquiry.guests} guests` : undefined
  ]
    .filter(Boolean)
    .join(" / ");
  const selectedYachtName = input.inquiry.selectedYachtName;
  const tripTitle = selectedYachtName
    ? `${selectedYachtName} inquiry`
    : `${input.inquiry.destination ?? "Indonesia"} inquiry`;
  const notes = [
    input.inquiry.notes,
    input.inquiry.selectedYachtSlug ? `Selected yacht: ${input.inquiry.selectedYachtSlug}` : undefined,
    input.inquiry.referralCode ? `Referral: ${formatReferralSource(input.inquiry.referralCode, input.inquiry.referralRole)}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");

  return {
    to: input.operatorPhone,
    bookingId: input.inquiry.id,
    inquiryTitle: inquiryTitle || "BluePass yacht inquiry",
    travellerName: input.inquiry.travellerName ?? "BluePass traveller",
    travellerPhone: input.inquiry.travellerPhone ?? "Not provided",
    dateRange: input.inquiry.dateWindow ?? "Not provided",
    guests: input.inquiry.guests ? String(input.inquiry.guests) : "Not provided",
    quote: input.inquiry.budget ?? "Quote requested",
    tripTitle,
    notes: notes || "No additional notes"
  };
}

function formatReferralSource(code: string, role?: string | null) {
  return role ? `${role.toLowerCase()} / ${code}` : code;
}
