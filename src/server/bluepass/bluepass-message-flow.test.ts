import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBluePassMarketplaceMessage, shouldEscalateBluePassRouterToLlm } from "./bluepass-message-flow";
import { prisma } from "@/lib/prisma";
import type { BluePassInquiryIntent } from "@/core/bluepass/intent";
import type { BluePassYachtCatalogItem } from "@/core/bluepass/catalog";

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
  it("answers operator onboarding questions without entering traveller inquiry collection", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "I run a liveaboard in Komodo, what's your cut?",
      priorTravellerMessages: []
    });

    expect(result.persona).toBe("OPERATOR");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("82%");
    expect(result.assistantContent).toContain("18%");
    expect(result.assistantContent).toContain("operator");
    expect(result.assistantContent).not.toContain("Please share your name");
    expect(result.assistantContent).not.toContain("guest count");
  });

  it("treats travel inspiration as concierge chat instead of forcing inquiry fields", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "i want healing but im confuse where to go",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.contactRequest).toBeNull();
    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.bluepassMatches.length).toBeGreaterThanOrEqual(2);
    expect(result.assistantContent).toContain("Raja Ampat");
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).not.toContain("Please share your name");
    expect(result.assistantContent).not.toContain("prepare the inquiry");
    expect(result.suggestedReplies).toEqual(["Komodo", "Raja Ampat"]);
  });

  it("keeps a registered operator in operator mode even when they ask about commission", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "what commission does BluePass take?",
      priorTravellerMessages: [],
      identityPersona: "OPERATOR",
      identityName: "Calico Jack"
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("82%");
    expect(result.assistantContent).toContain("18%");
    expect(result.assistantContent).not.toContain("partner commission");
    expect(result.assistantContent).not.toContain("Please share your name");
  });

  it("lets a registered operator switch into traveller booking mode with a strong booking request", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "I want to book Calico Jack in Komodo on 19 July for 2 guests",
      priorTravellerMessages: [],
      travellerPhone: "6285337210180",
      identityPersona: "OPERATOR",
      identityName: "Calico Jack"
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("name");
    expect(result.assistantContent).toContain("email");
    expect(result.assistantContent).not.toContain("operator onboarding");
    expect(result.assistantContent).not.toContain("82%");
  });

  it("answers partner commission questions without entering traveller inquiry collection", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "I book for clients and want to understand referral commission",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("commission");
    expect(result.assistantContent).toContain("client");
    expect(result.assistantContent).not.toContain("Please share your name");
    expect(result.assistantContent).not.toContain("guest count");
  });

  it("captures an operator lead when an operator shares a reachable contact", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const result = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "I run Calico Jack. Contact me at operator@calico.test or WhatsApp +62 853 3721 0180",
      priorTravellerMessages: ["I run a liveaboard in Komodo"]
    });

    const lead = await prisma.bluePassInquiry.findFirst({
      where: {
        tenantId,
        conversationId,
        tripType: "OPERATOR_LEAD"
      },
      include: { events: true }
    });

    expect(result.persona).toBe("OPERATOR");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("operator lead");
    expect(result.assistantContent).toContain("operator@calico.test");
    expect(result.assistantContent).toContain("+62 853 3721 0180");
    expect(lead).toMatchObject({
      status: "DRAFT",
      travellerEmail: "operator@calico.test",
      travellerPhone: "+62 853 3721 0180",
      tripType: "OPERATOR_LEAD"
    });
    expect(lead?.events.map((event) => event.type)).toContain("PERSONA_LEAD_CREATED");
  });

  it("captures a partner lead when a partner shares a reachable contact", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const result = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "I book for clients. My email is agent@example.test and phone is 08123456789",
      priorTravellerMessages: []
    });

    const lead = await prisma.bluePassInquiry.findFirst({
      where: {
        tenantId,
        conversationId,
        tripType: "PARTNER_LEAD"
      },
      include: { events: true }
    });

    expect(result.persona).toBe("PARTNER");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("partner lead");
    expect(result.assistantContent).toContain("agent@example.test");
    expect(result.assistantContent).toContain("08123456789");
    expect(lead).toMatchObject({
      status: "DRAFT",
      travellerEmail: "agent@example.test",
      travellerPhone: "08123456789",
      tripType: "PARTNER_LEAD"
    });
    expect(lead?.events.map((event) => event.type)).toContain("PERSONA_LEAD_CREATED");
  });

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
    expect(result.suggestedReplies).toEqual(["Show me yachts"]);
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
    expect(result.suggestedReplies).toBeNull();
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
    expect(result.suggestedReplies).toEqual([
      `Book ${result.bluepassMatches[0].name}`,
      `Book ${result.bluepassMatches[1].name}`,
      "Something else"
    ]);
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
    expect(result.suggestedReplies).toEqual(["Show me yachts"]);
  });

  it("treats new chat as a fresh traveller conversation instead of reusing old booking details", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "new chat",
      priorTravellerMessages: [
        "i want to order calico jack",
        "my name is Inov, email is inoveka@gmail.com, i want 19th july for 2 people",
        "yes please send inquiry"
      ],
      travellerPhone: "6285156246329"
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.bluepassLedger).toEqual([]);
    expect(result.assistantContent).toContain("Fresh chat started");
    expect(result.assistantContent).not.toContain("Calico Jack");
    expect(result.assistantContent).not.toContain("Before I send this to the operator");
    expect(result.assistantContent).not.toContain("I prepared BluePass inquiry");
  });

  it("does not infer operator mode from old history when the latest message resets the chat", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "start over",
      priorTravellerMessages: ["I run a liveaboard in Komodo", "what commission does BluePass take?"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Fresh chat started");
    expect(result.assistantContent).toContain("compare BluePass liveaboards");
    expect(result.assistantContent).not.toContain("operator onboarding");
    expect(result.assistantContent).not.toContain("82%");
  });

  it("answers gratitude without repeating the latest inquiry confirmation", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "ok thanks bro",
      travellerPhone: "6285156246329",
      priorTravellerMessages: [
        "i want to order calico jack",
        "my name is Inov, email is inoveka@gmail.com, i want 19th july for 2 people",
        "yes please send inquiry"
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Anytime");
    expect(result.assistantContent).not.toContain("I can prepare a BluePass operator inquiry");
    expect(result.assistantContent).not.toContain("Please share your");
    expect(result.suggestedReplies).toBeNull();
  });

  it("recommends alternatives instead of repeating the selected yacht when the traveller asks for anything else", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "can i order anything else? like do you have recommendations?",
      priorTravellerMessages: ["can you give me recommendation in komodo?", "i want to order calico jack"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).not.toContain("Calico Jack is a");
    expect(result.assistantContent).not.toContain("Please share your name");
  });

  it("excludes the named yacht when the traveller asks for something rather than it", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "is there anything else rather than calico?",
      priorTravellerMessages: ["liveaboards in komodo", "i want to order calico jack"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("besides Calico Jack");
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).not.toContain("Calico Jack is a");
  });

  it("tapping 'Something else' still avoids the previously shown cards when no yacht was ever named, via the known-destination top-3 fallback exclusion", async () => {
    const first = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "liveaboards in komodo",
      priorTravellerMessages: []
    });
    const second = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Something else",
      priorTravellerMessages: ["liveaboards in komodo"]
    });

    // resolveRecommendationExcludedYachts only reads traveller-typed yacht names, so on its own it
    // would exclude nothing here (no yacht was ever typed). But the RECOMMENDATION case has its own
    // fallback for exactly this case: an "other options" request with an empty exclusion set and a
    // known destination falls back to excluding that destination's top-3 default matches, so the
    // cards shown a turn ago do not resurface.
    const firstSlugs = new Set(first.bluepassMatches.map((match) => match.slug));
    expect(second.bluepassMatches.some((match) => firstSlugs.has(match.slug))).toBe(false);
  });

  it("does not repeat the first Komodo shortlist when the traveller asks beyond those options", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "anything besides those 3?",
      priorTravellerMessages: ["liveaboards in komodo"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toMatch(/Anne Bonny|Celestia|Dunia Baru|Jakare|Katharina|Mischief|Mutiara Laut/);
    expect(result.assistantContent).not.toContain("Alila Purnama -");
    expect(result.assistantContent).not.toContain("Calico Jack -");
    expect(result.assistantContent).not.toContain("Alexa -");
    expect(result.assistantContent).not.toContain("Please share your name");
  });

  it("switches destinations when the traveller asks for somewhere else instead of Komodo", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "somewhere else instead of komodo, do you have any?",
      priorTravellerMessages: ["liveaboards in komodo"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Raja Ampat");
    expect(result.assistantContent).toMatch(/Aliikai|Amandira|Carpe Diem|Fenides|Majik/);
    expect(result.assistantContent).not.toContain("options in Komodo");
    expect(result.assistantContent).not.toContain("Please share your name");
  });

  it("uses the yacht named in the latest message instead of stale history", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Tell me about Anne Bonny",
      priorTravellerMessages: ["liveaboards in komodo", "tell me about alila purnama"]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Anne Bonny");
    expect(result.assistantContent).not.toContain("Alila Purnama is a");
    expect(result.assistantContent).not.toContain("Please share your name");
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
    expect(result.suggestedReplies).toEqual(["Book Alila Purnama", "Book Amandira"]);
  });

  it("caps suggested replies at 3 buttons when comparing three yachts", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Can you compare Alila Purnama, Amandira, and Calico Jack?",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    // Exact-name mentions all score equally, so resolveMentionedYachts breaks the tie by name
    // length descending (Alila Purnama 13 > Calico Jack 11 > Amandira 8) - not sentence order.
    expect(result.suggestedReplies).toEqual(["Book Alila Purnama", "Book Calico Jack", "Book Amandira"]);
  });

  it("compares Komodo and Raja Ampat instead of reusing a stale yacht from history", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "whats better komodo or raja ampat?",
      priorTravellerMessages: [
        "liveaboards in komodo",
        "Tell me about Anne Bonny"
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("Raja Ampat");
    expect(result.assistantContent).toMatch(/different|depends|rule of thumb|better/i);
    expect(result.assistantContent).not.toContain("Anne Bonny is");
    expect(result.assistantContent).not.toContain("Please share your name");
    expect(result.suggestedReplies).toEqual(["Komodo", "Raja Ampat"]);
  });

  it("answers broad Indonesia destination questions instead of reusing a stale yacht", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "is there any better place to go in indonesia?",
      priorTravellerMessages: [
        "can you tell me about celestia?",
        "Celestia looks good but I am still exploring"
      ]
    });

    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("BluePass");
    expect(result.assistantContent).not.toContain("Great choice - Celestia");
    expect(result.assistantContent).not.toContain("Celestia is");
    expect(result.assistantContent).not.toContain("live calendar");
    expect(result.assistantContent).not.toContain("Please share your name");
  });

  it("treats most-beautiful destination questions as travel inspiration instead of booking collection", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "what is most beautiful destination in indonesia?",
      priorTravellerMessages: [
        "tell me about celestia",
        "what is better komodo or raja ampat?"
      ]
    });

    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("BluePass");
    expect(result.assistantContent).not.toContain("Great choice - Celestia");
    expect(result.assistantContent).not.toContain("Celestia is");
    expect(result.assistantContent).not.toContain("operator to confirm availability");
    expect(result.assistantContent).not.toContain("Please share your name");
  });

  it("answers an unmatched general question instead of demanding trip details", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "what about sulawesi? do you know some?",
      priorTravellerMessages: ["is bali good for healing?"]
    });

    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.contactRequest).toBeNull();
    expect(result.assistantContent).toContain("BluePass");
    expect(result.assistantContent).not.toContain("please share your");
    expect(result.assistantContent).not.toContain("date window");
    expect(result.suggestedReplies).toEqual(["Show me yachts"]);
  });

  it("gives an honest answer for out-of-coverage destination questions instead of a bare boat list", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "is bali good for healing?",
      priorTravellerMessages: []
    });

    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.assistantContent).toContain("Komodo and Raja Ampat");
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

  it("keeps showing Komodo matches for ambiguous browsing follow-ups instead of demanding contact details", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const first = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "your recommendation for me? anywhere",
      priorTravellerMessages: []
    });
    expect(first.assistantContent).toContain("Komodo");

    const second = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "in komodo please",
      priorTravellerMessages: ["your recommendation for me? anywhere"]
    });
    expect(second.assistantContent).toContain("Komodo");
    expect(second.assistantContent).not.toContain("Raja Ampat");
    expect(second.assistantContent).not.toContain("Please share your name");
    expect(second.bluepassMatches.length).toBeGreaterThan(0);

    const third = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "in komodo you dumbass",
      priorTravellerMessages: ["your recommendation for me? anywhere", "in komodo please"]
    });
    expect(third.assistantContent).toContain("Komodo");
    expect(third.assistantContent).not.toContain("Raja Ampat");
    expect(third.assistantContent).not.toContain("Please share your name");
    expect(third.bluepassMatches.length).toBeGreaterThan(0);
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
    expect(result.suggestedReplies).toEqual(["Book Alila Purnama", "Something else"]);
  }, 20_000);

  it("treats a follow-up amenity question about 'the boat' as yacht info instead of a missing-fields prompt", async () => {
    // Regression case found from real traffic: once a yacht is already in context, "does the boat
    // have wifi?" must resolve to yacht info (CONCIERGE, polish stays on) rather than falling
    // through to a bare missing-fields prompt (ACTION mode, polish skipped by Fix 1) that would
    // never actually address the traveller's question.
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "does the boat have wifi?",
      priorTravellerMessages: ["Can you tell me about Alila Purnama?"]
    });

    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.assistantContent).toContain("Alila Purnama");
  });

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
    expect(result.suggestedReplies).toEqual(["Send inquiry"]);
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

  it("keeps a full email address when contact details include an inquiry date in the same message", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "my name is Inov, email is inoveka@gmail.com, i want 19th july for 2 people",
      priorTravellerMessages: ["i want to order calico jack"],
      travellerPhone: "6285156246329"
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Calico Jack");
    expect(result.assistantContent).toContain("19 July");
    expect(result.assistantContent).toContain("2 guests");
    expect(result.assistantContent).toContain("Inov");
    expect(result.assistantContent).toContain("inoveka@gmail.com");
    expect(result.assistantContent).toContain("6285156246329");
    expect(result.assistantContent).not.toContain(" com, 628");
  }, 20_000);

  it("keeps recommendation follow-ups in browsing mode after a submitted inquiry exists", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content:
        "Please send inquiry for Calico Jack in Komodo on 19 July for 2 guests. My name is Inov, email inoveka@gmail.com, phone 6285156246329",
      priorTravellerMessages: []
    });

    const result = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "can i order anything else? like do you have recommendations?",
      priorTravellerMessages: [
        "i want to order calico jack",
        "my name is Inov, email is inoveka@gmail.com, i want 19th july for 2 people",
        "yes please send inquiry"
      ]
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).not.toContain("latest BluePass inquiry");
    expect(result.assistantContent).not.toContain("Current status");
    expect(result.assistantContent).not.toContain("Please share your name");
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

  it("creates the inquiry directly when the traveller taps the 'Send inquiry' suggested reply button", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Send inquiry",
      priorTravellerMessages: [
        "can you help me to book alila purnama?",
        "for 29th june 2026, 4 people my name is Eka, email is eka@gmail.com, and phone is 0876634231987"
      ]
    });

    expect(result.bluepassInquiry).toMatchObject({
      status: "OPERATOR_PENDING",
      destination: "Komodo",
      selectedYachtSlug: "alila-purnama"
    });
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

