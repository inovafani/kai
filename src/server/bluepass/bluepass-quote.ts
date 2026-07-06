import type { BluePassInquiry, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendTemplateMessage, sendWhatsAppText } from "@/server/whatsapp/client";
import { buildTravellerInquiryUpdateParams, whatsappTemplateNames } from "@/server/whatsapp/templates";

export type BluePassQuoteStatus = "NEEDS_FINAL_PRICE" | "READY_FOR_TRAVELLER" | "TRAVELLER_APPROVED";
export type BluePassQuoteOperationalStatus = BluePassQuoteStatus | "PAYMENT_READY" | "BOOKING_CONFIRMED";

export type BluePassQuote = {
  id: string;
  inquiryId: string;
  status: BluePassQuoteStatus;
  operationalStatus: BluePassQuoteOperationalStatus;
  selectedYachtName: string | null;
  operatorName: string | null;
  destination: string | null;
  dateWindow: string | null;
  guests: number | null;
  currency: string;
  grossPriceCents: number | null;
  conservationContributionCents: number | null;
  inclusions: string | null;
  exclusions: string | null;
  terms: string | null;
  paymentText: string | null;
  confirmationText: string | null;
  source: "operator_accept" | "operator_counter";
  quoteUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type BluePassQuoteMetadata = Omit<
  BluePassQuote,
  "createdAt" | "updatedAt" | "operationalStatus" | "paymentText" | "confirmationText"
>;

export async function createBluePassQuoteDraftForOperatorResponse(input: {
  inquiry: BluePassInquiry;
  action: "accept" | "counter";
  counterText?: string | null;
}) {
  if (input.action === "accept") {
    return createQuoteEvent({
      inquiry: input.inquiry,
      metadata: buildAcceptedQuoteMetadata(input.inquiry)
    });
  }

  return createQuoteEvent({
    inquiry: input.inquiry,
    metadata: buildCounterQuoteMetadata(input.inquiry, input.counterText)
  });
}

export async function getBluePassQuote(input: { quoteId: string }) {
  const inquiry = await prisma.bluePassInquiry.findUnique({
    where: { id: input.quoteId },
    include: {
      events: {
        where: {
          type: {
            in: ["BLUEPASS_QUOTE_DRAFTED", "BLUEPASS_QUOTE_APPROVED", "OPERATOR_PAYMENT_READY", "OPERATOR_BOOKING_CONFIRMED"]
          }
        },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!inquiry) return null;

  const quoteEvent = inquiry.events.find((event) => event.type === "BLUEPASS_QUOTE_DRAFTED");
  if (!quoteEvent || !isQuoteMetadata(quoteEvent.metadata)) return null;

  const approvedEvent = inquiry.events.find((event) => event.type === "BLUEPASS_QUOTE_APPROVED");
  const paymentReadyEvent = inquiry.events.find((event) => event.type === "OPERATOR_PAYMENT_READY");
  const bookingConfirmedEvent = inquiry.events.find((event) => event.type === "OPERATOR_BOOKING_CONFIRMED");
  const status: BluePassQuoteStatus = approvedEvent ? "TRAVELLER_APPROVED" : quoteEvent.metadata.status;
  const operationalStatus = resolveQuoteOperationalStatus({
    status,
    paymentReady: Boolean(paymentReadyEvent),
    bookingConfirmed: Boolean(bookingConfirmedEvent)
  });

  return {
    ...quoteEvent.metadata,
    status,
    operationalStatus,
    paymentText: getMetadataString(paymentReadyEvent?.metadata, "paymentText"),
    confirmationText: getMetadataString(bookingConfirmedEvent?.metadata, "confirmationText"),
    createdAt: quoteEvent.createdAt.toISOString(),
    updatedAt: (bookingConfirmedEvent?.createdAt ?? paymentReadyEvent?.createdAt ?? approvedEvent?.createdAt ?? quoteEvent.createdAt).toISOString()
  };
}

export async function approveBluePassQuote(input: { quoteId: string }) {
  const quote = await getBluePassQuote(input);
  if (!quote) {
    throw new Error(`BluePass quote ${input.quoteId} was not found.`);
  }

  if (quote.status === "TRAVELLER_APPROVED") {
    return quote;
  }

  const inquiry = await prisma.bluePassInquiry.findUniqueOrThrow({
    where: { id: input.quoteId }
  });

  await prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: inquiry.tenantId,
      conversationId: inquiry.conversationId,
      bluePassInquiryId: inquiry.id,
      type: "BLUEPASS_QUOTE_APPROVED",
      fromStatus: inquiry.status,
      toStatus: inquiry.status,
      metadata: {
        quoteId: quote.id,
        previousQuoteStatus: quote.status,
        nextQuoteStatus: "TRAVELLER_APPROVED"
      }
    }
  });

  await notifyOperatorQuoteApproved({ inquiry, quote });
  await notifyTravellerQuoteApproved({ inquiry, quote });

  return getBluePassQuote(input);
}

function buildAcceptedQuoteMetadata(inquiry: BluePassInquiry): BluePassQuoteMetadata {
  const price = parsePrice(inquiry.budget);

  return {
    id: inquiry.id,
    inquiryId: inquiry.id,
    status: price ? "READY_FOR_TRAVELLER" : "NEEDS_FINAL_PRICE",
    selectedYachtName: inquiry.selectedYachtName,
    operatorName: inquiry.operatorName,
    destination: inquiry.destination,
    dateWindow: inquiry.dateWindow,
    guests: inquiry.guests,
    currency: price?.currency ?? "USD",
    grossPriceCents: price?.grossPriceCents ?? null,
    conservationContributionCents: price ? Math.round(price.grossPriceCents * 0.05) : null,
    inclusions: null,
    exclusions: null,
    terms: null,
    source: "operator_accept",
    quoteUrl: buildQuoteUrl(inquiry.id)
  };
}

function buildCounterQuoteMetadata(inquiry: BluePassInquiry, counterText?: string | null): BluePassQuoteMetadata {
  const text = counterText?.trim() ?? "";
  const price = parsePrice(text);

  return {
    id: inquiry.id,
    inquiryId: inquiry.id,
    status: price ? "READY_FOR_TRAVELLER" : "NEEDS_FINAL_PRICE",
    selectedYachtName: inquiry.selectedYachtName,
    operatorName: inquiry.operatorName,
    destination: inquiry.destination,
    dateWindow: parseCounterDate(text) ?? inquiry.dateWindow,
    guests: inquiry.guests,
    currency: price?.currency ?? "USD",
    grossPriceCents: price?.grossPriceCents ?? null,
    conservationContributionCents: price ? Math.round(price.grossPriceCents * 0.05) : null,
    inclusions: parseSection(text, "includes", ["excludes", "condition"]),
    exclusions: parseSection(text, "excludes", ["condition"]),
    terms: parseTerms(text),
    source: "operator_counter",
    quoteUrl: buildQuoteUrl(inquiry.id)
  };
}

async function createQuoteEvent(input: { inquiry: BluePassInquiry; metadata: BluePassQuoteMetadata }) {
  return prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: input.inquiry.tenantId,
      conversationId: input.inquiry.conversationId,
      bluePassInquiryId: input.inquiry.id,
      type: "BLUEPASS_QUOTE_DRAFTED",
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: input.metadata as unknown as Prisma.InputJsonObject
    }
  });
}

