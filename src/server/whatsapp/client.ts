import type { WhatsAppTemplateComponent } from "./operator-dispatch";

export type WhatsAppSenderRole = "kai" | "ops";

export type WhatsAppTemplateMessage = {
  to: string;
  name: string;
  languageCode?: string;
  role?: WhatsAppSenderRole;
  components?: WhatsAppTemplateComponent[];
};

export type WhatsAppTextMessage = {
  to: string;
  role?: WhatsAppSenderRole;
  body: string;
};

export type WhatsAppImageMessage = {
  to: string;
  role?: WhatsAppSenderRole;
  imageUrl: string;
  caption?: string;
};

export type WhatsAppTypingIndicatorMessage = {
  role?: WhatsAppSenderRole;
  messageId: string;
};

type WhatsAppTemplateApiPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: string };
    components?: WhatsAppTemplateComponent[];
  };
};

type WhatsAppTextApiPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "text";
  text: {
    preview_url: false;
    body: string;
  };
};

type WhatsAppImageApiPayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "image";
  image: {
    link: string;
    caption?: string;
  };
};

type WhatsAppTypingIndicatorApiPayload = {
  messaging_product: "whatsapp";
  status: "read";
  message_id: string;
  typing_indicator: {
    type: "text";
  };
};

type WhatsAppSendApiResponse = {
  messages?: Array<{ id?: string }>;
};

type WhatsAppErrorApiResponse = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
};

export type WhatsAppSendResult = {
  providerMessageId: string | null;
};

const defaultSendTimeoutMs = 10_000;

export function buildWhatsAppTemplatePayload(message: WhatsAppTemplateMessage): WhatsAppTemplateApiPayload {
  const payload: WhatsAppTemplateApiPayload = {
    messaging_product: "whatsapp",
    to: normalizeRecipientPhone(message.to),
    type: "template",
    template: {
      name: message.name.trim(),
      language: { code: message.languageCode?.trim() || "en" }
    }
  };

  if (!payload.template.name) {
    throw new Error("WhatsApp template name is required.");
  }

  if (message.components?.length) {
    payload.template.components = message.components;
  }

  return payload;
}

export async function sendTemplateMessage(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
  return postWhatsAppMessage(message.role ?? "kai", buildWhatsAppTemplatePayload(message));
}

export async function sendWhatsAppText(message: WhatsAppTextMessage): Promise<WhatsAppSendResult> {
  return postWhatsAppMessage(message.role ?? "kai", {
    messaging_product: "whatsapp",
    to: normalizeRecipientPhone(message.to),
    type: "text",
    text: {
      preview_url: false,
      body: message.body
    }
  });
}

export async function sendWhatsAppImage(message: WhatsAppImageMessage): Promise<WhatsAppSendResult> {
  const imageUrl = message.imageUrl.trim();
  if (!imageUrl) {
    throw new Error("WhatsApp image URL is required.");
  }

  const caption = message.caption?.trim();

  return postWhatsAppMessage(message.role ?? "kai", {
    messaging_product: "whatsapp",
    to: normalizeRecipientPhone(message.to),
    type: "image",
    image: caption ? { link: imageUrl, caption } : { link: imageUrl }
  });
}

export async function sendWhatsAppTypingIndicator(message: WhatsAppTypingIndicatorMessage): Promise<void> {
  const messageId = message.messageId.trim();
  if (!messageId) return;

  await postWhatsAppMessage(message.role ?? "kai", {
    messaging_product: "whatsapp",
    status: "read",
    message_id: messageId,
    typing_indicator: {
      type: "text"
    }
  });
}

export function resolveWhatsAppPhoneId(role: WhatsAppSenderRole) {
  const kaiPhoneId = presentEnvValue("WHATSAPP_PHONE_ID_KAI");

  if (role === "kai") {
    if (!kaiPhoneId) {
      throw new Error("WHATSAPP_PHONE_ID_KAI is required for Kai WhatsApp sends.");
    }

    return kaiPhoneId;
  }

  const opsPhoneId = presentEnvValue("WHATSAPP_PHONE_ID_OPS");
  if (opsPhoneId) return opsPhoneId;
  if (kaiPhoneId) return kaiPhoneId;

  throw new Error("WHATSAPP_PHONE_ID_OPS is not set and WHATSAPP_PHONE_ID_KAI fallback is unavailable for Ops WhatsApp sends.");
}

function presentEnvValue(name: string) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function requiredEnvValue(name: string) {
  const value = presentEnvValue(name);
  if (!value) {
    throw new Error(`${name} is required for WhatsApp sends.`);
  }

  return value;
}

function resolveMetaGraphVersion() {
  const version = requiredEnvValue("META_GRAPH_VERSION").replace(/^\/+/, "");
  return version.startsWith("v") ? version : `v${version}`;
}

function normalizeRecipientPhone(value: string) {
  const digits = value.trim().replace(/[^\d]/g, "");
  if (!digits) {
    throw new Error("WhatsApp recipient phone number is required.");
  }

  if (digits.startsWith("0")) {
    return `62${digits.slice(1)}`;
  }

  return digits;
}

function maskPhoneNumber(value: string) {
  const digits = normalizeRecipientPhone(value);
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;
}

async function postWhatsAppMessage(
  role: WhatsAppSenderRole,
  payload: WhatsAppTemplateApiPayload | WhatsAppTextApiPayload | WhatsAppImageApiPayload | WhatsAppTypingIndicatorApiPayload
): Promise<WhatsAppSendResult> {
  const phoneId = resolveWhatsAppPhoneId(role);
  const graphVersion = resolveMetaGraphVersion();
  const accessToken = requiredEnvValue("WHATSAPP_ACCESS_TOKEN");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), defaultSendTimeoutMs);

  try {
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const body = (await response.json().catch(() => undefined)) as
      | WhatsAppSendApiResponse
      | WhatsAppErrorApiResponse
      | undefined;

    if (!response.ok) {
      let message = "Meta Graph API rejected the WhatsApp send.";
      if (body && "error" in body) {
        const details = [
          body.error?.code ? `code=${body.error.code}` : undefined,
          body.error?.error_subcode ? `subcode=${body.error.error_subcode}` : undefined,
          body.error?.type ? `type=${body.error.type}` : undefined,
          body.error?.message ? `message=${body.error.message}` : undefined,
          body.error?.fbtrace_id ? `fbtrace_id=${body.error.fbtrace_id}` : undefined
        ].filter(Boolean);
        message = details.length > 0 ? `${message} ${details.join(" ")}` : message;
      }

      console.warn("whatsapp.send.failed", {
        role,
        status: response.status,
        to: "to" in payload ? maskPhoneNumber(payload.to) : undefined,
        type: "type" in payload ? payload.type : "typing_indicator",
        templateName: "type" in payload && payload.type === "template" ? payload.template.name : undefined
      });
      throw new Error(message);
    }

    return {
      providerMessageId: body && "messages" in body ? (body.messages?.[0]?.id ?? null) : null
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WhatsApp send timed out.");
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
