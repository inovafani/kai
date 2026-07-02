import type { BluePassInquiry, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type BluePassQuoteStatus = "NEEDS_FINAL_PRICE" | "READY_FOR_TRAVELLER" | "TRAVELLER_APPROVED";

export type BluePassQuote = {
  id: string;
  inquiryId: string;
  status: BluePassQuoteStatus;
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
  source: "operator_accept" | "operator_counter";
  quoteUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type BluePassQuoteMetadata = Omit<BluePassQuote, "createdAt" | "updatedAt">;

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
        where: { type: { in: ["BLUEPASS_QUOTE_DRAFTED", "BLUEPASS_QUOTE_APPROVED"] } },
        orderBy: { createdAt: "desc" }
      }
    }
  });

  if (!inquiry) return null;

  const quoteEvent = inquiry.events.find((event) => event.type === "BLUEPASS_QUOTE_DRAFTED");
  if (!quoteEvent || !isQuoteMetadata(quoteEvent.metadata)) return null;

  const approvedEvent = inquiry.events.find((event) => event.type === "BLUEPASS_QUOTE_APPROVED");
  const status: BluePassQuoteStatus = approvedEvent ? "TRAVELLER_APPROVED" : quoteEvent.metadata.status;

  return {
    ...quoteEvent.metadata,
    status,
    createdAt: quoteEvent.createdAt.toISOString(),
    updatedAt: (approvedEvent?.createdAt ?? quoteEvent.createdAt).toISOString()
  };
}

export async function approveBluePassQuote(input: { quoteId: string }) {
  const quote = await getBluePassQuote(input);
  if (!quote) {
    throw new Error(`BluePass quote ${input.quoteId} was not found.`);
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

function parsePrice(text?: string | null) {
  const match = text?.match(/\b(USD|IDR|EUR|AUD)?\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d{3,8})(?:\.\d{2})?\b/i);
  if (!match) return null;

  const currency = (match[1] ?? "USD").toUpperCase();
  const amount = Number.parseInt(match[2].replace(/,/g, ""), 10);
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
