import { createHmac, timingSafeEqual } from "node:crypto";
import type { BluePassOperatorResponseAction } from "@/server/bluepass/bluepass-inquiry-repository";

export type BluePassOperatorWebhookResponse = {
  inquiryId: string | null;
  action: BluePassOperatorResponseAction;
  counterText: string | null;
  providerMessageId: string | null;
  operatorPhone: string | null;
};

export type BluePassTravellerWebhookMessage = {
  fromPhone: string;
  content: string;
  providerMessageId: string | null;
  phoneNumberId: string | null;
};

export type WhatsAppHumanAgentEcho = {
  customerPhone: string;
  providerMessageId: string | null;
};

export type WhatsAppWebhookRoutingOptions = {
  /**
   * The Kai concierge phone number id (WHATSAPP_PHONE_ID_KAI). When webhook
   * metadata carries a phone_number_id, messages arriving on the Kai number
   * are always traveller messages and never operator responses — this keeps a
   * traveller who happens to type "available ... price" out of the operator
   * counter-offer parser. Without metadata (or without the id configured),
   * routing falls back to payload shape.
   */
  kaiPhoneNumberId?: string | null;
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
        metadata?: {
          phone_number_id?: string;
        };
        messages?: WhatsAppWebhookMessage[];
        message_echoes?: WhatsAppWebhookEchoMessage[];
        statuses?: WhatsAppWebhookStatus[];
      };
    }>;
  }>;
};

type WhatsAppWebhookEchoMessage = {
  id?: string;
  to?: string;
  type?: string;
  text?: {
    body?: string;
  };
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

export function extractBluePassOperatorResponsesFromWhatsAppWebhook(
  payload: unknown,
  options?: WhatsAppWebhookRoutingOptions
): BluePassOperatorWebhookResponse[] {
  const kaiPhoneNumberId = options?.kaiPhoneNumberId?.trim() || null;

  return extractWhatsAppMessages(payload)
    .filter(({ phoneNumberId }) => !isKaiNumberMessage(phoneNumberId, kaiPhoneNumberId))
    .map(({ message }) => parseBluePassOperatorResponse(message))
    .filter((response): response is BluePassOperatorWebhookResponse => Boolean(response));
}

export function extractBluePassTravellerMessagesFromWhatsAppWebhook(
  payload: unknown,
  options?: WhatsAppWebhookRoutingOptions
): BluePassTravellerWebhookMessage[] {
  const kaiPhoneNumberId = options?.kaiPhoneNumberId?.trim() || null;

  return extractWhatsAppMessages(payload)
    .map(({ message, phoneNumberId }) => {
      const content = extractInboundMessageText(message);
      if (!content || !message.from) return null;

      // On a known non-Kai number (the ops line), inbound is never a
      // traveller conversation.
      if (kaiPhoneNumberId && phoneNumberId && phoneNumberId !== kaiPhoneNumberId) return null;

      // Without number routing, anything shaped like an operator response
      // belongs to the operator path.
      if (!isKaiNumberMessage(phoneNumberId, kaiPhoneNumberId) && parseBluePassOperatorResponse(message)) {
        return null;
      }

      return {
        fromPhone: message.from,
        content,
        providerMessageId: message.id ?? null,
        phoneNumberId
      };
    })
    .filter((message): message is BluePassTravellerWebhookMessage => Boolean(message));
}

/**
 * Business-app coexistence: when a human answers a chat from the WhatsApp
 * Business phone app, Meta echoes that send to the webhook (field
 * "smb_message_echoes"). The echo's `to` is the customer the human replied to.
 */
export function extractWhatsAppHumanAgentEchoesFromWebhook(payload: unknown): WhatsAppHumanAgentEcho[] {
  if (!payload || typeof payload !== "object") return [];

  const entries = (payload as WhatsAppWebhookPayload).entry;
  if (!Array.isArray(entries)) return [];

  return entries
    .flatMap((entry) =>
      Array.isArray(entry.changes)
        ? entry.changes.flatMap((change) =>
            Array.isArray(change.value?.message_echoes) ? change.value.message_echoes : []
          )
        : []
    )
    .map((echo) => {
      const customerPhone = echo.to?.trim();
      if (!customerPhone) return null;

      return {
        customerPhone,
        providerMessageId: echo.id ?? null
      };
    })
    .filter((echo): echo is WhatsAppHumanAgentEcho => Boolean(echo));
}

/**
 * Validate Meta's X-Hub-Signature-256 header — HMAC-SHA256 of the raw request
 * body with the app secret.
 */
export function verifyWhatsAppWebhookSignature(input: {
  rawBody: string;
  signatureHeader: string | null;
  appSecret: string;
}): boolean {
  if (!input.signatureHeader?.startsWith("sha256=")) return false;

  const expected = createHmac("sha256", input.appSecret).update(input.rawBody, "utf8").digest("hex");
  const received = input.signatureHeader.slice("sha256=".length);
  if (received.length !== expected.length) return false;

  return timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

function isKaiNumberMessage(phoneNumberId: string | null, kaiPhoneNumberId: string | null) {
  return Boolean(kaiPhoneNumberId && phoneNumberId && phoneNumberId === kaiPhoneNumberId);
}

function extractInboundMessageText(message: WhatsAppWebhookMessage): string | null {
  const text =
    message.text?.body ?? message.interactive?.button_reply?.title ?? message.button?.text ?? null;
  const trimmed = text?.trim();

  return trimmed || null;
}

export function extractWhatsAppMessageStatusesFromWebhook(payload: unknown): WhatsAppWebhookMessageStatus[] {
  const statuses = extractWhatsAppStatuses(payload);

  return statuses
    .map((status) => normalizeWhatsAppStatus(status))
    .filter((status): status is WhatsAppWebhookMessageStatus => Boolean(status));
}

function extractWhatsAppMessages(payload: unknown): Array<{
  message: WhatsAppWebhookMessage;
  phoneNumberId: string | null;
}> {
  if (!payload || typeof payload !== "object") return [];

  const entries = (payload as WhatsAppWebhookPayload).entry;
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) =>
    Array.isArray(entry.changes)
      ? entry.changes.flatMap((change) => {
          const phoneNumberId = change.value?.metadata?.phone_number_id?.trim() || null;

          return Array.isArray(change.value?.messages)
            ? change.value.messages.map((message) => ({ message, phoneNumberId }))
            : [];
        })
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
