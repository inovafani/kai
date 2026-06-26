import type { BluePassInquiry, Prisma } from "@prisma/client";
import { buildBluePassDispatchText } from "@/core/bluepass/dispatch";
import type { BluePassInquiryIntent } from "@/core/bluepass/intent";
import { calculateBluePassLedgerEstimate } from "@/core/bluepass/ledger";
import { prisma } from "@/lib/prisma";

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

  return dispatch;
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

function buildInquiryData(input: CreateOrReuseBluePassInquiryInput, existing?: BluePassInquiry) {
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
    operatorPhone: input.selectedYacht?.operatorPhone ?? existing?.operatorPhone,
    notes: input.notes ?? existing?.notes,
    travellerMessage: input.travellerMessage,
    referralPartnerId: input.referral?.referralPartnerId ?? existing?.referralPartnerId,
    referralLinkId: input.referral?.referralLinkId ?? existing?.referralLinkId,
    referralCode: input.referral?.referralCode ?? existing?.referralCode,
    referralRole: input.referral?.referralRole ?? existing?.referralRole
  };
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
