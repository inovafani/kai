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

const operatorResponsePattern = /^(accept|decline|counter):([^\s]+)(?:\s+([\s\S]+))?$/i;
const operatorTextActionMap: Record<string, BluePassOperatorResponseAction> = {
  accept: "accept",
  decline: "decline",
  counter: "counter",
  "counter-offer": "counter"
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
      if (!looksLikeCounterDetails(trimmedPayload)) return null;

      return {
        action: "counter",
        inquiryId: null,
        providerMessageId: message.id ?? null,
        operatorPhone: message.from ?? null,
        counterText: trimmedPayload
      };
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
    action: match[1].toLowerCase() as BluePassOperatorResponseAction,
    inquiryId: match[2],
    providerMessageId: message.id ?? null,
    operatorPhone: message.from ?? null,
    counterText: match[3]?.trim() || null
  };
}

function looksLikeCounterDetails(value: string) {
  const normalized = value.toLowerCase();
  const hasAvailability = /\b(?:available|unavailable|instead|alternative|can do)\b/.test(normalized);
  const hasCommercialDetails = /\b(?:price|usd|\$|includes?|excludes?|deposit|condition)\b/.test(normalized);

  return hasAvailability && hasCommercialDetails;
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
