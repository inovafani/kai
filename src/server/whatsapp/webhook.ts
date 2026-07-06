import type { BluePassOperatorResponseAction } from "@/server/bluepass/bluepass-inquiry-repository";

export type BluePassOperatorWebhookResponse = {
  inquiryId: string | null;
  action: BluePassOperatorResponseAction;
  counterText: string | null;
  providerMessageId: string | null;
  operatorPhone: string | null;
};

export type WhatsAppWebhookMessageStatus = {
  providerMessageId: string;
  status: string;
  timestamp: string | null;
  recipientId: string | null;
  errors: Array<{
    code: number | null;
    title: string | null;
    message: string | null;
    details: string | null;
  }>;
};

export type WhatsAppInboundTextMessage = {
  from: string;
  providerMessageId: string | null;
  body: string;
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppWebhookMessage[];
        statuses?: WhatsAppWebhookStatus[];
      };
    }>;
  }>;
};

type WhatsAppWebhookMessage = {
  from?: string;
  id?: string;
  type?: string;
  text?: {
    body?: string;
  };
  interactive?: {
    type?: string;
    button_reply?: {
      id?: string;
      title?: string;
    };
  };
  button?: {
    payload?: string;
    text?: string;
  };
};

type WhatsAppWebhookStatus = {
  id?: string;
  status?: string;
  timestamp?: string;
  recipient_id?: string;
  errors?: Array<{
    code?: number;
    title?: string;
    message?: string;
    error_data?: {
      details?: string;
    };
  }>;
};

const operatorResponsePattern =
  /^(accept|decline|counter|payment_ready|payment-ready|booking_confirmed|booking-confirmed):([^\s]+)(?:\s+([\s\S]+))?$/i;
const operatorTextActionMap: Record<string, BluePassOperatorResponseAction> = {
  accept: "accept",
  decline: "decline",
  counter: "counter",
  "counter-offer": "counter",
  "payment ready": "payment_ready",
  "payment-ready": "payment_ready",
  "payment_ready": "payment_ready",
  "booking confirmed": "booking_confirmed",
  "booking-confirmed": "booking_confirmed",
  "booking_confirmed": "booking_confirmed"
};

export function extractBluePassOperatorResponsesFromWhatsAppWebhook(payload: unknown): BluePassOperatorWebhookResponse[] {
  const messages = extractWhatsAppMessages(payload);

  return messages
    .map((message) => parseBluePassOperatorResponse(message))
    .filter((response): response is BluePassOperatorWebhookResponse => Boolean(response));
}

export function extractWhatsAppMessageStatusesFromWebhook(payload: unknown): WhatsAppWebhookMessageStatus[] {
  const statuses = extractWhatsAppStatuses(payload);

  return statuses
    .map((status) => normalizeWhatsAppStatus(status))
    .filter((status): status is WhatsAppWebhookMessageStatus => Boolean(status));
}

export function extractWhatsAppInboundTextMessagesFromWebhook(payload: unknown): WhatsAppInboundTextMessage[] {
  const messages = extractWhatsAppMessages(payload);

  return messages
    .map((message) => normalizeInboundTextMessage(message))
    .filter((message): message is WhatsAppInboundTextMessage => Boolean(message));
}

function extractWhatsAppMessages(payload: unknown): WhatsAppWebhookMessage[] {
  if (!payload || typeof payload !== "object") return [];

  const entries = (payload as WhatsAppWebhookPayload).entry;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) =>
    Array.isArray(entry.changes)
      ? entry.changes.flatMap((change) => (Array.isArray(change.value?.messages) ? change.value.messages : []))
      : []
  );
}

function extractWhatsAppStatuses(payload: unknown): WhatsAppWebhookStatus[] {
  if (!payload || typeof payload !== "object") return [];

  const entries = (payload as WhatsAppWebhookPayload).entry;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) =>
    Array.isArray(entry.changes)
      ? entry.changes.flatMap((change) => (Array.isArray(change.value?.statuses) ? change.value.statuses : []))
      : []
  );
}

