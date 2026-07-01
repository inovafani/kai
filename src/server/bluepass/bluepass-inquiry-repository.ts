import type { BluePassInquiry, Prisma } from "@prisma/client";
import { buildBluePassDispatchText } from "@/core/bluepass/dispatch";
import type { BluePassInquiryIntent } from "@/core/bluepass/intent";
import { calculateBluePassLedgerEstimate } from "@/core/bluepass/ledger";
import { prisma } from "@/lib/prisma";
import { createAssistantMessage } from "@/server/conversation/conversation-repository";
import { sendTemplateMessage, sendWhatsAppText } from "@/server/whatsapp/client";
import {
  buildOperatorInquiryFreeText,
  buildOperatorInquiryTemplatePayload,
  type WhatsAppTemplateComponent
} from "@/server/whatsapp/operator-dispatch";
import { whatsappTemplateNames, type OperatorInquiryTemplateInput } from "@/server/whatsapp/templates";

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
  notes?: string | null;
};

export type BluePassOperatorResponseAction = "accept" | "decline" | "counter";

export type HandleBluePassOperatorResponseInput = {
  inquiryId: string;
  action: BluePassOperatorResponseAction;
  counterText?: string | null;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
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
      data: buildInquiryData(input, existing)
    });

    await createBluePassInquiryEvent({
      inquiry,
      type: "INQUIRY_UPDATED",
      fromStatus: existing.status,
      toStatus: inquiry.status
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
      ...buildInquiryData(input)
    }
  });

  await createBluePassInquiryEvent({
    inquiry,
    type: "INQUIRY_CREATED",
    fromStatus: null,
    toStatus: inquiry.status
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

  const nextStatus = resolveOperatorResponseStatus(input.action);
  const eventType = resolveOperatorResponseEventType(input.action);
  const notificationContent = buildOperatorResponseTravellerNotification({
    inquiry,
    action: input.action,
    counterText: input.counterText
  });
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
        status: { in: ["READY_TO_DISPATCH", "OPERATOR_PENDING", "COUNTER_OFFERED"] }
      }
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      bluePassInquiryId: true
    }
  });

  return dispatch?.bluePassInquiryId ?? null;
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

function buildInquiryData(input: CreateOrReuseBluePassInquiryInput, existing?: BluePassInquiry) {
  const operatorPhone = resolveBluePassOperatorPhone(input.selectedYacht?.operatorPhone, existing?.operatorPhone);

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
    selectedYachtSlug: input.selectedYacht?.slug ?? existing?.selectedYachtSlug,
    selectedYachtName: input.selectedYacht?.name ?? existing?.selectedYachtName,
    operatorId: input.selectedYacht?.operatorId ?? existing?.operatorId,
    operatorName: input.selectedYacht?.operatorName ?? existing?.operatorName,
    operatorPhone,
    notes: input.notes ?? existing?.notes,
    travellerMessage: input.travellerMessage,
    referralPartnerId: input.referral?.referralPartnerId ?? existing?.referralPartnerId,
    referralLinkId: input.referral?.referralLinkId ?? existing?.referralLinkId,
    referralCode: input.referral?.referralCode ?? existing?.referralCode,
    referralRole: input.referral?.referralRole ?? existing?.referralRole
  };
}

function resolveBluePassOperatorPhone(selectedOperatorPhone?: string | null, existingOperatorPhone?: string | null) {
  return process.env.BLUEPASS_TEST_OPERATOR_PHONE?.trim() || selectedOperatorPhone || existingOperatorPhone;
}

function buildOperatorPhoneCandidates(value?: string | null) {
  const raw = value?.trim();
  if (!raw) return [];

  const digits = raw.replace(/\D/g, "");
  return Array.from(new Set([raw, digits, digits ? `+${digits}` : ""])).filter(Boolean);
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
  action: BluePassOperatorResponseAction;
  counterText?: string | null;
}) {
  const yachtName = input.inquiry.selectedYachtName ?? input.inquiry.operatorName ?? "the operator";

  if (input.action === "accept") {
    return `${yachtName} accepted your BluePass inquiry for ${formatTripSummary(input.inquiry)}. This is still not a confirmed booking yet; BluePass will follow up with the final quote, payment path, and operator confirmation.`;
  }

  if (input.action === "decline") {
    return `${yachtName} is not available for ${formatTripSummary(input.inquiry)}. BluePass will compare 2-3 similar alternatives and ask your permission before dispatching the next operator inquiry.`;
  }

  const counterText = input.counterText?.trim();
  const details = counterText ? ` Details: ${counterText}` : " BluePass needs the operator's counter details before this becomes actionable.";

  return `${yachtName} sent a counter-offer for ${formatTripSummary(input.inquiry)}.${details} You can accept the counter, negotiate, or compare alternatives with BluePass.`;
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
  if (!shouldSendTravellerWhatsAppNotification()) {
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
    const result = await sendWhatsAppText({
      to: input.inquiry.travellerPhone,
      role: "kai",
      body: input.content
    });

    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_SENT",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        providerMessageId: result.providerMessageId
      }
    });

    return {
      channel: "whatsapp" as const,
      sent: true,
      providerMessageId: result.providerMessageId
    };
  } catch (error) {
    await createBluePassInquiryEvent({
      inquiry: input.inquiry,
      type: "TRAVELLER_WHATSAPP_NOTIFICATION_FAILED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: {
        reason: error instanceof Error ? error.message : "Traveller WhatsApp notification failed."
      }
    });

    return {
      channel: "conversation" as const,
      sent: true,
      providerMessageId: null,
      skippedReason: error instanceof Error ? error.message : "Traveller WhatsApp notification failed."
    };
  }
}

function shouldSendTravellerWhatsAppNotification() {
  const configuredMode = process.env.WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE?.trim();
  if (configuredMode) return configuredMode === "text";

  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN?.trim() &&
      process.env.WHATSAPP_PHONE_ID_KAI?.trim() &&
      process.env.META_GRAPH_VERSION?.trim()
  );
}

async function requestOperatorCounterDetails(input: {
  inquiry: BluePassInquiry;
  providerMessageId?: string | null;
  operatorPhone?: string | null;
}) {
  const operatorPhone = input.operatorPhone ?? input.inquiry.operatorPhone;
  const prompt = `Please reply with counter details for BluePass inquiry ${input.inquiry.id} in this format:\n\ncounter:${input.inquiry.id} <dates, price, inclusions/exclusions, and any changed conditions>`;

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