describe("handleBluePassMarketplaceMessage with an LLM router client", () => {
  function fakeRouterClient(decision: {
    action: string;
    destination?: string;
    guests?: number;
    seasonDestination?: "Komodo" | "Raja Ampat" | null;
    gratitude?: boolean;
  }) {
    return {
      route: vi.fn(async () => ({
        action: decision.action as never,
        intent: {
          ...(decision.destination ? { destination: decision.destination } : {}),
          ...(decision.guests ? { guests: decision.guests } : {})
        },
        seasonDestination: decision.seasonDestination ?? null,
        gratitude: decision.gratitude ?? false
      }))
    };
  }

  it("escalates a generic yacht amenity question to the LLM instead of misreading it as a recommendation request", async () => {
    // "does the boat have wifi?" matches RECOMMENDATION's generic \bboats?\b keyword in the regex
    // fallback with zero real trip signal - shouldEscalateBluePassRouterToLlm must still send this
    // to the LLM so it can be correctly classified as a general question, not a yacht recommendation.
    const routerClient = fakeRouterClient({ action: "GENERAL_QUESTION" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "does the boat have wifi?",
      priorTravellerMessages: [],
      routerClient
    });

    expect(routerClient.route).toHaveBeenCalled();
    expect(result.bluepassMatches).toEqual([]);
  });

  it("lets the LLM router classify a message the regex cascade cannot recognize as a general question", async () => {
    // No regex pattern in the fallback cascade matches this phrasing at all - proving the LLM
    // decision, not the regex fallback, is what drives the branch here.
    const routerClient = fakeRouterClient({ action: "GENERAL_QUESTION" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "zxqv nonsense phrase with no matching pattern",
      priorTravellerMessages: [],
      routerClient
    });

    expect(routerClient.route).toHaveBeenCalled();
    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.assistantContent).toContain("Happy to help");
  });

  it("lets the LLM router resolve the destination the regex intent extractor missed", async () => {
    // "show me options please" has no trip signal yet, so it still escalates even though the
    // regex fallback alone would confidently (but genericly) resolve to RECOMMENDATION.
    const routerClient = fakeRouterClient({ action: "RECOMMENDATION", destination: "Raja Ampat" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "show me options please",
      priorTravellerMessages: [],
      routerClient
    });

    expect(routerClient.route).toHaveBeenCalled();
    expect(result.assistantContent).toContain("Raja Ampat");
    expect(result.assistantContent).not.toContain("Komodo");
  });

  it("never consults the LLM for a yacht-info question the regex cascade already resolves confidently", async () => {
    const routerClient = fakeRouterClient({ action: "YACHT_COMPARISON" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "tell me about Alila Purnama",
      priorTravellerMessages: [],
      routerClient
    });

    // YACHT_INFO is a high-confidence fallback action, so the router LLM is never called at all -
    // the regex cascade alone (not a rejected LLM verdict) is what resolves this as yacht info.
    expect(routerClient.route).not.toHaveBeenCalled();
    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.assistantContent).not.toContain("versus");
  });

  it("never consults the LLM to submit an inquiry once a destination is already known from history", async () => {
    const routerClient = fakeRouterClient({ action: "SUBMIT_INQUIRY" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "yes go ahead",
      priorTravellerMessages: ["in komodo please"],
      routerClient
    });

    // The regex fallback confidently resolves this to BROWSE_OPTIONS (destination is already known
    // from history, so it is not treated as an open general question) - the router LLM claiming
    // SUBMIT_INQUIRY is never even consulted, so there is nothing to reject here. No inquiry is
    // created either way, since name/email/phone/guests/dates were never provided.
    expect(routerClient.route).not.toHaveBeenCalled();
    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
  });

  it("falls back to the regex cascade when the router client throws", async () => {
    // Content chosen so the regex fallback resolves to GENERAL_QUESTION (no trip signal at all),
    // which always escalates - otherwise the throwing client would never actually be invoked.
    const routerClient = { route: vi.fn(async () => { throw new Error("network timeout"); }) };
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "why is the sky blue",
      priorTravellerMessages: [],
      routerClient
    });

    expect(routerClient.route).toHaveBeenCalled();
    expect(result.replyMode).toBe("CONCIERGE");
  });
});

