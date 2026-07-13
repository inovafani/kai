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
  "OPENAI_API_KEY",
  "BLUEPASS_APP_URL",
  "BLUEPASS_APP_SERVICE_TOKEN"
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
  it("uses a registered operator phone as operator identity for normal onboarding chat", async () => {
    const tenantSlug = `bluepass-whatsapp-operator-identity-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    process.env.BLUEPASS_APP_URL = "https://bluepass.test";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "bridge_token";
    const operatorPhone = "6285337210180";
    const fetchMock = stubWhatsAppSend("wamid.operator.identity.reply", {
      directoryResponse: {
        operators: [
          {
            operatorSlug: "calico-jack",
            operatorName: "Calico Jack",
            yachtSlugs: ["calico-jack"],
            whatsappPhone: operatorPhone,
            status: "APPROVED",
            source: "operator_profile"
          }
        ]
      }
    });

    await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Operator Identity Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });

    const result = await handleBluePassWhatsAppInboundMessage({
      from: operatorPhone,
      providerMessageId: "wamid.operator.identity.hello",
      body: "Hello"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("operator");
    expect(sentBody).toContain("BluePass");
    expect(sentBody).not.toContain("latest BluePass inquiry");
    expect(sentBody).not.toContain("Please share your name");
  }, 20_000);

  it("keeps a registered WhatsApp operator in operator mode for commission questions", async () => {
    const tenantSlug = `bluepass-whatsapp-operator-commission-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    process.env.BLUEPASS_APP_URL = "https://bluepass.test";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "bridge_token";
    const operatorPhone = "6285337210180";
    const fetchMock = stubWhatsAppSend("wamid.operator.commission.reply", {
      directoryResponse: {
        operators: [
          {
            operatorSlug: "calico-jack",
            operatorName: "Calico Jack",
            yachtSlugs: ["calico-jack"],
            whatsappPhone: operatorPhone,
            status: "APPROVED",
            source: "operator_profile"
          }
        ]
      }
    });

    await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Operator Commission Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });

    const result = await handleBluePassWhatsAppInboundMessage({
      from: operatorPhone,
      providerMessageId: "wamid.operator.commission",
      body: "what commission does BluePass take?"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("Calico Jack");
    expect(sentBody).toContain("82%");
    expect(sentBody).toContain("18%");
    expect(sentBody).not.toContain("partner commission");
    expect(sentBody).not.toContain("Please share your name");
  }, 20_000);

  it("uses a registered partner phone as partner identity for partner questions", async () => {
    const tenantSlug = `bluepass-whatsapp-partner-identity-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    process.env.BLUEPASS_APP_URL = "https://bluepass.test";
    process.env.BLUEPASS_APP_SERVICE_TOKEN = "bridge_token";
    const partnerPhone = "6281222233334";
    const fetchMock = stubWhatsAppSend("wamid.partner.identity.reply", {
      directoryResponse: { operators: [] },
      partnerDirectoryResponse: {
        partners: [
          {
            partnerId: "partner_1",
            partnerName: "Reef Voice Studio",
            partnerRole: "CREATOR",
            handle: "reefvoice",
            whatsappPhone: partnerPhone,
            status: "APPROVED",
            source: "creator_profile"
          }
        ]
      }
    });

    await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Partner Identity Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });

    const result = await handleBluePassWhatsAppInboundMessage({
      from: partnerPhone,
      providerMessageId: "wamid.partner.identity.commission",
      body: "How does referral commission work?"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("partner commission");
    expect(sentBody).toContain("traveller");
    expect(sentBody).not.toContain("82%");
    expect(sentBody).not.toContain("Please share your name");
  }, 20_000);

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

  it("answers traveller general questions without forcing the latest inquiry context", async () => {
    const { travellerPhone, inquiryId } = await seedTravellerContext();
    const fetchMock = stubWhatsAppSend("wamid.traveller.value.reply");

    const result = await handleBluePassWhatsAppInboundMessage({
      from: travellerPhone,
      providerMessageId: "wamid.traveller.what-is-bluepass",
      body: "what is bluepass?"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);
    const contextEvent = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: inquiryId,
        type: "WHATSAPP_CONTEXT_MESSAGE_RECEIVED",
        metadata: {
          path: ["providerMessageId"],
          equals: "wamid.traveller.what-is-bluepass"
        }
      }
    });

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("BluePass helps travellers");
    expect(sentBody).toContain("vetted ocean operators");
    expect(sentBody).not.toContain("latest BluePass inquiry");
    expect(sentBody).not.toContain("Current status");
    expect(contextEvent).toBeNull();
  }, 20_000);

  it("answers traveller browsing requests with recommendations before asking for contact details", async () => {
    const tenantSlug = `bluepass-whatsapp-traveller-browsing-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const travellerPhone = "6285156246329";
    const fetchMock = stubWhatsAppSend("wamid.traveller.browse.reply");

    await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Traveller Browsing Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });

    const result = await handleBluePassWhatsAppInboundMessage({
      from: travellerPhone,
      providerMessageId: "wamid.traveller.browse",
      body: "liveaboards in komodo"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("Komodo");
    expect(sentBody).toContain("Calico Jack");
    expect(sentBody).toContain("Alila Purnama");
    expect(sentBody).not.toContain("Please share your name");
    expect(sentBody).not.toContain("email so I can prepare");
    expect(sentBody).not.toContain("phone so I can prepare");
  }, 20_000);

  it("answers destination comparisons in WhatsApp instead of reusing a stale yacht from history", async () => {
    const tenantSlug = `bluepass-whatsapp-traveller-destination-compare-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const travellerPhone = "6285156246329";
    const fetchMock = stubWhatsAppSend("wamid.traveller.destination-compare.reply");

    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Traveller Destination Compare Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });
    const conversation = await prisma.conversation.create({
      data: {
        tenantId: tenant.id,
        channel: "WHATSAPP",
        travellerId: travellerPhone,
        controlMode: "AI"
      }
    });
    await prisma.message.createMany({
      data: [
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          role: "TRAVELLER",
          content: "liveaboards in komodo"
        },
        {
          tenantId: tenant.id,
          conversationId: conversation.id,
          role: "TRAVELLER",
          content: "Tell me about Anne Bonny"
        }
      ]
    });

    const result = await handleBluePassWhatsAppInboundMessage({
      from: travellerPhone,
      providerMessageId: "wamid.traveller.destination-compare",
      body: "whats better komodo or raja ampat?"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);

    expect(result.handled).toBe(true);
    expect(result.sent).toBe(true);
    expect(sentBody).toContain("Komodo");
    expect(sentBody).toContain("Raja Ampat");
    expect(sentBody).toMatch(/different|better|simpler|remote/i);
    expect(sentBody).not.toContain("Anne Bonny is");
    expect(sentBody).not.toContain("Please share your name");
  }, 20_000);

  it("uses the WhatsApp sender phone when a traveller completes a booking request", async () => {
    const tenantSlug = `bluepass-whatsapp-traveller-booking-phone-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const travellerPhone = "6285156246329";
    const fetchMock = stubWhatsAppSend("wamid.traveller.booking.reply");

    await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Traveller Booking Phone Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });

    await handleBluePassWhatsAppInboundMessage({
      from: travellerPhone,
      providerMessageId: "wamid.traveller.booking.start",
      body: "i want to order calico jack"
    });
    await handleBluePassWhatsAppInboundMessage({
      from: travellerPhone,
      providerMessageId: "wamid.traveller.booking.details",
      body: "my name is Inov, email is inoveka@gmail.com, i want 19th july for 2 people"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);

    expect(sentBody).toContain("Calico Jack");
    expect(sentBody).toContain("19 July");
    expect(sentBody).toContain("2 guests");
    expect(sentBody).toContain("Inov");
    expect(sentBody).toContain("inoveka@gmail.com");
    expect(sentBody).toContain("6285156246329");
    expect(sentBody).toContain("Before I send this to the operator");
    expect(sentBody).not.toContain("Contact details: com");
    expect(sentBody).not.toContain("WhatsApp number");
  }, 30_000);

  it("recommends different options when the traveller asks for something besides the selected yacht", async () => {
    const tenantSlug = `bluepass-whatsapp-traveller-other-options-${randomUUID()}`;
    process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
    const travellerPhone = "6285156246329";
    const fetchMock = stubWhatsAppSend("wamid.traveller.other-options.reply");

    await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        name: "BluePass WhatsApp Traveller Other Options Test",
        widgetPublicKey: `pk_${randomUUID()}`,
        allowedOrigins: ["https://bluepass.co"],
        status: "ACTIVE"
      }
    });

    await handleBluePassWhatsAppInboundMessage({
      from: travellerPhone,
      providerMessageId: "wamid.traveller.calico.intent",
      body: "i want to order calico jack"
    });
    await handleBluePassWhatsAppInboundMessage({
      from: travellerPhone,
      providerMessageId: "wamid.traveller.other-options",
      body: "is there anything else rather than calico?"
    });
    const sentBody = getLastWhatsAppTextBody(fetchMock);

    expect(sentBody).toContain("besides Calico Jack");
    expect(sentBody).toContain("Alila Purnama");
    expect(sentBody).not.toContain("Calico Jack is a");
    expect(sentBody).not.toContain("Please share your name");
  }, 30_000);
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