async function notifyOperatorQuoteApproved(input: { inquiry: BluePassInquiry; quote: BluePassQuote }) {
  if (!input.inquiry.operatorPhone) {
    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_OPERATOR_NOTIFICATION_SKIPPED",
      metadata: { reason: "operator phone missing", quoteId: input.quote.id }
    });
    return;
  }

  if (!hasWhatsAppCredentials("ops")) {
    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_OPERATOR_NOTIFICATION_SKIPPED",
      metadata: { reason: "operator WhatsApp credentials missing", quoteId: input.quote.id }
    });
    return;
  }

  const body = [
    `${input.inquiry.travellerName ?? "The traveller"} approved the BluePass quote for ${formatQuoteTrip(input.quote)}.`,
    "Please hold the slot and send BluePass the payment path and final operator confirmation instructions.",
    input.quote.quoteUrl ? `Quote: ${input.quote.quoteUrl}` : null
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await sendWhatsAppText({
      to: input.inquiry.operatorPhone,
      role: "ops",
      body
    });

    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_OPERATOR_NOTIFICATION_SENT",
      metadata: {
        quoteId: input.quote.id,
        providerMessageId: result.providerMessageId,
        operatorPhone: input.inquiry.operatorPhone
      }
    });
  } catch (error) {
    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_OPERATOR_NOTIFICATION_FAILED",
      metadata: {
        quoteId: input.quote.id,
        reason: error instanceof Error ? error.message : "Operator quote approval notification failed."
      }
    });
  }
}