describe("shouldEscalateBluePassRouterToLlm", () => {
  const emptyIntent = {} as BluePassInquiryIntent;

  it("always escalates when the regex fallback itself is a general question", () => {
    expect(
      shouldEscalateBluePassRouterToLlm({
        fallbackAction: "GENERAL_QUESTION",
        content: "does the boat have wifi?",
        intent: emptyIntent,
        selectedYacht: null
      })
    ).toBe(true);
  });

  it("escalates a recommendation-shaped message with no real trip signal", () => {
    // Same trap as "does the boat have wifi?" - a generic keyword collision, not a real
    // recommendation request, so it must not be trusted without an LLM check.
    expect(
      shouldEscalateBluePassRouterToLlm({
        fallbackAction: "RECOMMENDATION",
        content: "does the boat have wifi?",
        intent: emptyIntent,
        selectedYacht: null
      })
    ).toBe(true);
  });

  it("does not escalate a recommendation-shaped message once a destination is already known", () => {
    expect(
      shouldEscalateBluePassRouterToLlm({
        fallbackAction: "RECOMMENDATION",
        content: "show me options please",
        intent: { destination: "Komodo" } as BluePassInquiryIntent,
        selectedYacht: null
      })
    ).toBe(false);
  });

  it("does not escalate a high-confidence fallback action like a direct value question", () => {
    expect(
      shouldEscalateBluePassRouterToLlm({
        fallbackAction: "VALUE_QUESTION",
        content: "what is bluepass?",
        intent: emptyIntent,
        selectedYacht: null
      })
    ).toBe(false);
  });

  it("named residual gap: does not escalate once a yacht is already selected, even with no other trip signal", () => {
    // isBluePassOpenGeneralQuestion short-circuits to false whenever a yacht is already selected,
    // so a mid-conversation "does the boat have wifi?" about an already-selected yacht is not caught
    // by this trigger - a pre-existing gap in the regex itself, not something this function can close.
    const selectedYacht = { slug: "alila-purnama" } as BluePassYachtCatalogItem;
    expect(
      shouldEscalateBluePassRouterToLlm({
        fallbackAction: "RECOMMENDATION",
        content: "does the boat have wifi?",
        intent: emptyIntent,
        selectedYacht
      })
    ).toBe(false);
  });
});
