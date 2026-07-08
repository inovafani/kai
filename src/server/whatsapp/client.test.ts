import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWhatsAppTemplatePayload, sendWhatsAppTypingIndicator } from "./client";

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
});
