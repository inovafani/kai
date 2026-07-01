import type { BluePassOperatorResponseAction } from "@/server/bluepass/bluepass-inquiry-repository";

export type BluePassOperatorWebhookResponse = {
  inquiryId: string | null;
  action: BluePassOperatorResponseAction;
  counterText: string | null;
  providerMessageId: string | null;
  operatorPhone: string | null;
};

type WhatsAppWebhookPayload = {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WhatsAppWebhookMessage[];
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

function parseBluePassOperatorResponse(message: WhatsAppWebhookMessage): BluePassOperatorWebhookResponse | null {
  const payload = message.interactive?.button_reply?.id ?? message.button?.payload ?? message.button?.text ?? message.text?.body;
  if (!payload) return null;

  const match = payload.trim().match(operatorResponsePattern);
  if (!match) {
    const action = operatorTextActionMap[payload.trim().toLowerCase()];
    if (!action) return null;

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