function parseBluePassOperatorResponse(message: WhatsAppWebhookMessage): BluePassOperatorWebhookResponse | null {
  const payload = message.interactive?.button_reply?.id ?? message.button?.payload ?? message.button?.text ?? message.text?.body;
  if (!payload) return null;

  const match = payload.trim().match(operatorResponsePattern);
  if (!match) {
    const trimmedPayload = payload.trim();
    const action = operatorTextActionMap[trimmedPayload.toLowerCase()];
    if (!action) {
      if (looksLikeBookingConfirmationDetails(trimmedPayload)) {
        return {
          action: "booking_confirmed",
          inquiryId: null,
          providerMessageId: message.id ?? null,
          operatorPhone: message.from ?? null,
          counterText: trimmedPayload
        };
      }

      if (looksLikePaymentReadyDetails(trimmedPayload)) {
        return {
          action: "payment_ready",
          inquiryId: null,
          providerMessageId: message.id ?? null,
          operatorPhone: message.from ?? null,
          counterText: trimmedPayload
        };
      }

      if (looksLikeCounterDetails(trimmedPayload)) {
        return {
          action: "counter",
          inquiryId: null,
          providerMessageId: message.id ?? null,
          operatorPhone: message.from ?? null,
          counterText: trimmedPayload
        };
      }

      if (looksLikeAcceptDetails(trimmedPayload)) {
        return {
          action: "accept",
          inquiryId: null,
          providerMessageId: message.id ?? null,
          operatorPhone: message.from ?? null,
          counterText: null
        };
      }

      if (looksLikeDeclineDetails(trimmedPayload)) {
        return {
          action: "decline",
          inquiryId: null,
          providerMessageId: message.id ?? null,
          operatorPhone: message.from ?? null,
          counterText: null
        };
      }

      return null;
    }

    return {
      action,
      inquiryId: null,
      providerMessageId: message.id ?? null,
      operatorPhone: message.from ?? null,
      counterText: null
    };
  }

  return {
    action: normalizeOperatorAction(match[1]),
    inquiryId: match[2],
    providerMessageId: message.id ?? null,
    operatorPhone: message.from ?? null,
    counterText: match[3]?.trim() || null
  };
}

function normalizeInboundTextMessage(message: WhatsAppWebhookMessage): WhatsAppInboundTextMessage | null {
  const from = message.from?.trim();
  const body = message.text?.body?.trim();
  if (!from || !body) return null;

  return {
    from,
    providerMessageId: message.id ?? null,
    body
  };
}

function normalizeOperatorAction(value: string): BluePassOperatorResponseAction {
  const normalized = value.toLowerCase().replace(/-/g, "_");
  if (normalized === "payment_ready") return "payment_ready";
  if (normalized === "booking_confirmed") return "booking_confirmed";
  return normalized as BluePassOperatorResponseAction;
}

function looksLikeCounterDetails(value: string) {
  const normalized = value.toLowerCase();
  const hasAvailability = /\b(?:available|unavailable|instead|alternative|can do)\b/.test(normalized);
  const hasCommercialDetails = /\b(?:price|usd|\$|includes?|excludes?|deposit|condition)\b/.test(normalized);

  return hasAvailability && hasCommercialDetails;
}

function looksLikeAcceptDetails(value: string) {
  const normalized = value.toLowerCase();
  const hasAvailability = /\b(?:available|confirmed availability|can do|we can do|ok available|slot available)\b/.test(
    normalized
  );
  const hasDecline = /\b(?:not available|unavailable|full|sold out|cannot|can't|no slot)\b/.test(normalized);

  return hasAvailability && !hasDecline;
}

function looksLikeDeclineDetails(value: string) {
  const normalized = value.toLowerCase();

  return /\b(?:not available|unavailable|full|sold out|fully booked|cannot|can't|no slot|no availability)\b/.test(
    normalized
  );
}

function looksLikePaymentReadyDetails(value: string) {
  const normalized = value.toLowerCase();
  const hasHoldOrPayment = /\b(?:slot held|held|hold|slot on|payment link|pay\s?link|pay here|payment url|balance due|payment path)\b/.test(
    normalized
  );
  const hasBookingContext = /\b(?:booking reference|reference|ref|confirm(?:ation)?|payment|pay|deposit|balance)\b/.test(
    normalized
  );

  return hasHoldOrPayment && hasBookingContext;
}

function looksLikeBookingConfirmationDetails(value: string) {
  const normalized = value.toLowerCase();
  const hasConfirmation = /\b(?:booking confirmed|confirmed booking|reservation confirmed|confirmed|booking ok|booking okay|booking done)\b/.test(
    normalized
  );
  const hasPaymentOrReference = /\b(?:payment received|payment done|paid|booking reference|reference|ref|confirmation number)\b/.test(
    normalized
  );

  return hasConfirmation && hasPaymentOrReference;
}

function normalizeWhatsAppStatus(status: WhatsAppWebhookStatus): WhatsAppWebhookMessageStatus | null {
  const providerMessageId = status.id?.trim();
  const deliveryStatus = status.status?.trim();
  if (!providerMessageId || !deliveryStatus) return null;

  return {
    providerMessageId,
    status: deliveryStatus,
    timestamp: status.timestamp?.trim() || null,
    recipientId: status.recipient_id?.trim() || null,
    errors: Array.isArray(status.errors)
      ? status.errors.map((error) => ({
          code: typeof error.code === "number" ? error.code : null,
          title: error.title ?? null,
          message: error.message ?? null,
          details: error.error_data?.details ?? null
        }))
      : []
  };
}
