import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { handleBluePassWhatsAppInboundMessage } from "./bluepass-whatsapp-conversation";

const originalEnv = { ...process.env };
const isolatedEnvKeys = [
  "WHATSAPP_BLUEPASS_TENANT_SLUG",
  "META_GRAPH_VERSION",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_ID_KAI",
  "WHATSAPP_PHONE_ID_OPS",
  "ENABLE_LLM",
  "LLM_PROVIDER",
  "OPENAI_API_KEY"
];

beforeEach(() => {
  for (const key of isolatedEnvKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  process.env = { ...originalEnv };
});

describe("handleBluePassWhatsAppInboundMessage", () => {
  it("does not force operator small talk into the latest inquiry context", async () => {
    const { operatorPhone, inquiryId } = await seedOperatorContext();
    const fetchMock = stubWhatsAppSend("wamid.operator.smalltalk.reply");

    const result = await handleBluePassWhatsAppInboundMessage({
      from: operatorPhone,
      providerMessageId: "wamid.operator.hello",
      body: "Hello"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);
    const contextEvent = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: inquiryId,
        type: "WHATSAPP_CONTEXT_MESSAGE_RECEIVED",
        metadata: {
          path: ["providerMessageId"],
          equals: "wamid.operator.hello"
        }
      }
    });

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("I am here");
    expect(sentBody).not.toContain("Current status");
    expect(sentBody).not.toContain("You can reply with availability");
    expect(contextEvent).toBeNull();
  }, 20_000);

  it("starts a fresh WhatsApp conversation when the participant asks for a new chat", async () => {
    const { tenantId, operatorPhone, inquiryId } = await seedOperatorContext();
    const fetchMock = stubWhatsAppSend("wamid.operator.newchat.reply");

    const result = await handleBluePassWhatsAppInboundMessage({
      from: operatorPhone,
      providerMessageId: "wamid.operator.newchat",
      body: "New chat"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);
    const whatsappConversations = await prisma.conversation.findMany({
      where: {
        tenantId,
        channel: "WHATSAPP",
        travellerId: operatorPhone
      }
    });
    const contextEvent = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: inquiryId,
        type: "WHATSAPP_CONTEXT_MESSAGE_RECEIVED",
        metadata: {
          path: ["providerMessageId"],
          equals: "wamid.operator.newchat"
        }
      }
    });

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("Fresh chat started");
    expect(sentBody).not.toContain("Current status");
    expect(whatsappConversations).toHaveLength(1);
    expect(contextEvent).toBeNull();
  }, 20_000);
});

async function seedOperatorContext() {
  const tenantSlug = `bluepass-whatsapp-routing-${randomUUID()}`;
  process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
  const operatorPhone = "6285337210180";

  const tenant = await prisma.tenant.create({
    data: {
      slug: tenantSlug,
      name: "BluePass WhatsApp Routing Test",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE"
    }
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      channel: "WEB_WIDGET"
    }
  });
  const inquiry = await prisma.bluePassInquiry.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      selectedYachtSlug: "calico-jack",
      selectedYachtName: "Calico Jack",
      operatorId: "operator_calico_jack",
      operatorName: "Calico Jack",
      operatorPhone,
      destination: "Komodo",
      dateWindow: "10 July",
      guests: 4,
      travellerName: "Inov",
      travellerEmail: "inov@example.com",
      travellerPhone: "6285156246329",
      travellerMessage: "Calico Jack in Komodo for 4 guests on 10 July",
      status: "OPERATOR_ACCEPTED"
    }
  });
  await prisma.bluePassOperatorDispatch.create({
    data: {
      tenantId: tenant.id,
      conversationId: conversation.id,
      bluePassInquiryId: inquiry.id,
      status: "SENT",
      operatorId: "operator_calico_jack",
      operatorName: "Calico Jack",
      operatorPhone,
      outboundText: "New BluePass inquiry",
      providerMessageId: `wamid.dispatch.${randomUUID()}`
    }
  });

  return {
    tenantId: tenant.id,
    operatorPhone,
    inquiryId: inquiry.id
  };
}

function stubWhatsAppSend(providerMessageId: string) {
  process.env.META_GRAPH_VERSION = "v20.0";
  process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
  process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";
  process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

  const fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json({
      messages: [{ id: providerMessageId }]
    })
  );
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function getLastWhatsAppTextBody(fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }) {
  const lastCall = fetchMock.mock.calls.at(-1);
  if (!lastCall) return "";

  const payload = JSON.parse(String((lastCall[1] as RequestInit).body));
  return String(payload.text?.body ?? "");
}
