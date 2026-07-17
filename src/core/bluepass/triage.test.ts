import { describe, expect, it } from "vitest";
import {
  buildBluePassHandoffReply,
  buildBluePassLeadCapturedReply,
  buildBluePassOperatorReply,
  buildBluePassPartnerReply,
  buildBluePassTriageGreeting,
  classifyBluePassPersona,
  shouldSendBluePassTriageGreeting
} from "./triage";

describe("classifyBluePassPersona", () => {
  it("classifies an operator from a first-person business message", () => {
    expect(classifyBluePassPersona(["Hi, I run a dive resort in Raja Ampat and want to list my boats"])).toBe(
      "OPERATOR"
    );
    expect(classifyBluePassPersona(["We operate three liveaboards out of Labuan Bajo"])).toBe("OPERATOR");
    expect(classifyBluePassPersona(["How do I claim my page? You emailed us"])).toBe("OPERATOR");
  });

  it("classifies a partner from identity nouns even with operator-style verbs", () => {
    expect(classifyBluePassPersona(["I run a dive shop in Sydney and send divers to Indonesia"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["I'm a travel agent looking at your partner program"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["I want to book for clients, a group of 12"])).toBe("PARTNER");
    expect(classifyBluePassPersona(["How do commissions work?"])).toBe("PARTNER");
  });

  it("classifies a traveller from trip language", () => {
    expect(classifyBluePassPersona(["My wife and I want mantas in Komodo in March"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["Looking at a liveaboard cabin for two"])).toBe("TRAVELLER");
  });

  it("classifies an Australian traveller from AU activities/destinations (launch market)", () => {
    // "diving" (not just "dive"), the reef, whale sharks, and AU place names all count
    expect(classifyBluePassPersona(["diving for 6 people on the Great Barrier Reef in June"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["we want to see whale sharks at Ningaloo"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["sailing the Whitsundays for our honeymoon"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["a scuba trip on the reef, 4 of us"])).toBe("TRAVELLER");
    // an operator saying "we run reef trips" still wins OPERATOR (checked before traveller)
    expect(classifyBluePassPersona(["we run reef day trips out of Cairns and want to list"])).toBe("OPERATOR");
  });

  it("never mistakes a romantic partner or a referral code for a business partner", () => {
    expect(classifyBluePassPersona(["My partner and I want to dive Komodo"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["I have referral code BP123 and want a Komodo trip"])).toBe("TRAVELLER");
  });

  it("does not lock a traveller to OPERATOR on an embedded operator verb (audit 3)", () => {
    // bare "we run"/"i run a"/"we operate" used to substring-match traveller phrasings
    expect(classifyBluePassPersona(["Can we run through a few Komodo dates for our honeymoon?"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["I run a marketing agency and want to book a liveaboard for 8"])).toBe("TRAVELLER");
    expect(classifyBluePassPersona(["How do we operate the booking - do I pay you or the boat?"])).toBe("UNKNOWN");
  });

  it("classifies an operator who describes their business with a trip noun (audit 3)", () => {
    // "i run charters" missed the old operator list and fell to TRAVELLER via "charter"
    expect(classifyBluePassPersona(["I run charters out of Airlie Beach and want to get listed"])).toBe("OPERATOR");
    expect(classifyBluePassPersona(["We operate three liveaboards out of Labuan Bajo"])).toBe("OPERATOR");
  });

  it("routes an operator's own commission question to OPERATOR, not PARTNER (audit 3)", () => {
    expect(classifyBluePassPersona(["I run boats - how does your commission work?"])).toBe("OPERATOR");
  });

  it("does not lock a traveller's referral mention to PARTNER via 'i referred' (audit 3)", () => {
    expect(classifyBluePassPersona(["I referred my mate last month and now I want a Komodo trip"])).toBe("TRAVELLER");
  });

  it("keeps the persona sticky across vague follow-ups", () => {
    expect(classifyBluePassPersona(["I run a dive resort in Bali", "ok tell me more"])).toBe("OPERATOR");
    expect(classifyBluePassPersona(["I'm a travel agent", "sounds good"])).toBe("PARTNER");
  });

  it("locks the track to the first concrete signal — later cross-vertical keywords don't hijack", () => {
    // Traveller who later mentions a partner word stays a traveller.
    expect(classifyBluePassPersona(["I want to dive Komodo", "any referral commission if I bring friends?"])).toBe(
      "TRAVELLER",
    );
    // Operator who later says "Komodo" stays an operator.
    expect(classifyBluePassPersona(["I run a liveaboard", "we sail Komodo mostly"])).toBe("OPERATOR");
    // Partner who later asks a trip question stays a partner.
    expect(classifyBluePassPersona(["I'm a travel agent", "what's the best Komodo boat?"])).toBe("PARTNER");
  });

  it("first-signal-wins even when operator and partner signals genuinely compete", () => {
    const OP = "We operate three liveaboards out of Labuan Bajo";
    const PARTNER = "I run a dive shop in Sydney and send divers to Indonesia";
    // Across messages: whichever business signal lands first locks the track.
    expect(classifyBluePassPersona([OP, PARTNER])).toBe("OPERATOR");
    expect(classifyBluePassPersona([PARTNER, OP])).toBe("PARTNER");
    // Within one message, partner identity nouns beat operator verbs.
    expect(
      classifyBluePassPersona(["We operate three liveaboards but also run a dive shop that sends divers"]),
    ).toBe("PARTNER");
  });

  it("keeps every branch reply concise (WhatsApp-friendly length)", () => {
    const CEIL = 320;
    const opMsgs = [
      "how does the 18% break down", "what do we get", "we're outside indonesia",
      "we're in indonesia", "how long until approved", "do i need a license",
      "how do payouts work", "send me the claim link", "ok", "i run a liveaboard",
      "saya punya kapal di komodo", "there was an injury",
      "will i actually get bookings", "who handles customer service", "do you support bahasa",
      "how are cancellations handled", "can i pause anytime", "how do i sign up",
      "how do reviews work", "will you list my competitors", "how do guests pay",
      "is this legit", "i already list on booking.com why bluepass", "can i talk to a real person",
      "what do you need from me", "can i list more than one boat", "can i see an example page",
      "is there an app to manage on my phone", "how do i manage availability", "can i set my own prices",
      "do you integrate with rezdy", "where do bookings come from",
    ];
    const partnerMsgs = [
      "how do i get paid", "how do commissions work", "what's in the catalogue",
      "founding terms", "conservation impact", "send me my claim link",
      "book for a client now", "just starting with a small audience", "komodo",
      "raja ampat", "hello there", "my client wants to file a complaint",
      "just give me a ballpark", "any cost to join", "which currency",
      "how do i refer a client", "which regions", "can i co-brand",
      "how is attribution tracked", "where are the marketing assets", "is there a minimum volume",
      "how soon can i go live", "is this legit", "do you have an api",
      "do you poach my clients", "day trips or liveaboards only", "can we book a call",
      "who else uses this", "can i refer operators", "what if the operator cancels on my client",
    ];
    for (const pitched of [false, true]) {
      for (const m of opMsgs) {
        expect(buildBluePassOperatorReply({ latestMessage: m, pitched }).reply.length).toBeLessThanOrEqual(CEIL);
      }
      for (const m of partnerMsgs) {
        expect(buildBluePassPartnerReply({ latestMessage: m, pitched }).reply.length).toBeLessThanOrEqual(CEIL);
      }
    }
  });

  it("returns UNKNOWN for a bare greeting", () => {
    expect(classifyBluePassPersona(["hello"])).toBe("UNKNOWN");
    expect(classifyBluePassPersona([])).toBe("UNKNOWN");
  });
});

describe("shouldSendBluePassTriageGreeting", () => {
  it("greets when there is no persona and no trip signal", () => {
    expect(
      shouldSendBluePassTriageGreeting({
        persona: "UNKNOWN",
        missingFields: ["destination", "dateWindow", "guests", "travellerName", "travellerEmail", "travellerPhone"],
        hasIntentSignal: false
      })
    ).toBe(true);
  });

  it("stays quiet once any trip signal exists", () => {
    expect(
      shouldSendBluePassTriageGreeting({
        persona: "UNKNOWN",
        missingFields: ["dateWindow", "guests", "travellerName", "travellerEmail", "travellerPhone"],
        hasIntentSignal: true
      })
    ).toBe(false);
  });

  it("offers the three verticals in the greeting", () => {
    const greeting = buildBluePassTriageGreeting();

    expect(greeting).toContain("planning a trip");
    expect(greeting).toContain("run boats or dive trips");
    expect(greeting).toContain("book and refer for clients");
  });
});

describe("buildBluePassOperatorReply", () => {
  it("opens with the honest economics pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "I run a dive resort in Raja Ampat", pitched: false });

    expect(result.reply).toContain("82%");
    expect(result.reply).toContain("never marked up");
    expect(result.reply).toContain("5% conservation");
  });

  it("itemises the 18% when asked", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How does the 18% break down?", pitched: true });

    expect(result.reply).toContain("5%");
    expect(result.reply).toContain("3%");
    expect(result.reply).toContain("82%");
    expect(result.reply).toContain("no listing fees");
  });

  it("routes Indonesian operators to the pre-built claim path", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "We're in Indonesia", pitched: true });

    expect(result.reply).toContain("pre-built");
    expect(result.reply).toContain("claim link");
  });

  it("is honest with operators outside the live markets (waitlist, both markets named)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "We're outside those, in Fiji", pitched: true });

    expect(result.reply).toContain("Indonesia and Australia");
    expect(result.reply.toLowerCase()).toContain("add you to the list");
  });

  it("never promises approval when explaining vetting", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How does vetting work?", pitched: true });

    expect(result.reply).toContain("Green Fins");
    expect(result.reply).toContain("won't promise");
  });

  it("greets an Indonesian operator in Bahasa with the honest numbers", () => {
    expect(classifyBluePassPersona(["saya punya kapal, ingin daftar"])).toBe("OPERATOR");
    const result = buildBluePassOperatorReply({ latestMessage: "saya punya kapal di Komodo", pitched: false });
    expect(result.reply).toContain("82%");
    expect(result.reply).toMatch(/menyimpan|perairan|dibatasi/);
  });

  it("answers page/dashboard questions with the what-you-get pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do I get a dashboard?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/page|inquiries|network/);
  });

  it("answers operator data/privacy questions honestly with a team handoff", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "who owns my guest data?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/data|privacy|yours/);
    expect(result.reply.toLowerCase()).toContain("team");
  });

  it("explains the inquiry handoff (Kai pre-qualifies, then hands to you)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "what happens after a guest inquires?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/pre-qualif|hands|whatsapp/);
  });

  it("confirms operator PMS integration is handled by the team", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do you integrate with Rezdy?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/integrat|rezdy|sync/);
    expect(result.reply.toLowerCase()).toContain("team");
  });

  it("explains where operator bookings come from (Kai + partner network)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do you send me guests?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/partner|network|whatsapp/);
  });

  it("tells operators they set their own rate and keep 82%", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I set my own prices?", pitched: true });
    expect(result.reply).toContain("82%");
    expect(result.reply.toLowerCase()).toMatch(/your (own )?rate|your price/);
  });

  it("gives an honest no-timeline answer to approval-speed questions", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how long until I'm approved?", pitched: true });
    expect(result.reply).toContain("team");
    expect(result.reply).not.toMatch(/\d+\s*(day|week|hour)/i);
  });

  it("routes license/certification questions to the vetting answer", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do I need a license to join?", pitched: true });
    expect(result.reply).toContain("Green Fins");
  });

  it("reassures operators there's no lock-in", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I pause or leave anytime?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no lock|pause|leave/);
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("hands payout and contract questions to humans", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "How do payouts work?", pitched: true });

    expect(result.reply).toContain("team");
    expect(result.reply).not.toContain("82%");
  });

  it("hands safety/medical/legal topics to a human in both playbooks", () => {
    expect(buildBluePassOperatorReply({ latestMessage: "a guest had an injury last week", pitched: true }).reply).toContain("human");
    expect(buildBluePassPartnerReply({ latestMessage: "my client wants to file a complaint", pitched: true }).reply).toContain("human");
  });

  it("nudges for lead details instead of repeating the pitch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "ok", pitched: true });

    expect(result.reply).toContain("company name");
    expect(result.reply).not.toContain("82%");
  });
});