async function notifyTravellerQuoteApproved(input: { inquiry: BluePassInquiry; quote: BluePassQuote }) {
  if (!input.inquiry.travellerPhone) {
    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_TRAVELLER_NOTIFICATION_SKIPPED",
      metadata: { reason: "traveller phone missing", quoteId: input.quote.id }
    });
    return;
  }

  if (!hasWhatsAppCredentials("kai")) {
    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_TRAVELLER_NOTIFICATION_SKIPPED",
      metadata: { reason: "traveller WhatsApp credentials missing", quoteId: input.quote.id }
    });
    return;
  }

  const body = [
    `Your BluePass quote for ${input.quote.selectedYachtName ?? input.quote.operatorName ?? "your trip"} is approved.`,
    "BluePass is now coordinating the payment path and final operator confirmation.",
    "This is still not a confirmed booking until payment and final operator confirmation are complete."
  ].join(" ");

  try {
    const mode = resolveTravellerQuoteApprovalSendMode();
    const result =
      mode === "template"
        ? await sendTemplateMessage({
            to: input.inquiry.travellerPhone,
            role: "kai",
            name: process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE?.trim() || whatsappTemplateNames.bluePassInquiryUpdate,
            languageCode: process.env.WHATSAPP_TRAVELLER_UPDATE_TEMPLATE_LANGUAGE?.trim() || "en",
            components: [
              {
                type: "body",
                parameters: buildTravellerInquiryUpdateParams({
                  travellerName: input.inquiry.travellerName ?? "BluePass traveller",
                  tripSummary: formatQuoteTrip(input.quote),
                  operatorName: input.quote.selectedYachtName ?? input.quote.operatorName ?? "BluePass operator",
                  status: "Quote approved. BluePass is coordinating payment and final operator confirmation."
                }).map((text) => ({ type: "text", text }))
              }
            ]
          })
        : await sendWhatsAppText({
            to: input.inquiry.travellerPhone,
            role: "kai",
            body
          });

    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_TRAVELLER_NOTIFICATION_SENT",
      metadata: {
        quoteId: input.quote.id,
        providerMessageId: result.providerMessageId,
        travellerPhone: input.inquiry.travellerPhone,
        messageType: mode
      }
    });
  } catch (error) {
    await createQuoteApprovalNotificationEvent({
      inquiry: input.inquiry,
      type: "QUOTE_APPROVAL_TRAVELLER_NOTIFICATION_FAILED",
      metadata: {
        quoteId: input.quote.id,
        reason: error instanceof Error ? error.message : "Traveller quote approval notification failed."
      }
    });
  }
}

async function createQuoteApprovalNotificationEvent(input: {
  inquiry: BluePassInquiry;
  type: string;
  metadata: Prisma.InputJsonObject;
}) {
  await prisma.bluePassInquiryEvent.create({
    data: {
      tenantId: input.inquiry.tenantId,
      conversationId: input.inquiry.conversationId,
      bluePassInquiryId: input.inquiry.id,
      type: input.type,
      fromStatus: input.inquiry.status,
      toStatus: input.inquiry.status,
      metadata: input.metadata
    }
  });
}

