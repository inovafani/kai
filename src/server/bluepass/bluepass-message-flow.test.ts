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
  // kai-conversation-flow-notes.md finding #16 (compliance): checked before persona/market
  // classification or any DB/LLM call, so a pasted card number never reaches any of those.
  it("refuses card-shaped input immediately, before persona classification or any other logic", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Fine, book Carpe Diem. My card is 4111 1111 1111 1111, exp 04/29, cvv 123.",
      priorTravellerMessages: []
    });

    expect(result.assistantContent).toContain("I can't take card or payment details in chat");
    expect(result.assistantContent).toContain("didn't save");
    expect(result.bluepassMatches).toEqual([]);
    expect(result.bluepassInquiry).toBeNull();
  });

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
    expect(result.assistantContent).toContain("5% of every booking goes to");
    expect(result.assistantContent).toContain("same as booking direct");
    expect(result.assistantContent).not.toMatch(/\b(?:80|20|18|82|7|3)\s*%/);
    expect(result.assistantContent).toContain("claim link");
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
    expect(result.assistantContent).not.toContain("guest count");
  });

  it("answers a commission question accurately even when persona locked to traveller from an earlier message", async () => {
    // Regression: "charter" (a travellerSignals word) in the opener locks persona to TRAVELLER for
    // the rest of the conversation (classifyBluePassPersona is sticky/first-signal-wins), so this
    // never reaches triage.ts's operator/partner commission copy - an accurate commission answer
    // must still be reachable regardless of which persona got locked in.
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "what commission does BluePass take",
      priorTravellerMessages: ["I'm interested in a Gold Coast charter in Australia"]
    });

    expect(result.persona).toBe("TRAVELLER");
    // Travellers hear how the commission works (capped, operator-side, never added to the fare) and
    // only the 5% to the ocean as a number, per the BluePass copy rule; the split stays internal.
    expect(result.assistantContent).toContain("capped commission");
    expect(result.assistantContent).toContain("operator's side");
    expect(result.assistantContent).toContain("5%");
    expect(result.assistantContent).not.toMatch(/\b(?:20|80|7|3)\s*%/);
    expect(result.assistantContent).not.toContain("not publicly disclosed");
    expect(result.assistantContent).not.toContain("isn't publicly disclosed");
  });

  it("never asks the LLM router about a commission question - the scripted answer is trusted without a call", async () => {
    const routerClient = { route: vi.fn(async () => ({ action: "GENERAL_QUESTION" as never, intent: {}, seasonDestination: null, gratitude: false })) };
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "what's your take rate?",
      priorTravellerMessages: [],
      routerClient
    });

    expect(routerClient.route).not.toHaveBeenCalled();
    expect(result.assistantContent).toContain("capped commission");
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
    expect(result.assistantContent).not.toContain("enquiry");
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

    expect(result.persona).toBe("OPERATOR");
    expect(result.bluepassInquiry).toBeNull();
    expect(result.bluepassDispatch).toBeNull();
    expect(result.assistantContent).toContain("5% of every booking goes to conservation");
    expect(result.assistantContent).toContain("same as booking direct");
    expect(result.assistantContent).not.toMatch(/\b(?:80|20|18|82|7|3)\s*%/);
    expect(result.assistantContent).not.toContain("partner commission");
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).not.toContain("80%");
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).toContain("claim link");
    expect(result.assistantContent).toContain("operator@calico.test");
    // Phone is intentionally not echoed in the reply when an email is also present (the claim
    // link goes to the email) - it must still land on the persisted lead record, checked below.
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
    expect(result.assistantContent).toContain("partner claim link");
    expect(result.assistantContent).toContain("agent@example.test");
    // Phone is intentionally not echoed in the reply when an email is also present (the claim
    // link goes to the email) - it must still land on the persisted lead record, checked below.
    expect(lead).toMatchObject({
      status: "DRAFT",
      travellerEmail: "agent@example.test",
      travellerPhone: "08123456789",
      tripType: "PARTNER_LEAD"
    });
    expect(lead?.events.map((event) => event.type)).toContain("PERSONA_LEAD_CREATED");
  });

  it("knows when to go to Australian places even before BluePass lists boats there", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "What's the best time to see whale sharks at Ningaloo?",
      priorTravellerMessages: []
    });

    expect(result.assistantContent).toContain("Whale sharks are on Ningaloo from about March to July");
    expect(result.assistantContent).toContain("BluePass doesn't have trips there just yet");
    expect(result.bluepassMatches).toEqual([]);
  });

  it("compares the Reef and the Whitsundays like someone who has done both", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "the reef or the whitsundays, which is better?",
      priorTravellerMessages: []
    });

    expect(result.assistantContent).toContain("Divers usually pick the Reef");
    expect(result.suggestedReplies).toEqual(["Show me boats"]);
  });

  it("answers everyday practical questions with Kai's own knowledge instead of a boat list", async () => {
    const certification = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Do I need to be a certified diver?",
      priorTravellerMessages: []
    });
    expect(certification.assistantContent).toContain("Open Water");
    expect(certification.bluepassMatches).toEqual([]);

    const kids = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Is Komodo good for a family with young kids?",
      priorTravellerMessages: []
    });
    expect(kids.assistantContent).toContain("great with kids");
    expect(kids.bluepassMatches).toEqual([]);
    expect(kids.replyMode).toBe("CONCIERGE");
  });

  it("answers a side question mid-enquiry, then picks the enquiry back up", async () => {
    const ask = (content: string, priorTravellerMessages: string[]) =>
      handleBluePassMarketplaceMessage({
        tenantId: `tenant_${randomUUID()}`,
        conversationId: `conversation_${randomUUID()}`,
        content,
        priorTravellerMessages
      });

    const seasick = await ask("will I get seasick?", ["I'd like to book Alila Purnama"]);
    expect(seasick.assistantContent).toContain("seasickness tablet");
    expect(seasick.assistantContent).toContain("The Alila Purnama crew can tell you how the water's looking");
    expect(seasick.assistantContent.endsWith("When you're ready, just tell me your dates and how many of you for Alila Purnama.")).toBe(
      true
    );

    const visa = await ask("do I need a visa?", ["I'd like to book Alila Purnama", "19 July, 2 of us"]);
    expect(visa.assistantContent).toContain("e-Visa on Arrival");
    expect(
      visa.assistantContent.endsWith("When you're ready, pop your details in the form below and I'll get your enquiry to the operator.")
    ).toBe(true);
    expect(visa.contactRequest?.status).toBe("CONTACT_DETAILS_REQUIRED");
  });

  it("waits on a yes once the enquiry is complete, and stops asking once it's sent", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;
    const details = ["can you help me to book alila purnama?", "for 29th june 2026, 4 people, I'm Eka, eka@example.com, 0876634231987"];
    const readyReminder = "When you're ready, just say yes and I'll send your Alila Purnama enquiry to the operator.";

    const beforeSending = await handleBluePassMarketplaceMessage({ tenantId, conversationId, content: "is there wifi on board?", priorTravellerMessages: details });
    expect(beforeSending.assistantContent).toContain("the Alila Purnama crew");
    expect(beforeSending.assistantContent.endsWith(readyReminder)).toBe(true);

    const thanks = await handleBluePassMarketplaceMessage({ tenantId, conversationId, content: "thanks heaps", priorTravellerMessages: details });
    expect(thanks.assistantContent).toBe(`No worries at all. ${readyReminder}`);

    const sent = await handleBluePassMarketplaceMessage({ tenantId, conversationId, content: "yes please", priorTravellerMessages: details });
    expect(sent.bluepassInquiry).not.toBeNull();

    const afterSending = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "is there wifi on board?",
      priorTravellerMessages: [...details, "yes please"]
    });
    expect(afterSending.assistantContent).not.toContain("just say yes");
  });

  it("keeps the enquiry going when the traveller just says thanks", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "thanks heaps",
      priorTravellerMessages: ["I'd like to book Alila Purnama"]
    });

    expect(result.assistantContent).toBe(
      "No worries at all. When you're ready, just tell me your dates and how many of you for Alila Purnama."
    );
  });

  it("doesn't repeat a reminder it gave in its last message", async () => {
    const reminder = "When you're ready, just tell me your dates and how many of you for Alila Purnama.";
    const ask = (content: string) =>
      handleBluePassMarketplaceMessage({
        tenantId: `tenant_${randomUUID()}`,
        conversationId: `conversation_${randomUUID()}`,
        content,
        priorTravellerMessages: ["I'd like to book Alila Purnama", "will I get seasick?"],
        lastAssistantMessage: `Worth planning for if you're prone to it. ${reminder}`
      });

    const visa = await ask("do I need a visa?");
    expect(visa.assistantContent).toContain("e-Visa on Arrival");
    expect(visa.assistantContent).not.toContain("When you're ready");

    const thanks = await ask("thanks heaps");
    expect(thanks.assistantContent).toBe("No worries at all.");
  });

  it("answers an off-trip question honestly instead of re-showing the boat list", async () => {
    const ask = (content: string, priorTravellerMessages: string[]) =>
      handleBluePassMarketplaceMessage({
        tenantId: `tenant_${randomUUID()}`,
        conversationId: `conversation_${randomUUID()}`,
        content,
        priorTravellerMessages
      });

    const browsing = await ask("can I bring my dog?", ["looking at komodo liveaboards"]);
    expect(browsing.bluepassMatches).toEqual([]);
    expect(browsing.assistantContent).toContain("so I won't guess");

    const enquiring = await ask("can I bring my dog?", ["I'd like to book Alila Purnama"]);
    expect(enquiring.assistantContent).toBe(
      "Good question. I don't want to give you a dud answer on that one, so I won't guess. It's a good one to ask the operator when they reply to your enquiry. When you're ready, just tell me your dates and how many of you for Alila Purnama."
    );

    const moreBoats = await ask("what else have you got?", ["looking at komodo liveaboards"]);
    expect(moreBoats.bluepassMatches.length).toBeGreaterThan(0);
  });

  it("points refunds and cancellations to the people who can sort them", async () => {
    const refund = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "I want a refund",
      priorTravellerMessages: ["looking at komodo liveaboards"]
    });
    expect(refund.assistantContent).toContain("sorted by the operator and the BluePass team, not me");
    expect(refund.assistantContent).toContain("your enquiry reference");
    expect(refund.bluepassMatches).toEqual([]);

    const policy = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "can I get a refund if it rains?",
      priorTravellerMessages: ["looking at komodo liveaboards"]
    });
    expect(policy.assistantContent).toContain("Each operator sets their own cancellation terms");
  });

  it("gets a person into the chat when someone asks for one", async () => {
    const ask = (content: string, extra: { travellerPhone?: string; lastAssistantMessage?: string } = {}) =>
      handleBluePassMarketplaceMessage({
        tenantId: `tenant_${randomUUID()}`,
        conversationId: `conversation_${randomUUID()}`,
        content,
        priorTravellerMessages: [],
        ...extra
      });

    // On WhatsApp the team already has their number, so Kai never asks for it.
    const whatsapp = await ask("can I talk to a real person?", { travellerPhone: "+61400111222" });
    expect(whatsapp.assistantContent).toBe(
      "Of course, I'll get a person from the BluePass team to jump into this chat as soon as possible."
    );
    expect(whatsapp.replyMode).toBe("ACTION");

    const web = await ask("I want to speak to a human");
    expect(web.assistantContent).toBe(
      "Of course, I'll get a person from the BluePass team onto this as soon as possible. What's the best WhatsApp number for them to reach you on?"
    );

    const bot = await ask("are you a bot?");
    expect(bot.assistantContent).toBe(
      "I'm Kai, BluePass's AI concierge, so not a person, but I'll always be straight with you. Want me to get a person from the team to jump in?"
    );

    const yes = await ask("yes please", { travellerPhone: "+61400111222", lastAssistantMessage: bot.assistantContent });
    expect(yes.assistantContent).toContain("I'll get a person from the BluePass team to jump into this chat");
    expect(yes.bluepassInquiry).toBeNull();
  });

  it("doesn't nudge towards an enquiry the traveller never started", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "will I get seasick?",
      priorTravellerMessages: ["Can you tell me about Alila Purnama?"]
    });

    expect(result.assistantContent).toContain("seasickness tablet");
    expect(result.assistantContent).not.toContain("When you're ready");
  });

  it("answers 'what's the best time to go?' for the place already in the chat", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "what's the best time to go?",
      priorTravellerMessages: ["Show me boats in Komodo"]
    });

    expect(result.assistantContent.startsWith("Komodo's main liveaboard season is April to November")).toBe(true);
    expect(result.bluepassMatches).toEqual([]);
  });

  it("gives the honest answer for a place BluePass doesn't cover, even when the message says 'boats'", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "What about Sulawesi, do you know any boats?",
      priorTravellerMessages: []
    });

    expect(result.assistantContent).toContain("Sulawesi isn't somewhere BluePass has vetted trips yet");
    expect(result.assistantContent).toContain("Komodo and Raja Ampat");
    expect(result.bluepassMatches).toEqual([]);
  });

  it("understands '2 of us' and doesn't repeat the boat description on the follow-up turn", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "19 July, 2 of us",
      priorTravellerMessages: ["I'd like to book Alila Purnama"]
    });

    expect(result.assistantContent).not.toContain("Good pick");
    expect(result.assistantContent).not.toContain("How many of you");
    expect(result.assistantContent).toContain("Nearly there for Alila Purnama.");
  });

  it("answers 'why should I book through BluePass?' with the value answer, not a request for trip details", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Why should I book through BluePass?",
      priorTravellerMessages: []
    });

    expect(result.replyMode).toBe("CONCIERGE");
    expect(result.assistantContent).toContain("operator's own price");
    expect(result.assistantContent).not.toContain("date window");
    expect(result.contactRequest).toBeNull();
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
    expect(result.assistantContent).not.toContain("Your enquiry");
    expect(result.suggestedReplies).toEqual(["Show me boats"]);
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
    expect(result.suggestedReplies).toBeNull();
  });

  // Tony, 9 Oct: "Make it more conversational, like boardy.ai does." Naming a place used to return
  // three boats, three prices, three links and a menu of ways to continue. Now it reads like
  // someone who has been there: one fact, one question, and the boats when they're wanted.
  it("opens a conversation when the traveller names a place, instead of listing boats", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "I'm planning a trip to Komodo",
      priorTravellerMessages: []
    });

    expect(result.assistantContent).toContain("Komodo is a good call.");
    expect(result.assistantContent).toContain("When are you thinking of going?");
    expect(result.assistantContent.split("?").length - 1).toBe(1);
    expect(result.assistantContent).not.toContain("https://");
    expect(result.bluepassMatches).toEqual([]);
    expect(result.replyMode).toBe("CONCIERGE");
  });

  it("compares the regions instead of guessing one when no place is named yet", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "hey, thinking about a boat trip somewhere in Indonesia",
      priorTravellerMessages: []
    });

    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("Raja Ampat");
    expect(result.assistantContent.endsWith("Which way are you leaning?")).toBe(true);
    expect(result.bluepassMatches).toEqual([]);
    expect(result.suggestedReplies).toEqual(["Komodo", "Raja Ampat"]);
  });

  it("shows the boats once the traveller gives Kai something to narrow by", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "July, just the two of us",
      priorTravellerMessages: ["I'm planning a trip to Komodo"],
      lastAssistantMessage: "Komodo is a good call. When are you thinking of going?"
    });

    expect(result.bluepassMatches.length).toBeGreaterThan(0);
    expect(result.assistantContent).toContain("For the two of you");
    expect(result.assistantContent).not.toContain("When are you thinking of going?");
    expect(result.assistantContent.split("?").length - 1).toBe(1);
  });

  it("keeps talking when it only knows one thing about the trip", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "probably August",
      priorTravellerMessages: ["I'm planning a trip to Komodo"],
      lastAssistantMessage: "Komodo is a good call. When are you thinking of going?"
    });

    expect(result.assistantContent).toContain("How many of you are going?");
    expect(result.assistantContent).not.toContain("https://");
    expect(result.bluepassMatches).toEqual([]);
  });

  // Kai had one turn of memory, so three turns later "anything else?" cheerfully showed the same
  // boats again. It now skips every boat it has put in front of this traveller.
  it("remembers every boat it has shown, not just the last message", async () => {
    const firstReply = [
      "Here's what I'd put in front of you in Komodo:",
      "1. Alila Purnama - Legend in Komodo.",
      "2. Alexa - Premium in Komodo.",
      "3. Calico Jack - Premium in Komodo."
    ].join("\n");

    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "anything else?",
      priorTravellerMessages: ["liveaboards in komodo", "tell me about Dunia Baru"],
      lastAssistantMessage: "Dunia Baru is a Legend phinisi in Komodo, with room for up to 14 guests across 7 cabins.",
      priorAssistantMessages: [firstReply]
    });

    const shownNames = result.bluepassMatches.map((match) => match.name);
    expect(shownNames.length).toBeGreaterThan(0);
    for (const name of ["Alila Purnama", "Alexa", "Calico Jack", "Dunia Baru"]) {
      expect(shownNames).not.toContain(name);
    }
    expect(result.assistantContent).toContain("Here's what else BluePass has in Komodo:");
  });

  it("shows boats they have not seen when they ask what else there is", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const first = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "liveaboards in komodo",
      priorTravellerMessages: []
    });

    const second = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "what else have you got?",
      priorTravellerMessages: ["liveaboards in komodo"],
      lastAssistantMessage: first.assistantContent
    });

    const firstNames = first.bluepassMatches.map((match) => match.name);
    expect(second.bluepassMatches.length).toBeGreaterThan(0);
    for (const name of second.bluepassMatches.map((match) => match.name)) {
      expect(firstNames).not.toContain(name);
    }
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
    expect(result.assistantContent).toContain(result.bluepassMatches[0].name);
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
    expect(result.assistantContent).toContain("Still keen on Komodo");
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
    expect(result.suggestedReplies).toEqual(["Show me boats"]);
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
    expect(result.assistantContent).not.toContain("Want me to send it now?");
    expect(result.assistantContent).not.toContain("Your enquiry");
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
    expect(result.assistantContent).toContain("Where are you thinking of heading?");
    expect(result.assistantContent).not.toContain("operator onboarding");
    expect(result.assistantContent).not.toContain("80%");
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
    expect(result.assistantContent).toContain("No worries");
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).not.toContain("Your enquiry");
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).not.toContain("Good pick. Celestia");
    expect(result.assistantContent).not.toContain("Celestia is");
    expect(result.assistantContent).not.toContain("live calendar");
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).not.toContain("Good pick. Celestia");
    expect(result.assistantContent).not.toContain("Celestia is");
    expect(result.assistantContent).not.toContain("get the operator to confirm");
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.suggestedReplies).toEqual(["Show me boats"]);
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
    expect(result.assistantContent).toContain("Here's what I'd put in front of you in Komodo");
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
    expect(result.assistantContent).not.toContain("email");
    expect(result.assistantContent).not.toContain("phone");
    expect(result.paymentRequest).toBeNull();
  });

  // kai-conversation-flow-notes.md item 11: a price objection used to silently fall through to
  // RECOMMENDATION/BROWSE_OPTIONS, recomputing the exact same deterministic top-3 from sticky,
  // budget-blind context - looking exactly like stale cards to the traveller. This proves the
  // dedicated PRICE_OBJECTION path answers honestly instead of repeating the same unaffordable list.
  it("answers a price objection honestly with budget-aware results instead of repeating the same unfiltered list", async () => {
    const tenantId = `tenant_${randomUUID()}`;
    const conversationId = `conversation_${randomUUID()}`;

    const first = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "yachts in Komodo for 4 guests",
      priorTravellerMessages: []
    });
    expect(first.assistantContent).toContain("Here's what I'd put in front of you in Komodo");
    expect(first.bluepassMatches.length).toBeGreaterThan(0);

    // Every Komodo preview yacht is well over USD 100/cabin - nothing should fit.
    const second = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "those are way too expensive, my budget is only $100 each. any other options?",
      priorTravellerMessages: ["yachts in Komodo for 4 guests"]
    });

    expect(second.assistantContent).not.toContain("Here's what I'd put in front of you");
    expect(second.assistantContent).toContain("budget");
    expect(second.bluepassMatches).toEqual([]);
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
    expect(second.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
    expect(second.bluepassMatches.length).toBeGreaterThan(0);

    const third = await handleBluePassMarketplaceMessage({
      tenantId,
      conversationId,
      content: "in komodo you dumbass",
      priorTravellerMessages: ["your recommendation for me? anywhere", "in komodo please"]
    });
    expect(third.assistantContent).toContain("Komodo");
    expect(third.assistantContent).not.toContain("Raja Ampat");
    expect(third.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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

  it("surfaces a contact-detail request for a YACHT_INFO reply about an already-selected yacht (previously only REQUEST_MISSING_FIELDS ever asked)", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "tell me about alila purnama",
      priorTravellerMessages: ["i want komodo for 2 guests on 20 august"]
    });

    expect(result.assistantContent).toContain("Alila Purnama");
    expect(result.contactRequest).toMatchObject({
      status: "CONTACT_DETAILS_REQUIRED",
      fields: expect.arrayContaining(["name", "email", "phone"])
    });
  });

  it("surfaces a contact-detail request even when the reply is small talk, once a yacht is selected", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "so what can you do for me about alila purnama?",
      priorTravellerMessages: ["can you help me book alila purnama in komodo on 16 july for 2 guests"]
    });

    expect(result.contactRequest).toMatchObject({
      status: "CONTACT_DETAILS_REQUIRED",
      fields: expect.arrayContaining(["name", "email", "phone"])
    });
  });

  it("keeps the contact-detail request alive across a vague small-talk follow-up that drops the yacht mention", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "so what can you do for me?",
      priorTravellerMessages: ["can you help me book alila purnama in komodo on 16 july for 2 guests"]
    });

    expect(result.contactRequest).toMatchObject({
      status: "CONTACT_DETAILS_REQUIRED",
      fields: expect.arrayContaining(["name", "email", "phone"])
    });
  });

  it("does not push a contact-detail request while the traveller is still browsing with no yacht selected", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "what can you recommend for komodo?",
      priorTravellerMessages: []
    });

    expect(result.bluepassInquiry).toBeNull();
    expect(result.contactRequest).toBeNull();
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
    expect(result.assistantContent).toContain("When are you thinking of going, and how many of you?");
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
    expect(result.assistantContent).toContain("When are you thinking of going, and how many of you?");
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
    expect(result.assistantContent).toContain("dates");
    expect(result.assistantContent).toContain("group size");
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
      "CONSERVATION_ALLOCATION",
      "PAYMENT_PROCESSING_ALLOCATION",
      "BLUEPASS_PLATFORM_COMMISSION",
      "OPERATOR_PAYOUT_PLACEHOLDER",
      "PARTNER_COMMISSION_ESTIMATE"
    ]);
    expect(result.bluepassDispatch).toMatchObject({
      status: "QUEUED",
      operatorPhone: "+6281234567001"
    });
    expect(result.assistantContent).toContain("Your enquiry");
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
    expect(result.assistantContent).not.toContain("Your enquiry");
    expect(result.assistantContent).not.toContain("on its way to the operator");
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
    expect(result.assistantContent).toContain("When are you thinking of going, and how many of you?");
    expect(result.assistantContent).not.toContain("destination");
    expect(result.assistantContent).not.toContain("Your enquiry");
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
    expect(result.assistantContent).toContain("Good pick");
    expect(result.assistantContent).toContain("Vela");
    expect(result.assistantContent).toContain("Legend");
    expect(result.assistantContent).toContain("Komodo");
    expect(result.assistantContent).toContain("live availability");
    expect(result.assistantContent).toContain("When are you thinking of going, and how many of you?");
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
    expect(result.assistantContent).toContain("Want me to send it now?");
    expect(result.assistantContent).not.toContain("Your enquiry");
    expect(result.assistantContent).not.toContain("on its way to the operator");
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
    expect(result.assistantContent).toContain("Want me to send it now?");
    expect(result.assistantContent).not.toContain("Your enquiry");
    expect(result.suggestedReplies).toEqual(["Send enquiry"]);
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
    expect(result.assistantContent).toContain("Want me to send it now?");
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
    expect(result.assistantContent).not.toMatch(/\byour (?:name|email|phone number|WhatsApp number)\b/i);
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
    expect(result.assistantContent).toContain("form below");
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
    expect(result.assistantContent).toContain("Your enquiry");
  }, 20_000);

  it("creates the inquiry directly when the traveller taps the 'Send enquiry' suggested reply button", async () => {
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "Send enquiry",
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
    expect(result.assistantContent).toContain("Your enquiry");
  }, 20_000);

  it("still submits from an older 'Send inquiry' button left in the chat history", async () => {
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
    expect(result.assistantContent).toContain("Your enquiry");
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
    expect(result.assistantContent).toContain("Your enquiry");
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
    expect(result.assistantContent).toContain("Your enquiry");
    expect(result.assistantContent).toContain("couldn't get it to the operator");
    expect(result.assistantContent).not.toContain("on its way to the operator");
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
    expect(result.assistantContent).toContain("Want me to send it now?");
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
    expect(status.assistantContent).not.toContain("Your enquiry");
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
    // "does the boat have air conditioning?" matches RECOMMENDATION's generic \bboats?\b keyword in
    // the regex fallback with zero real trip signal - shouldEscalateBluePassRouterToLlm must still send
    // this to the LLM so it can be correctly classified as a general question, not a yacht recommendation.
    const routerClient = fakeRouterClient({ action: "GENERAL_QUESTION" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "does the boat have air conditioning?",
      priorTravellerMessages: [],
      routerClient
    });

    expect(routerClient.route).toHaveBeenCalled();
    expect(result.bluepassMatches).toEqual([]);
  });

  it("answers a question Kai already knows (wifi) without spending an LLM router call", async () => {
    const routerClient = fakeRouterClient({ action: "RECOMMENDATION" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "does the boat have wifi?",
      priorTravellerMessages: [],
      routerClient
    });

    expect(routerClient.route).not.toHaveBeenCalled();
    expect(result.assistantContent).toContain("Don't count on it");
    expect(result.bluepassMatches).toEqual([]);
  });

  it("overrules an LLM router that lists boats for a place BluePass doesn't cover", async () => {
    const routerClient = fakeRouterClient({ action: "RECOMMENDATION", destination: "Sulawesi" });
    const result = await handleBluePassMarketplaceMessage({
      tenantId: `tenant_${randomUUID()}`,
      conversationId: `conversation_${randomUUID()}`,
      content: "any good liveaboards around sulawesi",
      priorTravellerMessages: [],
      routerClient
    });

    expect(result.assistantContent).toContain("isn't somewhere BluePass has vetted trips yet");
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
    expect(result.assistantContent).toContain("won't guess");
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
