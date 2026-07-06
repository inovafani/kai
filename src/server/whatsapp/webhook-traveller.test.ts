import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  extractBluePassOperatorResponsesFromWhatsAppWebhook,
  extractBluePassTravellerMessagesFromWhatsAppWebhook,
  extractWhatsAppHumanAgentEchoesFromWebhook,
  verifyWhatsAppWebhookSignature
} from "./webhook";

const KAI_PHONE_ID = "111111111111111";
const OPS_PHONE_ID = "222222222222222";

function buildWebhookPayload(input: {
  phoneNumberId?: string;
  messages?: unknown[];
  messageEchoes?: unknown[];
}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "0",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              ...(input.phoneNumberId ? { metadata: { phone_number_id: input.phoneNumberId } } : {}),
              ...(input.messages ? { messages: input.messages } : {}),
              ...(input.messageEchoes ? { message_echoes: input.messageEchoes } : {})
            }
          }
        ]
      }
    ]
  };
}

function textMessage(overrides: Record<string, unknown> = {}) {
  return {
    from: "6281234567890",
    id: "wamid.traveller_1",
    type: "text",
    text: { body: "hi, we want to dive Komodo in March" },
    ...overrides
  };
}

describe("extractBluePassTravellerMessagesFromWhatsAppWebhook", () => {
  it("extracts a plain text message as a traveller message", () => {
    const payload = buildWebhookPayload({ messages: [textMessage()] });

    const messages = extractBluePassTravellerMessagesFromWhatsAppWebhook(payload);

    expect(messages).toEqual([
      {
        fromPhone: "6281234567890",
        content: "hi, we want to dive Komodo in March",
        providerMessageId: "wamid.traveller_1",
        phoneNumberId: null
      }
    ]);
  });

  it("extracts button and interactive reply titles", () => {
    const payload = buildWebhookPayload({
      messages: [
        textMessage({ text: undefined, type: "button", button: { text: "I'm planning a trip" } }),
        textMessage({
          id: "wamid.traveller_2",
          text: undefined,
          type: "interactive",
          interactive: { type: "button_reply", button_reply: { id: "chip_1", title: "I run trips or charters" } }
        })
      ]
    });

    const messages = extractBluePassTravellerMessagesFromWhatsAppWebhook(payload);

    expect(messages.map((message) => message.content)).toEqual([
      "I'm planning a trip",
      "I run trips or charters"
    ]);
  });

  it("leaves operator-shaped payloads to the operator path when no number routing exists", () => {
    const payload = buildWebhookPayload({
      messages: [textMessage({ text: { body: "accept:inquiry_123" } })]
    });

    expect(extractBluePassTravellerMessagesFromWhatsAppWebhook(payload)).toEqual([]);
    expect(extractBluePassOperatorResponsesFromWhatsAppWebhook(payload)).toHaveLength(1);
  });

  it("claims every Kai-number message as traveller, even operator-shaped ones", () => {
    const payload = buildWebhookPayload({
      phoneNumberId: KAI_PHONE_ID,
      messages: [textMessage({ text: { body: "the boat is available and the price is 1200 USD" } })]
    });
    const routing = { kaiPhoneNumberId: KAI_PHONE_ID };

    expect(extractBluePassTravellerMessagesFromWhatsAppWebhook(payload, routing)).toHaveLength(1);
    expect(extractBluePassOperatorResponsesFromWhatsAppWebhook(payload, routing)).toEqual([]);
  });

  it("never claims messages arriving on a different number", () => {
    const payload = buildWebhookPayload({
      phoneNumberId: OPS_PHONE_ID,
      messages: [textMessage()]
    });

    const messages = extractBluePassTravellerMessagesFromWhatsAppWebhook(payload, {
      kaiPhoneNumberId: KAI_PHONE_ID
    });

    expect(messages).toEqual([]);
  });

  it("skips messages without extractable text", () => {
    const payload = buildWebhookPayload({
      messages: [textMessage({ text: undefined, type: "image" }), textMessage({ text: { body: "   " } })]
    });

    expect(extractBluePassTravellerMessagesFromWhatsAppWebhook(payload)).toEqual([]);
  });
});

describe("extractWhatsAppHumanAgentEchoesFromWebhook", () => {
  it("extracts coexistence echoes with the customer phone", () => {
    const payload = buildWebhookPayload({
      messageEchoes: [{ id: "wamid.echo_1", to: "6281234567890", type: "text", text: { body: "Tony here" } }]
    });

    expect(extractWhatsAppHumanAgentEchoesFromWebhook(payload)).toEqual([
      { customerPhone: "6281234567890", providerMessageId: "wamid.echo_1" }
    ]);
  });

  it("ignores echoes without a recipient", () => {
    const payload = buildWebhookPayload({ messageEchoes: [{ id: "wamid.echo_2", type: "text" }] });

    expect(extractWhatsAppHumanAgentEchoesFromWebhook(payload)).toEqual([]);
  });
});

describe("verifyWhatsAppWebhookSignature", () => {
  const appSecret = "app_secret_123";
  const rawBody = JSON.stringify({ object: "whatsapp_business_account" });

  function signatureFor(body: string, secret: string) {
    return `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
  }

  it("accepts a valid signature", () => {
    expect(
      verifyWhatsAppWebhookSignature({
        rawBody,
        signatureHeader: signatureFor(rawBody, appSecret),
        appSecret
      })
    ).toBe(true);
  });

  it("rejects a signature produced with a different secret", () => {
    expect(
      verifyWhatsAppWebhookSignature({
        rawBody,
        signatureHeader: signatureFor(rawBody, "other_secret"),
        appSecret
      })
    ).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyWhatsAppWebhookSignature({ rawBody, signatureHeader: null, appSecret })).toBe(false);
    expect(verifyWhatsAppWebhookSignature({ rawBody, signatureHeader: "md5=abc", appSecret })).toBe(false);
  });
});