function hasWhatsAppCredentials(role: "kai" | "ops") {
  const hasBaseCredentials =
    Boolean(process.env.WHATSAPP_ACCESS_TOKEN?.trim()) && Boolean(process.env.META_GRAPH_VERSION?.trim());
  if (!hasBaseCredentials) return false;
  if (role === "kai") return Boolean(process.env.WHATSAPP_PHONE_ID_KAI?.trim());
  return Boolean(process.env.WHATSAPP_PHONE_ID_OPS?.trim() || process.env.WHATSAPP_PHONE_ID_KAI?.trim());
}

function resolveTravellerQuoteApprovalSendMode(): "text" | "template" {
  return process.env.WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE?.trim().toLowerCase() === "template" ? "template" : "text";
}

function resolveQuoteOperationalStatus(input: {
  status: BluePassQuoteStatus;
  paymentReady: boolean;
  bookingConfirmed: boolean;
}): BluePassQuoteOperationalStatus {
  if (input.bookingConfirmed) return "BOOKING_CONFIRMED";
  if (input.paymentReady) return "PAYMENT_READY";
  return input.status;
}

function getMetadataString(metadata: Prisma.JsonValue | undefined, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function formatQuoteTrip(quote: BluePassQuote) {
  const parts = [
    quote.destination,
    quote.dateWindow,
    quote.guests ? `${quote.guests} guests` : null,
    quote.selectedYachtName ?? quote.operatorName
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "the requested trip";
}

function parsePrice(text?: string | null) {
  const match =
    text?.match(/\b(?:final\s+price|price|quote)\s*(?:is|:)?\s*(USD|IDR|EUR|AUD)?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,8})(?:\.\d{2})?\b/i) ??
    text?.match(/\b(USD|IDR|EUR|AUD)\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,8})(?:\.\d{2})?\b/i) ??
    text?.match(/\$\s*(\d{1,3}(?:,\d{3})+|\d{3,8})(?:\.\d{2})?\b/i);
  if (!match) return null;

  const currency = (match.length > 2 ? match[1] : "USD")?.toUpperCase() || "USD";
  const amountText = match.length > 2 ? match[2] : match[1];
  const amount = Number.parseInt(amountText.replace(/,/g, ""), 10);
  if (!Number.isFinite(amount)) return null;

  return {
    currency,
    grossPriceCents: amount * 100
  };
}

function parseCounterDate(text: string) {
  const availableMatch = text.match(
    /\bAvailable\s+(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)(?:\s+\d{4})?/i
  );

  if (!availableMatch) return null;

  return `${Number(availableMatch[1])} ${titleCase(availableMatch[2])}`;
}

function parseSection(text: string, startKeyword: string, stopKeywords: string[]) {
  const start = text.toLowerCase().indexOf(startKeyword.toLowerCase());
  if (start < 0) return null;

  const sectionStart = start + startKeyword.length;
  const lowerTail = text.slice(sectionStart).toLowerCase();
  const stops = stopKeywords
    .map((keyword) => lowerTail.indexOf(keyword.toLowerCase()))
    .filter((index) => index >= 0);
  const sectionEnd = stops.length > 0 ? sectionStart + Math.min(...stops) : text.length;

  return cleanSection(text.slice(sectionStart, sectionEnd));
}

function parseTerms(text: string) {
  const conditionMatch = text.match(/\bCondition:\s*(.+)$/i);
  return conditionMatch ? cleanSection(conditionMatch[1]) : null;
}

function cleanSection(value: string) {
  const cleaned = value.replace(/^[\s:.,-]+/, "").replace(/[\s.]+$/, "").trim();
  return cleaned || null;
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1).toLowerCase();
}

function buildQuoteUrl(quoteId: string) {
  const baseUrl =
    process.env.BLUEPASS_APP_URL?.trim() || process.env.NEXT_PUBLIC_BLUEPASS_APP_URL?.trim() || "https://bluepass.co";
  return `${baseUrl.replace(/\/$/, "")}/quotes/${quoteId}`;
}

function isQuoteMetadata(value: Prisma.JsonValue): value is BluePassQuoteMetadata {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.id === "string" &&
    typeof value.inquiryId === "string" &&
    (value.status === "NEEDS_FINAL_PRICE" ||
      value.status === "READY_FOR_TRAVELLER" ||
      value.status === "TRAVELLER_APPROVED")
  );
}
