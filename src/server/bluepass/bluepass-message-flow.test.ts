import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBluePassMarketplaceMessage } from "./bluepass-message-flow";
import { prisma } from "@/lib/prisma";

const originalEnv = { ...process.env };
const isolatedWhatsAppEnvKeys = [
  "BLUEPASS_TEST_OPERATOR_PHONE",
  "WHATSAPP_OPERATOR_INQUIRY_SEND_MODE",
  "WHATSAPP_TRAVELLER_NOTIFY_SEND_MODE",
  "WHATSAPP_OPERATOR_COUNTER_REQUEST_SEND_MODE",
  "META_GRAPH_VERSION",
  "WHATSAPP_PHONE_ID_KAI",
  "WHATSAPP_PHONE_ID_OPS",
  "WHATSAPP_ACCESS_TOKEN"
];

beforeEach(() => {
  for (const key of isolatedWhatsAppEnvKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("handleBluePassMarketplaceMessage", () => {
  it("explains BluePass value without starting an inquiry", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Why should I use BluePass instead of booking direct?",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.bluepassLedger).toEqual([]);
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("vetted");
    expect(result.assistantContent).toContain("operator");
    expect(result.assistantContent).toContain("5%");
    expect(result.assistantContent).toContain("conservation");
    expect(result.assistantContent).not.toContain("I prepared BluePass inquiry");
  });

  it("gives destination season guidance as a concierge response", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "What is the best time to go to Komodo?",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("April");
    expect(result.assistantContent).toContain("November");
    expect(result.assistantContent).not.toContain("Please share your name");
  });

  it("answers Komodo browsing requests with recommendations instead of asking for contact details", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "liveaboards in komodo",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).not.toContain("name");
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
  });

  it("keeps recommendation follow-ups in concierge mode instead of contact collection", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "do you have recommendation for me",
      priorTravellerMessages: ["liveaboards in komodo"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("BluePass");
    expect(result.assistantContent).not.toContain("name");
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
  });

  it("answers casual WhatsApp small talk instead of entering inquiry collection", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "yo wassup",
      priorTravellerMessages: ["liveaboards in komodo"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("I am here");
    expect(result.assistantContent).not.toContain("Please share your name");
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
  });

  it("compares two yachts without showing inquiry actions", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Can you compare Alila Purnama and Amandira?",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("Amandira");
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("Raja Ampat");
    expect(result.assistantContent).not.toContain("I prepared BluePass inquiry");
  });

  it("returns preview matches for discovery requests without asking for contact details", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Can Kai find me a yacht in Komodo for 8 guests next month?",
      priorTravellerMessages: []
    });

    expect(result.bluepassMatches.map((match) => match.name)).toContain("Alila Purnama");
    expect(result.bluepassMatches.map((match) => match.name)).toContain("Calico Jack");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Good BluePass liveaboard options");
    expect(result.assistantContent).not.toContain("Please share your name");
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
    expect(result.paymentRequest).toBeNull();
  });

  it("uses the WhatsApp sender phone instead of asking the traveller to repeat it", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "i want to order calico jack in komodo on 16 July for 2 guests",
      priorTravellerMessages: [],
      travellerPhone: "6285156246329"
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("name");
    expect(result.assistantContent).toContain("email");
    expect(result.assistantContent).not.toContain("phone");
    expect(result.contactRequest).toMatchObject({
      status: "CONTACT_DETAILS_REQUIRED",
      fields: ["name", "email"]
    });
  });

  it("locks a selected yacht even when the traveller makes a small typo in the yacht name", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "i want to order alila purnnama",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).not.toContain("Alexa");
    expect(result.assistantContent).not.toContain("destination");
    expect(result.assistantContent).toContain("dates");
    expect(result.assistantContent).toContain("group size");
  });

  it("does not ask for contact details in text while trip details are still missing", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "i want to order alila purnama",
      priorTravellerMessages: []
    });

    expect(result.contactRequest).toBeNull();
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("dates");
    expect(result.assistantContent).toContain("group size");
    expect(result.assistantContent).not.toContain("name");
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
  });

  it("keeps contact collection out of the text prompt for generic incomplete inquiries", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "i want to order a yacht",
      priorTravellerMessages: []
    });

    expect(result.contactRequest).toBeNull();
    expect(result.assistantContent).toContain("destination");
    expect(result.assistantContent).toContain("date window");
    expect(result.assistantContent).toContain("guest count");
    expect(result.assistantContent).not.toContain("name");
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
  });

  it("creates inquiry, ledger estimate, and dispatch when required fields are present", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content:
        "Please send inquiry for Alila Purnama in Komodo next month for 8 guests around USD 10000. My name is Maya Chen, email maya@example.com, phone +61 400 111 222",
      priorTravellerMessages: [],
      referral: {
        referralPartnerId: "partner_creator_1",
        referralLinkId: "link_1",
        referralCode: "CREATOR42",
        referralRole: "CREATOR"
      }
    });

    expect(result.bluepassInquiry).toMatchObject({
      status: "OPERATOR_PENDING",
      destination: "Komodo",
      guests: 8,
      selectedYachtSlug: "alila-purnama",
      referralCode: "CREATOR42"
    });
    expect(result.bluepassMatches).toEqual([]);
    expect(result.bluepassLedger.map((entry) => entry.kind)).toEqual([
      "CREATOR_COMMISSION_ESTIMATE",
      "BLUEPASS_PLATFORM_COMMISSION",
      "CONSERVATION_ALLOCATION",
      "OPERATOR_PAYOUT_PLACEHOLDER"
    ]);
    expect(result.bluepassDispatch).toMatchObject({
      status: "QUEUED",
      operatorPhone: "+6281234567001"
    });
    expect(result.assistantContent).toContain("I prepared BluePass inquiry");
    expect(result.assistantContent).toContain("not a confirmed booking");
    expect(result.paymentRequest).toBeNull();
  }, 20_000);

  it("answers yacht information questions without creating or dispatching an inquiry", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Can you tell me about Alila Purnama?",
      priorTravellerMessages: [
        "Please send inquiry for Alila Purnama in Komodo next month for 8 guests around USD 10000. My name is Maya Chen, email maya@example.com, phone +61 400 111 222"
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.bluepassLedger).toEqual([]);
    expect(result.bluepassMatches[0]).toMatchObject({
      slug: "alila-purnama"
    });
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).not.toContain("I prepared BluePass inquiry");
    expect(result.assistantContent).not.toContain("queued the operator WhatsApp");
  }, 20_000);

  it("includes the product link when answering selected yacht questions from the Discover catalog", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Can you tell me about Calico Jack?",
      priorTravellerMessages: [],
      catalog: [
        {
          slug: "calico-jack",
          name: "Calico Jack",
          region: "Komodo",
          tier: "Premium",
          maxGuests: 10,
          cabins: 5,
          priceSignal: "from USD 3,200 per cabin",
          charterPriceSignal: "from USD 46,000 private charter",
          productUrl: "https://bluepass.co/yachts/calico-jack",
          interests: ["dive", "phinisi"]
        }
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassMatches[0]).toMatchObject({
      slug: "calico-jack",
      productUrl: "https://bluepass.co/yachts/calico-jack"
    });
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("https://bluepass.co/yachts/calico-jack");
  });

  it("asks for booking details for a selected yacht without showing inquiry cards too early", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Can I book for Alila Purnama?",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.bluepassLedger).toEqual([]);
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("dates");
    expect(result.assistantContent).toContain("group size");
    expect(result.assistantContent).not.toContain("destination");
    expect(result.assistantContent).not.toContain("I prepared BluePass inquiry");
  });

  it("uses the BluePass Discover catalog snapshot for concierge replies", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "can you help me to order vela",
      priorTravellerMessages: [],
      catalog: [
        {
          slug: "vela",
          name: "Vela",
          region: "Komodo",
          tier: "Legend",
          maxGuests: 12,
          cabins: 5,
          priceSignal: "from $2,847 per cabin",
          charterPriceSignal: "from $17,000 private charter",
          operatorId: "operator_vela",
          operatorName: "Vela",
          interests: ["dive", "phinisi", "luxury"]
        }
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("Great choice");
    expect(result.assistantContent).toContain("Vela");
    expect(result.assistantContent).toContain("Legend");
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("live calendar");
    expect(result.assistantContent).toContain("dates and group size");
    expect(result.assistantContent).not.toContain("Alila Purnama");
  });

  it("does not dispatch a custom yacht inquiry from a generic booking request even when history has details", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "can you help me to book alila purnama?",
      priorTravellerMessages: [
        "can you tell me about alila purnama?",
        "for 29th june 2026, 4 people my name is Eka, email is eka@gmail.com, and phone is 0876634231987"
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("Before I send this to the operator");
    expect(result.assistantContent).not.toContain("I prepared BluePass inquiry");
    expect(result.assistantContent).not.toContain("queued the operator WhatsApp");
  }, 20_000);

  it("summarizes complete custom yacht details and asks for confirmation before operator dispatch", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content:
        "for 29th june 2026, 4 people\n\nmy name is Eka, email is eka@gmail.com, and phone is 0876634231987",
      priorTravellerMessages: ["can you help me to book alila purnama?"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("29 June 2026");
    expect(result.assistantContent).toContain("4 guests");
    expect(result.assistantContent).toContain("Eka");
    expect(result.assistantContent).toContain("Before I send this to the operator");
    expect(result.assistantContent).not.toContain("I prepared BluePass inquiry");
  }, 20_000);

  it("accepts WhatsApp number phrasing when completing selected yacht details", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "my name is Inov, email is inoveka@gmail.com, and whatsapp number is 085156246329",
      priorTravellerMessages: ["can you help me to order calico jack", "for 20th july 2026, 4 people", "komodo"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("20 July 2026");
    expect(result.assistantContent).toContain("4 guests");
    expect(result.assistantContent).toContain("Inov");
    expect(result.assistantContent).toContain("085156246329");
    expect(result.assistantContent).toContain("Before I send this to the operator");
    expect(result.assistantContent).not.toContain("Could you share your WhatsApp number");
  }, 20_000);

  it("requests a contact form when only traveller contact fields are missing", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "for 6th of july 2026, 4 people",
      priorTravellerMessages: ["can you help me to order calico jack", "komodo"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.contactRequest).toEqual({
      status: "CONTACT_DETAILS_REQUIRED",
      fields: ["name", "email", "phone"]
    });
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("contact details form");
    expect(result.assistantContent).not.toContain("Could you share your name");
  });

  it("creates a custom yacht inquiry only after the traveller confirms sending it", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "yes, send this inquiry now",
      priorTravellerMessages: [
        "can you help me to book alila purnama?",
        "for 29th june 2026, 4 people my name is Eka, email is eka@gmail.com, and phone is 0876634231987"
      ]
    });

    expect(result.bluepassInquiry).toMatchObject({
      status: "OPERATOR_PENDING",
      destination: "Komodo",
      dateWindow: "29 June 2026",
      guests: 4,
      travellerName: "Eka",
      travellerEmail: "eka@gmail.com",
      travellerPhone: "0876634231987",
      selectedYachtSlug: "alila-purnama"
    });
    expect(result.bluepassMatches).toEqual([]);
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("I prepared BluePass inquiry");
  }, 20_000);

  it("keeps the traveller selected yacht when destination is provided later", async () => {
    const confirmation = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "komodo",
      priorTravellerMessages: [
        "can you help me to order calico jack",
        "for 20th july 2026, 4 people my name is Ekap, email is ekap@gmail.com, and phone is 0876634231987",
        "calico jack"
      ]
    });

    expect(confirmation.bluepassInquiry).toBeNull();
    expect(confirmation.assistantContent).toContain("Calico Jack");
    expect(confirmation.assistantContent).toContain("20 July 2026");
    expect(confirmation.assistantContent).not.toContain("Alila Purnama");

    const submitted = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "yes",
      priorTravellerMessages: [
        "can you help me to order calico jack",
        "for 20th july 2026, 4 people my name is Ekap, email is ekap@gmail.com, and phone is 0876634231987",
        "calico jack",
        "komodo"
      ]
    });

    expect(submitted.bluepassInquiry).toMatchObject({
      selectedYachtSlug: "calico-jack",
      selectedYachtName: "Calico Jack",
      dateWindow: "20 July 2026",
      destination: "Komodo",
      guests: 4
    });
    expect(submitted.assistantContent).toContain("Calico Jack");
    expect(submitted.assistantContent).not.toContain("Alila Purnama");
  }, 20_000);

  it("accepts a plain yes as confirmation after a complete custom yacht inquiry summary", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "yes please",
      priorTravellerMessages: [
        "can you help me to book alila purnama?",
        "for 29th june 2026, 4 people my name is Eka, email is eka@gmail.com, and phone is 0876634231987"
      ]
    });

    expect(result.bluepassInquiry).toMatchObject({
      status: "OPERATOR_PENDING",
      destination: "Komodo",
      dateWindow: "29 June 2026",
      guests: 4,
      travellerName: "Eka",
      travellerEmail: "eka@gmail.com",
      travellerPhone: "0876634231987",
      selectedYachtSlug: "alila-purnama"
    });
    expect(result.bluepassDispatch).toMatchObject({
      status: "QUEUED",
      operatorName: "Alila Purnama"
    });
    expect(result.assistantContent).toContain("I prepared BluePass inquiry");
  }, 20_000);

  it("keeps the chat responsive when operator WhatsApp send fails", async () => {
    process.env.WHATSAPP_OPERATOR_INQUIRY_SEND_MODE = "template";
    process.env.META_GRAPH_VERSION = "v20.0";
    process.env.WHATSAPP_ACCESS_TOKEN = "expired_access_token";
    process.env.WHATSAPP_PHONE_ID_OPS = "1115079071692326";

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          {
            error: {
              message: "Authentication Error",
              type: "OAuthException",
              code: 190
            }
          },
          { status: 401 }
        )
      )
    );

    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "yes please",
      priorTravellerMessages: [
        "can you help me to book alila purnama?",
        "for 29th june 2026, 4 people my name is Eka, email is eka@gmail.com, and phone is 0876634231987"
      ]
    });

    expect(result.bluepassInquiry).toMatchObject({
      status: "READY_TO_DISPATCH",
      selectedYachtSlug: "alila-purnama"
    });
    expect(result.bluepassDispatch).toMatchObject({
      status: "FAILED",
      failureReason: expect.stringContaining("Authentication Error")
    });
    expect(result.assistantContent).toContain("I prepared BluePass inquiry");
    expect(result.assistantContent).toContain("operator WhatsApp could not be sent");
    expect(result.assistantContent).not.toContain("queued the operator WhatsApp");
  }, 20_000);

  it("understands Labuan Bajo as the Komodo gateway", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "labuan bajo",
      priorTravellerMessages: [
        "can you help me to book alila purnama?",
        "for 29th june 2026, 4 people my name is Eka, email is eka@gmail.com, and phone is 0876634231987"
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("Before I send this to the operator");
    expect(result.assistantContent).not.toContain("Please share your destination");
  }, 20_000);

  it("answers inquiry status follow-ups without creating another dispatch", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const inquiry = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content:
        "Please send inquiry for Alila Purnama in Komodo next month for 8 guests around USD 10000. My name is Maya Chen, email maya@example.com, phone +61 400 111 222",
      priorTravellerMessages: []
    });
    const status = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "what is my inquiry status?",
      priorTravellerMessages: [
        "Please send inquiry for Alila Purnama in Komodo next month for 8 guests around USD 10000. My name is Maya Chen, email maya@example.com, phone +61 400 111 222"
      ]
    });

    expect(status.bluepassInquiry?.id).toBe(inquiry.bluepassInquiry?.id);
    expect(status.bluepassDispatch).toBeNull();
    expect(status.bluepassMatches).toEqual([]);
    expect(status.assistantContent).toContain("operator");
    expect(status.assistantContent).toContain("pending");
    expect(status.assistantContent).not.toContain("I prepared BluePass inquiry");
  }, 20_000);

  it("dispatches the suggested alternative after a declined operator inquiry when the traveller approves", async () => {
    const tenant = await prisma.tenant.create({
      data: {
        slug: `bluepass-alt-flow-${randomUUID()}`,
        name: "BluePass Alternative Flow Test",
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
    const tenantId = tenant.id;
    const conversationId = conversation.id;

    const firstInquiry = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "yes please",
      priorTravellerMessages: [
        "can you help me to order calico jack",
        "for 20th july 2026, 4 people my name is Ekap, email is ekap@gmail.com, and phone is 0876634231987",
        "komodo"
      ]
    });
    expect(firstInquiry.bluepassInquiry).toMatchObject({
      selectedYachtSlug: "calico-jack"
    });

    await import("./bluepass-inquiry-repository").then(({ handleBluePassOperatorResponse }) =>
      handleBluePassOperatorResponse({
        inquiryId: firstInquiry.bluepassInquiry!.id,
        action: "decline",
        providerMessageId: "wamid.calico.decline"
      })
    );

    const alternative = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "yes, send inquiry to the alternative",
      priorTravellerMessages: [
        "can you help me to order calico jack",
        "for 20th july 2026, 4 people my name is Ekap, email is ekap@gmail.com, and phone is 0876634231987",
        "komodo",
        "yes please"
      ]
    });

    expect(alternative.bluepassInquiry).toMatchObject({
      status: "OPERATOR_PENDING",
      selectedYachtSlug: "alila-purnama",
      selectedYachtName: "Alila Purnama",
      destination: "Komodo",
      dateWindow: "20 July 2026",
      guests: 4
    });
    expect(alternative.bluepassDispatch).toMatchObject({
      status: "QUEUED",
      operatorName: "Alila Purnama",
      operatorPhone: "+6281234567001"
    });
    expect(alternative.assistantContent).toContain("Alila Purnama");
    expect(alternative.assistantContent).not.toContain("Calico Jack");

    const alternativeCreatedEvent = await prisma.bluePassInquiryEvent.findFirst({
      where: {
        bluePassInquiryId: alternative.bluepassInquiry!.id,
        type: "INQUIRY_CREATED"
      }
    });
    expect(alternativeCreatedEvent?.metadata).toMatchObject({
      reason: "operator_declined",
      previousInquiryId: firstInquiry.bluepassInquiry!.id,
      previousYachtSlug: "calico-jack",
      alternativeYachtSlug: "alila-purnama"
    });
  }, 60_000);
});
