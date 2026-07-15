import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWhatsAppTemplatePayload, sendWhatsAppInteractiveButtons, sendWhatsAppTypingIndicator } from "./client";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("WhatsApp client", () => {
  it("normalizes Indonesian local recipient numbers to international digits", () => {
    const payload = buildWhatsAppTemplatePayload({
      to: "085337210180",
      name: "booking_inquiry_operator"
    });

    expect(payload.to).toBe("6285337210180");
  });

  it("sends a read receipt with typing indicator for inbound messages", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppTypingIndicator({
      role: "kai",
      messageId: "wamid.inbound.123"
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));

    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://graph.facebook.com/v20.0/1115079071692326/messages");
    expect(body).toEqual({
      messaging_product: "whatsapp",
      status: "read",
      message_id: "wamid.inbound.123",
      typing_indicator: {
        type: "text"
      }
    });
  });

  it("sends an interactive reply-button message for suggested replies", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ messages: [{ id: "wamid.out.buttons" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppInteractiveButtons({
      to: "085337210180",
      role: "kai",
      body: "Ready to send this inquiry to the operator now?",
      buttons: ["Send inquiry"]
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));

    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "6285337210180",
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: "Ready to send this inquiry to the operator now?" },
        action: {
          buttons: [{ type: "reply", reply: { id: "Send inquiry", title: "Send inquiry" } }]
        }
      }
    });
    expect(result).toEqual({ providerMessageId: "wamid.out.buttons" });
  });

  it("truncates button titles longer than WhatsApp's 20-character limit", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppInteractiveButtons({
      to: "085337210180",
      role: "kai",
      body: "Pick an option",
      buttons: ["This button title is way too long for WhatsApp"]
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    const [button] = body.interactive.action.buttons;

    expect(button.reply.title).toBe("This button title is");
    expect(button.reply.title.length).toBe(20);
    expect(button.reply.id).toBe(button.reply.title);
  });

  it("falls back to a plain text message when there are no usable buttons", async () => {
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
    process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";

    const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ messages: [{ id: "wamid.out.text" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppInteractiveButtons({
      to: "085337210180",
      role: "kai",
      body: "No buttons here",
      buttons: ["   ", ""]
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));

    expect(body).toEqual({
      messaging_product: "whatsapp",
      to: "6285337210180",
      type: "text",
      text: { preview_url: false, body: "No buttons here" }
    });
    expect(result).toEqual({ providerMessageId: "wamid.out.text" });
  });
});