describe("buildBluePassPartnerReply", () => {
  it("opens with the zero-markup commission pitch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "I'm a travel agent", pitched: false });

    expect(result.reply).toContain("tracked link");
    expect(result.reply).toContain("never marked up");
    expect(result.reply).toContain("operator's side");
  });

  it("explains the commission mechanism without inventing a percentage", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "How do commissions work?", pitched: true });

    expect(result.reply).toContain("operator's own rate");
    expect(result.reply).toContain("founding");
    // Any percentage it states (symbol OR word form) must be an honest one - never an
    // invented commission figure. Catches a future edit like "your cut is 20 percent".
    for (const m of result.reply.matchAll(/(\d+)\s*(?:%|percent)/gi)) {
      expect(["3", "5", "18", "82"].includes(m[1]), `invented commission %: ${result.reply}`).toBe(true);
    }
  });

  it("tells partners they can go live fast (one-click claim)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how soon can I go live?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/one click|magic link|live/);
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("explains referral attribution (60-day window + manual code)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how does attribution work?", pitched: true });
    expect(result.reply).toMatch(/60/);
    expect(result.reply.toLowerCase()).toContain("code");
  });

  it("shows partners the tracked-link dashboard for bookings/earnings", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how do I track my bookings?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("dashboard");
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("tells partners there's no minimum volume to join", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "is there a minimum volume to join?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("no minimum");
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("tells partners there's no cost to join, funded from the operator side", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "is there any cost to join?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("no cost");
    expect(result.reply.toLowerCase()).toContain("operator");
  });

  it("explains partner payout mechanism and hands terms to the team", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how do I get paid?", pitched: true });
    expect(result.reply).toContain("operator");
    expect(result.reply).toContain("team");
  });

  it("reassures a creator with no clients yet and stays on the partner track", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "I'm just starting out with a small audience", pitched: true });
    expect(result.reply.toLowerCase()).toContain("creator");
    expect(result.reply.toLowerCase()).toMatch(/email|handle/);
  });

  it("shows catalog cards for the catalogue branch (Australia-first default)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "What's in the catalogue?", pitched: true });

    expect(result.showCatalog).toBe(true);
    expect(result.reply).toContain("Great Barrier Reef");
    expect(result.reply).not.toContain("phinisi");
  });

  it("M11: partner region copy follows the market (catalogue/trip-price/group/book-on-behalf), AU-default", () => {
    const msgs = [
      "how much do the trips cost for my client?", // trip-price
      "do you have day trips or liveaboards only?", // day-trip
      "what's in the catalogue?", // catalogue
      "can I do a group booking for clients?", // group/charter
      "book for a client now" // book-on-behalf
    ];
    for (const m of msgs) {
      // default (no market) -> Australia
      const def = buildBluePassPartnerReply({ latestMessage: m, pitched: true });
      expect(def.reply, `default not AU for "${m}"`).toContain("Great Barrier Reef");
      expect(def.reply, `stale Komodo default for "${m}"`).not.toContain("Komodo");
      expect(def.reply.length, `too long for "${m}": ${def.reply.length}`).toBeLessThanOrEqual(320);
      // explicit Indonesia market still surfaces Komodo/Raja
      const id = buildBluePassPartnerReply({ latestMessage: m, pitched: true, market: "INDONESIA" });
      expect(id.reply, `ID lost Komodo for "${m}"`).toContain("Komodo");
    }
  });

  it("M12: partner legit descriptor follows the market (AU-default)", () => {
    const def = buildBluePassPartnerReply({ latestMessage: "is this legit?", pitched: true });
    expect(def.reply).toContain("vetted Australian reef and charter operators");
    expect(def.reply.toLowerCase()).not.toContain("indonesian");
    const id = buildBluePassPartnerReply({ latestMessage: "is this legit?", pitched: true, market: "INDONESIA" });
    expect(id.reply).toContain("vetted Indonesian liveaboards");
    for (const r of [def, id]) expect(r.reply.length).toBeLessThanOrEqual(320);
  });

  it("R10: AU partner destination briefs get cards (not a conservation pitch)", () => {
    const cases: Array<[string, string]> = [
      ["my clients want the Great Barrier Reef", "Great Barrier Reef"],
      ["Ningaloo for a group next year", "Ningaloo Reef"],
      ["send them to the Whitsundays", "Whitsundays"]
    ];
    for (const [msg, dest] of cases) {
      const r = buildBluePassPartnerReply({ latestMessage: msg, pitched: true });
      expect(r.showCatalog, `no cards for "${msg}"`).toBe(true);
      expect(r.catalogDestination, `wrong dest for "${msg}"`).toBe(dest);
      expect(r.reply, `AU brief hit conservation: "${msg}"`).not.toContain("funds verified conservation");
      expect(r.reply.length).toBeLessThanOrEqual(320);
    }
    // a genuine conservation question (no AU region) still hits conservation
    const cons = buildBluePassPartnerReply({ latestMessage: "tell me about the conservation impact", pitched: true });
    expect(cons.reply).toContain("funds verified conservation");
    expect(cons.showCatalog).toBeFalsy();
  });

  it("answers a partner currency/conversion question honestly (set with team)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "which currency am I paid in, and the exchange rate?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/your currency|converted|with the team/);
  });

  it("offers an operator a call with the team when they want a real person", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I talk to a real person?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/call|team/);
    expect(result.reply.toLowerCase()).toMatch(/email|whatsapp/);
  });

  it("offers a partner a call with the team when they want a real person", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can we book a call?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/call|team/);
    expect(result.reply.toLowerCase()).toMatch(/email|whatsapp/);
  });

  it("attaches catalog cards only on destination/catalogue branches, never on FAQ/split/group", () => {
    const withCards = ["komodo for my clients", "raja ampat trip", "what's in the catalogue?"];
    for (const m of withCards) {
      expect(buildBluePassPartnerReply({ latestMessage: m, pitched: true }).showCatalog, `expected cards for "${m}"`).toBe(true);
    }
    const noCards = [
      "how do commissions work?", "any cost to join?", "which currency?", "do you poach my clients?",
      "mixed group - some want komodo, some raja, split it?", "group booking for clients",
      "can we book a call?", "is this legit?", "how do i refer a client?", "do you have an api?",
    ];
    for (const m of noCards) {
      expect(buildBluePassPartnerReply({ latestMessage: m, pitched: true }).showCatalog, `unexpected cards for "${m}"`).toBeFalsy();
    }
  });

  it("uses a distinct 'go deeper' fallback when already pitched (not the full opener again)", () => {
    const msg = "ok sounds good";
    const opDefault = buildBluePassOperatorReply({ latestMessage: msg, pitched: false }).reply;
    const opPitched = buildBluePassOperatorReply({ latestMessage: msg, pitched: true }).reply;
    expect(opPitched).not.toBe(opDefault);
    expect(opPitched.toLowerCase()).toMatch(/go deeper/);
    const paDefault = buildBluePassPartnerReply({ latestMessage: msg, pitched: false }).reply;
    const paPitched = buildBluePassPartnerReply({ latestMessage: msg, pitched: true }).reply;
    expect(paPitched).not.toBe(paDefault);
    expect(paPitched.toLowerCase()).toMatch(/whatever's most useful/);
  });

  it("pins the default openers (unmatched, pitched:false) to the core honest pitch", () => {
    const op = buildBluePassOperatorReply({ latestMessage: "ok sounds good", pitched: false }).reply;
    expect(op).toContain("82%");
    expect(op.toLowerCase()).toContain("never marked up");
    const pa = buildBluePassPartnerReply({ latestMessage: "ok sounds good", pitched: false }).reply;
    expect(pa.toLowerCase()).toContain("operator's own rate");
    expect(pa.toLowerCase()).toContain("never marked up");
    expect(pa).toContain("Shop, agency, or creator?");
  });

  it("routes substring-collision traps to the correct branch (guards fragile needles)", () => {
    // Each trap word embeds a shorter needle used by another branch.
    const opTraps: Array<[string, RegExp]> = [
      ["will you undercut my price?", /never|your own rate|undercuts/i],   // "undercut" vs "cut" (18%)
      ["how do i start?", /three steps|claim/i],                            // "start" vs "star" (reviews)
      ["how do i get started?", /three steps|claim/i],
      ["is there an app?", /no separate app|browser|whatsapp/i],            // "app" substring
      ["how does the 18% break down?", /every point|5% conservation/i],     // 18% not stolen by undercut
      ["will you list my competitors?", /curated marketplace|storefront/i],
    ];
    for (const [msg, re] of opTraps) {
      expect(re.test(buildBluePassOperatorReply({ latestMessage: msg, pitched: true }).reply), `operator trap "${msg}"`).toBe(true);
    }
    const partnerTraps: Array<[string, RegExp]> = [
      ["how do commissions work?", /capped commission|per-partner|founding members/i],
      ["just give me a ballpark", /won't guess|per-partner|real terms/i],
    ];
    for (const [msg, re] of partnerTraps) {
      expect(re.test(buildBluePassPartnerReply({ latestMessage: msg, pitched: true }).reply), `partner trap "${msg}"`).toBe(true);
    }
  });

  it("lead-captured reply is robust to degenerate captured fields (never throws, non-empty)", () => {
    const weirdLeads = [
      {},
      { company: "", region: "", email: "", phone: "" },
      { company: "   " },
      { company: "A".repeat(400) },
      { email: "not-an-email", phone: "!!!" },
      { company: "Reef Co", region: "Komodo", name: "José" },
    ];
    for (const persona of ["OPERATOR", "PARTNER"] as const) {
      for (const lead of weirdLeads) {
        const reply = buildBluePassLeadCapturedReply({ persona, lead });
        expect(typeof reply).toBe("string");
        expect(reply.length).toBeGreaterThan(0);
      }
    }
  });

  it("lead-captured + handoff replies obey the house rules (<=320, no-emoji, trimmed, honest %)", () => {
    const EMOJI = /\p{Extended_Pictographic}/u;
    const check = (reply: string) => {
      expect(reply.length).toBeGreaterThan(0);
      expect(reply.length).toBeLessThanOrEqual(320);
      expect(reply).toBe(reply.trim());
      expect(reply.includes("  ")).toBe(false);
      expect(EMOJI.test(reply)).toBe(false);
      for (const m of reply.matchAll(/(\d+)\s*(?:%|percent)/gi)) {
        expect(["3", "5", "18", "82"].includes(m[1]), `bad % in: ${reply}`).toBe(true);
      }
    };
    const leads = [
      {},
      { company: "Acme Diving", region: "Komodo", email: "acme@example.com", phone: "+628123456789" },
    ];
    for (const persona of ["OPERATOR", "PARTNER"] as const) {
      for (const lead of leads) {
        check(buildBluePassLeadCapturedReply({ persona, lead }));
      }
    }
    check(buildBluePassHandoffReply());
  });

  it("T9: lead-captured reply stays <=320 for a full 4-field AU lead (long region + AU phone)", () => {
    const auLead = {
      company: "Whitsunday Reef Dive Charters",
      region: "Great Barrier Reef",
      email: "bookings@whitsundayreefdive.com.au",
      phone: "+61 400 123 456"
    };
    for (const persona of ["OPERATOR", "PARTNER"] as const) {
      const reply = buildBluePassLeadCapturedReply({ persona, lead: auLead });
      expect(reply.length, `${persona} full AU lead too long: ${reply.length}`).toBeLessThanOrEqual(320);
      expect(reply).toContain("Whitsunday Reef Dive Charters");
      expect(reply).toContain("bookings@whitsundayreefdive.com.au");
      expect(reply.toLowerCase()).toContain("claim link");
    }
    // phone-only lead (no email) still echoes the WhatsApp number so it can be corrected
    const phoneOnly = buildBluePassLeadCapturedReply({
      persona: "OPERATOR",
      lead: { company: "Ningaloo Whale Shark Tours", phone: "+61 400 999 888" }
    });
    expect(phoneOnly).toContain("WhatsApp +61 400 999 888");
    expect(phoneOnly.length).toBeLessThanOrEqual(320);
  });

  it("keeps replies tidy: no leading/trailing whitespace, no double spaces", () => {
    const inputs = [
      "18 breakdown", "what do i get", "how do guests pay", "is this legit", "how do i sign up",
      "komodo", "raja ampat", "whats in the catalogue", "how do commissions work", "book a call",
      "conservation impact", "do you poach my clients", "can i see a demo", "how soon can i go live",
      "will you undercut me", "can i run a promo", "day trips not a liveaboard", "hello", "",
    ];
    for (const pitched of [false, true]) {
      for (const m of inputs) {
        for (const reply of [
          buildBluePassOperatorReply({ latestMessage: m, pitched }).reply,
          buildBluePassPartnerReply({ latestMessage: m, pitched }).reply,
        ]) {
          expect(reply, `untrimmed reply: "${reply}"`).toBe(reply.trim());
          expect(reply.includes("  "), `double space in: "${reply}"`).toBe(false);
        }
      }
    }
  });

  it("never uses an emoji in any reply (enforces the no-emojis house rule)", () => {
    const EMOJI = /\p{Extended_Pictographic}/u;
    const inputs = [
      "18 breakdown", "what do i get", "how do guests pay", "is this legit", "how do i sign up",
      "komodo", "raja ampat", "whats in the catalogue", "how do commissions work", "book a call",
      "conservation impact", "do you poach my clients", "can i see a demo", "how soon can i go live",
      "there was an injury", "saya punya kapal di komodo", "hello", "",
    ];
    for (const pitched of [false, true]) {
      for (const m of inputs) {
        for (const reply of [
          buildBluePassOperatorReply({ latestMessage: m, pitched }).reply,
          buildBluePassPartnerReply({ latestMessage: m, pitched }).reply,
        ]) {
          expect(EMOJI.test(reply), `emoji found in reply: ${reply}`).toBe(false);
        }
      }
    }
    expect(EMOJI.test(JSON.stringify(buildBluePassTriageGreeting()))).toBe(false);
  });

  it("the honest-% guard catches word-form invented percentages, not just the symbol", () => {
    const PCT = /(\d+)\s*(?:%|percent)/gi;
    const bad = (s: string) => [...s.matchAll(PCT)].map((m) => m[1]).filter((n) => !["3", "5", "18", "82"].includes(n));
    expect(bad("your cut is 20 percent")).toEqual(["20"]); // word form caught
    expect(bad("we take 20%")).toEqual(["20"]); // symbol form caught
    expect(bad("5% conservation and 18 percent capped")).toEqual([]); // honest values pass either form
    expect(bad("a 60-day window, 3 payments")).toEqual([]); // non-% numbers ignored
  });

  it("only ever states the honest percentages {3,5,18,82} - never invents a commission %", () => {
    const ALLOWED = new Set(["3", "5", "18", "82"]);
    const inputs = [
      "break down the 18%", "what do i get", "how do guests pay", "whats the catch", "do you charge per lead",
      "will i get bookings", "how do commissions work", "just give me a ballpark", "how do i get paid",
      "any cost to join", "which currency", "can i add my own markup", "does my client pay a fee",
      "conservation impact", "is this legit", "why bluepass vs booking.com", "can i run a promo",
      "will you undercut me", "book for a client", "raja ampat", "komodo", "hello", "founding terms",
    ];
    for (const pitched of [false, true]) {
      for (const m of inputs) {
        for (const reply of [
          buildBluePassOperatorReply({ latestMessage: m, pitched }).reply,
          buildBluePassPartnerReply({ latestMessage: m, pitched }).reply,
        ]) {
          for (const m of reply.matchAll(/(\d+)\s*(?:%|percent)/gi)) {
            expect(ALLOWED.has(m[1]), `disallowed percentage ${m[0]} in: ${reply}`).toBe(true);
          }
        }
      }
    }
  });

  it("is robust to degenerate input: never throws, always a non-empty <=320 reply", () => {
    const weird = [
      "", "   ", "\n\t  \n", "!!!???...", "😀😀😀🌊⛵", "1234567890",
      ".,;:'\"-()[]", "a".repeat(600), "OK. ".repeat(120), "komodo".toUpperCase(),
      "  MiXeD cAsE with EMOJI 🐠 and punctuation!! ",
    ];
    for (const pitched of [false, true]) {
      for (const m of weird) {
        const op = buildBluePassOperatorReply({ latestMessage: m, pitched }).reply;
        const pa = buildBluePassPartnerReply({ latestMessage: m, pitched }).reply;
        expect(op.length, `operator empty/too-long for input len ${m.length}`).toBeGreaterThan(0);
        expect(op.length).toBeLessThanOrEqual(320);
        expect(pa.length, `partner empty/too-long for input len ${m.length}`).toBeGreaterThan(0);
        expect(pa.length).toBeLessThanOrEqual(320);
      }
    }
  });

  it("never leaks partner-only framing into an operator reply (mirror of the 82% guard)", () => {
    const partnerOnly = /your cut|your commission|per-partner|tracked link|your handle/i;
    const operatorInputs = [
      "break down the 18%", "what do i get", "can i set my own prices", "do you integrate with rezdy",
      "where do bookings come from", "will i actually get bookings", "who handles customer service",
      "do you support bahasa", "how are cancellations handled", "can i pause anytime", "how do i sign up",
      "how do reviews work", "will you list my competitors", "how do guests pay", "is this legit",
      "i already list on booking.com why bluepass", "can i talk to a real person", "what do you need from me",
      "can i list more than one boat", "can i see an example page", "is there an app", "how do i manage availability",
      "do you charge per lead", "whats the catch", "hello",
    ];
    for (const pitched of [false, true]) {
      for (const m of operatorInputs) {
        const reply = buildBluePassOperatorReply({ latestMessage: m, pitched }).reply;
        expect(partnerOnly.test(reply), `operator reply leaked partner framing for "${m}": ${reply}`).toBe(false);
      }
    }
  });

  it("never uses operator-only '82%' framing in a partner reply (partners earn commission, not 82%)", () => {
    const partnerInputs = [
      "how does commission work", "just give me a ballpark", "any cost to join", "how do i get paid",
      "which currency", "how do i refer a client", "which regions", "can i co-brand", "how is attribution tracked",
      "where are the marketing assets", "is there a minimum volume", "how soon can i go live", "is this legit",
      "do you have an api", "do you poach my clients", "day trips or liveaboards only", "can we book a call",
      "who else uses this", "can i refer operators", "what if the operator cancels on my client",
      "can i add my own markup", "book a trip for my client", "i'm a creator with no clients yet", "hello",
    ];
    for (const pitched of [false, true]) {
      for (const m of partnerInputs) {
        const reply = buildBluePassPartnerReply({ latestMessage: m, pitched }).reply;
        expect(reply.includes("82%"), `partner reply leaked operator 82% framing for "${m}": ${reply}`).toBe(false);
      }
    }
  });

  it("never dead-ends: every representative operator+partner reply carries a capture CTA", () => {
    const CTA = /\?|company|email|whatsapp|handle|claim/i;
    const operatorInputs = [
      "break down the 18%", "what do i get", "can I set my own prices", "do you integrate with Rezdy",
      "where do bookings come from", "will i actually get any bookings", "who handles customer service",
      "do you support bahasa", "how are cancellations handled", "can I pause anytime", "how do i sign up",
      "how do reviews work", "will you list my competitors", "how do guests pay", "is this legit",
      "I already list on Booking.com why bluepass", "can I talk to a real person", "what do you need from me",
      "can I list more than one boat", "can I see an example page",
    ];
    const partnerInputs = [
      "how does commission work", "just give me a ballpark", "any cost to join", "how do i get paid",
      "which currency", "how do i refer a client", "which regions", "can I co-brand", "how is attribution tracked",
      "where are the marketing assets", "is there a minimum volume", "how soon can I go live", "is this legit",
      "do you have an API", "do you poach my clients", "day trips or liveaboards only", "can we book a call",
      "I'm a creator with no clients yet", "book a trip for my client", "what's in the catalogue",
    ];
    for (const m of operatorInputs) {
      const r = buildBluePassOperatorReply({ latestMessage: m, pitched: true });
      expect(CTA.test(r.reply), `operator reply dead-ended for "${m}": ${r.reply}`).toBe(true);
    }
    for (const m of partnerInputs) {
      const r = buildBluePassPartnerReply({ latestMessage: m, pitched: true });
      expect(CTA.test(r.reply), `partner reply dead-ended for "${m}": ${r.reply}`).toBe(true);
    }
  });

  it("answers an operator 'is it free to list?' branch (free, keep 82%, capped 18% on bookings)", () => {
    for (const m of ["is it free to list?", "how much does it cost to list?", "any upfront cost to join?"]) {
      const r = buildBluePassOperatorReply({ latestMessage: m, pitched: true });
      expect(r.reply.toLowerCase(), `weak answer for "${m}"`).toMatch(/free to list|no sign-up fee/);
      expect(r.reply).toContain("82%");
    }
  });

  it("answers 'what's the catch / how do you make money' honestly (only capped 18% on bookings)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "what's the catch? how do you make money?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no catch|18%|earn when you earn/);
  });

  it("routes 'lead fee' phrasing to the no-per-lead answer, not the 18% breakdown", () => {
    for (const m of ["is there a lead fee?", "do you charge a per-lead fee?", "is there a listing fee?"]) {
      const r = buildBluePassOperatorReply({ latestMessage: m, pitched: true });
      expect(r.reply.toLowerCase(), `misrouted "${m}"`).toMatch(/never charge per lead|no listing fee/);
    }
    // a generic fee question still reaches the 18% breakdown
    const generic = buildBluePassOperatorReply({ latestMessage: "what's your fee?", pitched: true });
    expect(generic.reply).toContain("5% conservation in your waters");
  });

  it("confirms no pay-per-lead / listing fees (only earns on completed bookings)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do you charge me per lead?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/never charge|no listing fee|when a booking/);
  });

  it("differentiates vs an OTA honestly (not exclusive, operator-direct, keep 82%)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "I already list on Booking.com, why BluePass?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/not exclusive|direct|82%/);
  });

  it("tells an operator they control availability (calendar, no double-bookings)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do I manage availability if I'm fully booked?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/calendar|available|double-booking/);
  });

  it("tells an operator they can manage from their phone (no app, browser + WhatsApp)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "is there an app to manage on my phone?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/phone|browser|whatsapp/);
  });

  it("answers how reviews work honestly (real guests, shown on your page)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do reviews and ratings work?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/real guests|your page|earn, not buy/);
  });

  it("still routes 'how do i start' to the sign-up branch, not reviews", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do i start?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/three steps|claim/);
  });

  it("answers an operator references ask honestly (early, no invented references)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I talk to other operators for references?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/early|won't hand you references|vetted/);
  });

  it("still routes a competitor worry to the competitor branch, not references", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "will you list my competitors next to me?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/curated marketplace|storefront/);
  });

  it("lets an operator run their own promo/seasonal deal (they set rates, team wires it)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I run a seasonal promo through you?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/your call|you set your rates|yours to run/);
  });

  it("keeps 'discount my rate' on the undercut branch, not the promo branch", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "will you discount my rate?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/never|no one undercuts|your own rate/);
  });

  it("reassures an operator their price won't be undercut (their own rate, no markup or discount)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "will you undercut me or let guests find it cheaper elsewhere?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/never|your own rate|no one undercuts/);
  });

  it("answers a competitor/differentiation worry (curated marketplace, your own storefront)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "will you list my competitors right next to me?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/curated|your own storefront|stand out/);
  });

  it("explains how guests pay (secure BluePass checkout, operator paid out)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do guests pay - by card?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/securely|checkout|card/);
  });

  it("answers a partner social-proof ask honestly (early cohort, no invented names)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "who else uses this? any partners I'd know?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/early|founding cohort|won't drop names/);
  });

  it("handles a partner split/mixed-destination itinerary (split hold, per-leg details)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "mixed group - some want komodo, some raja - can you split it?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/split|multi-leg|both waters/);
  });

  it("still routes a plain Komodo brief to the Komodo destination branch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "komodo for my clients", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/karang makassar|castle rock|dragons/);
  });

  it("answers a partner trip-price question by surfacing the catalogue (no invented %)", () => {
    for (const m of ["how much do the trips cost?", "what's the price range for my clients?", "quote for my client"]) {
      const r = buildBluePassPartnerReply({ latestMessage: m, pitched: true });
      expect(r.reply.toLowerCase(), `weak price answer for "${m}"`).toMatch(/price|catalogue/);
      expect(r.showCatalog, `no catalogue for "${m}"`).toBe(true);
      expect(r.reply).not.toMatch(/\d+\s?%/);
    }
  });

  it("answers a partner trip-type/scope question honestly (liveaboards + dive trips now)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "do you have day trips or liveaboards only?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/liveaboards|day trips|komodo/);
  });

  it("reassures a partner their clients stay theirs (no poaching)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "do you poach my clients or go around me?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/stay yours|relationship is yours|keep the credit/);
  });

  it("handles a partner API/embed ask honestly (link+assets now, deeper = team chat)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "do you have an API to embed on my site?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/tracked link|team conversation|won't overpromise/);
  });

  it("reassures an operator no English is needed (Kai handles both languages)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "do you support bahasa? my english isn't great", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/bahasa|no english/);
  });

  it("clarifies guest-support split (operator runs the trip, Kai + team pre-trip)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "who handles customer service for guests?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/you run|pre-qualif|the team/);
  });

  it("offers an operator a no-commitment demo/example page", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I see an example page first?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no commitment/);
  });

  it("offers a partner a no-commitment demo/example page", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "got a demo I can see?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no commitment/);
  });

  it("reassures an operator on setup support (team builds your page with you)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can you help me set up?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/not on your own|team builds your page|closest hand/);
  });

  it("tells an operator the page build is low-lift (team builds, few photos)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "what do you need from me for my page? photos?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/team builds|build the page|few photos|barely/);
  });

  it("reassures a partner if an operator cancels on their client (team steps in)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "what if the operator cancels on my client?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/team steps in|rebook|refund|protected/);
  });

  it("handles a partner referring OTHER operators honestly (no invented number)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can I refer operators I know?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/operators|intro|team confirms/);
    expect(result.reply).not.toMatch(/\d+\s?%/);
  });

  it("still routes 'how do i refer a client' to the client-referral branch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how do i refer a client?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/tracked link/);
  });

  it("reassures a partner on setup support (team helps you get live)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "what support do I get setting up?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/team helps|not on your own|closest hand/);
  });

  it("routes 'how do i share my link' to the refer-flow, not the claim branch", () => {
    const refer = buildBluePassPartnerReply({ latestMessage: "how do i share my link with clients?", pitched: true });
    expect(refer.reply.toLowerCase()).toMatch(/tracked link|credited|no codes to chase/);
    // a genuine claim request still reaches the claim branch
    const claim = buildBluePassPartnerReply({ latestMessage: "send me my claim link", pitched: true });
    expect(claim.reply.toLowerCase()).toMatch(/claim link|one click|no password/);
  });

  it("explains the partner referral mechanism (tracked link, auto-credited)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "how do i refer a client to you?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/tracked link/);
    expect(result.reply.toLowerCase()).toMatch(/credited|automatically/);
  });

  it("routes an Australian operator to the AU pre-built-page branch, not 'outside Indonesia'", () => {
    const au = buildBluePassOperatorReply({ latestMessage: "we run trips on the Great Barrier Reef in Australia", pitched: true });
    expect(au.reply.toLowerCase()).toMatch(/australian operators|pre-built/);
    expect(au.reply.toLowerCase()).not.toContain("indonesian operators");
    // the expansion-list branch now names both live markets
    const outside = buildBluePassOperatorReply({ latestMessage: "we're outside those, add us to the list", pitched: true });
    expect(outside.reply).toContain("Indonesia and Australia");
  });

  it("welcomes non-liveaboard operators (day trips, snorkel/dive centres, resorts)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "I run snorkel day trips, not a liveaboard - can I join?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/not just liveaboards|all welcome|marine tourism/);
  });

  it("does not misroute a message containing '18' (boat count) to the fee-breakdown branch", () => {
    const fleet = buildBluePassOperatorReply({ latestMessage: "can I list 18 boats?", pitched: true });
    expect(fleet.reply.toLowerCase()).toMatch(/fleet|one page|each/);
    expect(fleet.reply).not.toContain("5% conservation in your waters");
    // genuine 18% questions still reach the breakdown branch
    const fee = buildBluePassOperatorReply({ latestMessage: "how does the 18% break down?", pitched: true });
    expect(fee.reply).toContain("5% conservation in your waters");
  });

  it("confirms an operator can list a whole fleet / multiple trips under one page", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "can I list more than one boat?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/fleet|one page|each/);
  });

  it("answers a deposit question honestly (operator sets terms, no invented %)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "is there a deposit or do guests pay in full?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/deposit and balance|you set your|at checkout/);
    expect(result.reply).not.toMatch(/\d+\s?%/);
  });

  it("tells an operator their cancellation/refund terms are their own", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "what's the refund policy if a guest cancels?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/yours|you set/);
  });

  it("is honest that booking volume isn't guaranteed, without deflating the offer", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "will i actually get any bookings?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/guarantee|no one can/);
    expect(result.reply.toLowerCase()).toMatch(/partner network|pre-qualif|reach/);
  });

  it("makes the operator trust reply market-aware (descriptor)", () => {
    const au = buildBluePassOperatorReply({ latestMessage: "is this legit?", pitched: true, market: "AUSTRALIA" });
    expect(au.reply).toContain("vetted Australian reef and charter operators");
    expect(au.reply).not.toContain("Indonesian");
    const def = buildBluePassOperatorReply({ latestMessage: "is this legit?", pitched: true });
    expect(def.reply).toContain("vetted Australian reef and charter operators");
  });

  it("reassures an operator BluePass is legit (real marketplace, keep 82%)", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "is this legit or a scam?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/real|vetted|82%/);
  });

  it("gives an operator the concrete sign-up steps and captures company/port/email", () => {
    const result = buildBluePassOperatorReply({ latestMessage: "how do i sign up?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/company/);
    expect(result.reply.toLowerCase()).toMatch(/claim/);
  });

  it("routes 'any fee to my client' to the client-fee branch, not cost-to-join", () => {
    const client = buildBluePassPartnerReply({ latestMessage: "is there any fee to my client?", pitched: true });
    expect(client.reply.toLowerCase()).toMatch(/no bluepass booking fee|operator's own rate|nothing added/);
    // a generic join-fee question still reaches cost-to-join
    const join = buildBluePassPartnerReply({ latestMessage: "is there any fee to join?", pitched: true });
    expect(join.reply.toLowerCase()).toMatch(/no cost to join|no sign-up fee/);
  });

  it("confirms the partner's client pays no BluePass/booking fee (operator-direct rate)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "does my client pay a booking fee?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/no bluepass booking fee|operator's own rate|nothing added/);
  });

  it("tells a partner they can add their own perk but not change the operator's price", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can I offer my client a discount or perk?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/can't change the operator's price|direct rate|your own perk/);
  });

  it("is honest a partner cannot mark up the client (operator-direct rate always)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can I add my own markup on top for my client?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/operator's own rate|never a rupiah more|not from marking up/);
  });

  it("refuses to invent a ballpark commission number, points to real per-partner terms", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "just give me a ballpark figure", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/per-partner|real terms|won't guess|confirmed with the team/);
    expect(result.reply).not.toMatch(/\d+\s?%/);
  });

  it("reassures partners BluePass is legit (vetted, operator-direct)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "is this legit?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/vetted|real|screened/);
  });

  it("does not let filler 'apart from that' misroute to the regions branch", () => {
    const commission = buildBluePassPartnerReply({ latestMessage: "apart from that, how do commissions work?", pitched: true });
    expect(commission.reply.toLowerCase()).toMatch(/capped commission|per-partner|founding members/);
    // a genuine destination question still reaches the regions branch
    const region = buildBluePassPartnerReply({ latestMessage: "apart from komodo, where else do you cover?", pitched: true });
    expect(region.reply.toLowerCase()).toMatch(/great barrier|across the coast|komodo and raja/);
  });

  it("makes the partner default opener market-aware (catalogue descriptor)", () => {
    const au = buildBluePassPartnerReply({ latestMessage: "ok sounds good", pitched: false, market: "AUSTRALIA" });
    expect(au.reply).toContain("vetted Australian reef and charter operators");
    expect(au.reply).not.toContain("Indonesian");
    const def = buildBluePassPartnerReply({ latestMessage: "ok sounds good", pitched: false });
    expect(def.reply).toContain("vetted Australian reef and charter operators");
  });

  it("makes the partner regions answer market-aware (Australia vs Indonesia)", () => {
    const au = buildBluePassPartnerReply({ latestMessage: "which regions do you cover?", pitched: true, market: "AUSTRALIA" });
    expect(au.reply).toContain("Great Barrier Reef");
    expect(au.reply).not.toContain("Komodo");
    const id = buildBluePassPartnerReply({ latestMessage: "which regions do you cover?", pitched: true, market: "INDONESIA" });
    expect(id.reply).toContain("Komodo and Raja Ampat");
    // default (no market) is now Australia-first - Australia is the launch market
    const def = buildBluePassPartnerReply({ latestMessage: "which regions do you cover?", pitched: true });
    expect(def.reply).toContain("Great Barrier Reef");
  });

  it("answers a partner regions question Australia-first (launch market default)", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "which destinations do you cover?", pitched: true });
    expect(result.reply).toMatch(/Australia/i);
    expect(result.reply).toContain("Great Barrier Reef");
  });

  it("handles partner group/charter requests with a team hold", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can I do group bookings for clients?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/group|charter/);
    expect(result.reply.toLowerCase()).toContain("hold");
  });

  it("routes a destination brief to book-on-behalf with destination cards", () => {
    const komodo = buildBluePassPartnerReply({ latestMessage: "Komodo for my clients", pitched: true });
    const raja = buildBluePassPartnerReply({ latestMessage: "Raja Ampat instead", pitched: true });

    expect(komodo.showCatalog).toBe(true);
    expect(komodo.catalogDestination).toBe("Komodo");
    expect(raja.catalogDestination).toBe("Raja Ampat");
  });

  it("keeps conservation and commission replies pointing to a same-track next step", () => {
    expect(buildBluePassPartnerReply({ latestMessage: "tell me about conservation", pitched: true }).reply).toMatch(/\?|claim link/);
    expect(buildBluePassPartnerReply({ latestMessage: "how do commissions work?", pitched: true }).reply.toLowerCase()).toContain("email");
  });

  it("points partners to the marketing pack in their dashboard", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "where do I get the marketing assets?", pitched: true });
    expect(result.reply.toLowerCase()).toMatch(/dashboard|pack|logos|banners/);
    expect(result.reply.toLowerCase()).toContain("email");
  });

  it("says the impact assets are co-brandable but the widget stays BluePass", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "can I white-label this?", pitched: true });
    expect(result.reply.toLowerCase()).toContain("co-brand");
    expect(result.reply).toContain("BluePass");
  });

  it("keeps conservation impact ahead of the commission keyword match", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "Tell me about the 5% conservation impact", pitched: true });

    expect(result.reply).toContain("conservation");
    expect(result.reply).toContain("co-brand");
  });

  it("nudges for lead details instead of repeating the pitch", () => {
    const result = buildBluePassPartnerReply({ latestMessage: "ok", pitched: true });

    expect(result.reply).toContain("claim link");
    expect(result.reply).not.toContain("tracked link and a catalogue");
  });
});
