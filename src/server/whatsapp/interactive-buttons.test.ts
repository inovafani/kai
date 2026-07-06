import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendWhatsAppInteractiveButtons } from "./client";

const originalEnv = { ...process.env };

function mockGraphOk() {
  return vi.fn(async () =>
    new Response(JSON.stringify({ messages: [{ id: "wamid.INT1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  );
}

function lastGraphBody(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

beforeEach(() => {
  process.env.META_GRAPH_VERSION = "v23.0";
  process.env.WHATSAPP_PHONE_ID_KAI = "kai-phone-id";
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("sendWhatsAppInteractiveButtons", () => {
  it("posts an interactive button payload with the supplied buttons", async () => {
    const fetchMock = mockGraphOk();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWhatsAppInteractiveButtons({
      to: "+62 812 3456 7890",
      role: "kai",
      body: "Are you planning a trip, running boats, or booking for clients?",
      buttons: [
        { id: "triage:traveller", title: "Planning a trip" },
        { id: "triage:operator", title: "I run trips" },
        { id: "triage:partner", title: "I refer clients" }
      ]
    });

    expect(result.providerMessageId).toBe("wamid.INT1");
    const body = lastGraphBody(fetchMock);
    expect(body.type).toBe("interactive");
    expect(body.to).toBe("6281234567890");
    expect(body.interactive.type).toBe("button");
    expect(body.interactive.action.buttons).toHaveLength(3);
    expect(body.interactive.action.buttons[0]).toEqual({
      type: "reply",
      reply: { id: "triage:traveller", title: "Planning a trip" }
    });
  });

  it("truncates titles to Meta's 20-char limit and caps at 3 buttons", async () => {
    const fetchMock = mockGraphOk();
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppInteractiveButtons({
      to: "6281234567890",
      body: "pick one",
      buttons: [
        { id: "a", title: "This title is definitely longer than twenty" },
        { id: "b", title: "Second" },
        { id: "c", title: "Third" },
        { id: "d", title: "Fourth (dropped)" }
      ]
    });

    const buttons = lastGraphBody(fetchMock).interactive.action.buttons;
    expect(buttons).toHaveLength(3);
    expect(buttons[0].reply.title).toBe("This title is defini");
    expect(buttons[0].reply.title.length).toBe(20);
    expect(buttons.map((b: { reply: { id: string } }) => b.reply.id)).toEqual(["a", "b", "c"]);
  });

  it("falls back to a plain text send when no usable buttons remain", async () => {
    const fetchMock = mockGraphOk();
    vi.stubGlobal("fetch", fetchMock);

    await sendWhatsAppInteractiveButtons({
      to: "6281234567890",
      body: "no chips here",
      buttons: [{ id: "x", title: "   " }]
    });

    const body = lastGraphBody(fetchMock);
    expect(body.type).toBe("text");
    expect(body.text.body).toBe("no chips here");
  });
});