async function seedTravellerContext() {
  const tenantSlug = `bluepass-whatsapp-traveller-routing-${randomUUID()}`;
  process.env.WHATSAPP_BLUEPASS_TENANT_SLUG = tenantSlug;
  const travellerPhone = "6285156246329";

  const tenant = await prisma.tenant.create({
    data: {
      slug: tenantSlug,
      name: "BluePass WhatsApp Traveller Routing Test",
      widgetPublicKey: `pk_${randomUUID()}`,
      allowedOrigins: ["https://bluepass.co"],
      status: "ACTIVE"
    }
  });
  const conversation = await prisma.conversation.create({
    data: {
      tenantId: tenant.id,
      channel: "WHATSAPP",
      travellerId: travellerPhone,
      controlMode: "AI"
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
      operatorPhone: "6285337210180",
      destination: "Komodo",
      dateWindow: "10 July",
      guests: 4,
      travellerName: "Inov",
      travellerEmail: "inov@example.com",
      travellerPhone,
      travellerMessage: "Calico Jack in Komodo for 4 guests on 10 July",
      status: "OPERATOR_PENDING"
    }
  });

  return {
    tenantId: tenant.id,
    travellerPhone,
    inquiryId: inquiry.id
  };
}

function stubWhatsAppSend(
  providerMessageId: string,
  options: {
    directoryResponse?: unknown;
    partnerDirectoryResponse?: unknown;
  } = {}
) {
  process.env.META_GRAPH_VERSION = "v20.0";
  process.env.WHATSAPP_ACCESS_TOKEN = "test_access_token";
  process.env.WHATSAPP_PHONE_ID_KAI = "1115079071692326";
  process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    if (url.includes("/api/kai/operator-directory")) {
      return Response.json(options.directoryResponse ?? { operators: [] });
    }

    if (url.includes("/api/kai/partner-directory")) {
      return Response.json(options.partnerDirectoryResponse ?? { partners: [] });
    }

    return Response.json({
      messages: [{ id: providerMessageId }]
    });
  });
  vi.stubGlobal("fetch", fetchMock);

  return fetchMock;
}

function getLastWhatsAppTextBody(fetchMock: { mock: { calls: Parameters<typeof fetch>[] } }) {
  const textCalls = fetchMock.mock.calls
    .filter((call) => String(call[0]).includes("graph.facebook.com"))
    .map((call) => JSON.parse(String((call[1] as RequestInit).body)))
    .filter((payload) => payload.type === "text");

  const lastTextCall = textCalls.at(-1);
  return String(lastTextCall?.text?.body ?? "");
}
