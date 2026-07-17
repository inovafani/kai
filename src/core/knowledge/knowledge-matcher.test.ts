import { describe, expect, it } from "vitest";
import {
  isPolicyShapedQuestion,
  matchKnowledgeEntry,
  matchesHandoffKeywords,
  parseKnowledgePack,
  summarizeKnowledgePack,
} from "./knowledge-matcher";
import { EMPTY_KNOWLEDGE_PACK, type OperatorKnowledgePack } from "./types";

function packWith(entries: OperatorKnowledgePack["entries"]): OperatorKnowledgePack {
  return { ...EMPTY_KNOWLEDGE_PACK, entries };
}

const cancellation = {
  id: "cancellation-policy",
  question: "What is your cancellation and refund policy?",
  answer: "Full refund up to 48 hours before departure; 50% inside 48 hours.",
  keywords: ["cancel", "cancellation", "refund", "reschedule"],
  category: "policies" as const,
  isPolicy: true,
};
const meetingPoint = {
  id: "meeting-point",
  question: "Where and what time do we meet?",
  answer: "We meet at the Labuan Bajo marina gate at 7am.",
  keywords: ["where", "meet", "meeting point", "what time"],
  category: "logistics" as const,
  isPolicy: false,
};

describe("matchKnowledgeEntry", () => {
  it("matches a cancellation question to the policy entry", () => {
    const pack = packWith([cancellation, meetingPoint]);
    expect(matchKnowledgeEntry("do you refund if I cancel?", pack)?.id).toBe("cancellation-policy");
    expect(matchKnowledgeEntry("what's the cancellation policy", pack)?.id).toBe("cancellation-policy");
  });

  it("matches a logistics question to the meeting-point entry", () => {
    const pack = packWith([cancellation, meetingPoint]);
    expect(matchKnowledgeEntry("where do we meet and what time?", pack)?.id).toBe("meeting-point");
  });

  it("returns null for an unrelated booking message", () => {
    const pack = packWith([cancellation, meetingPoint]);
    expect(matchKnowledgeEntry("I want to book for 4 people next Tuesday", pack)).toBeNull();
  });

  it("returns null when the pack is empty", () => {
    expect(matchKnowledgeEntry("cancellation policy?", EMPTY_KNOWLEDGE_PACK)).toBeNull();
  });

  it("prefers the policy entry on a keyword tie", () => {
    const faqRefund = {
      id: "faq-refund",
      question: "Any refund info?",
      answer: "See our policy page.",
      keywords: ["refund"],
      category: "faq" as const,
      isPolicy: false,
    };
    // Both entries hit the single keyword "refund" — policy must win.
    const pack = packWith([faqRefund, { ...cancellation, keywords: ["refund"] }]);
    expect(matchKnowledgeEntry("refund", pack)?.isPolicy).toBe(true);
  });
});

describe("parseKnowledgePack", () => {
  it("coalesces null, empty object, array, and malformed input to an empty pack", () => {
    expect(parseKnowledgePack(null)).toEqual(EMPTY_KNOWLEDGE_PACK);
    expect(parseKnowledgePack({})).toEqual(EMPTY_KNOWLEDGE_PACK);
    expect(parseKnowledgePack([])).toEqual(EMPTY_KNOWLEDGE_PACK);
    expect(parseKnowledgePack("not json")).toEqual(EMPTY_KNOWLEDGE_PACK);
    expect(parseKnowledgePack(42)).toEqual(EMPTY_KNOWLEDGE_PACK);
  });

  it("round-trips a valid pack and drops entries with no answer", () => {
    const raw = {
      version: 1,
      entries: [cancellation, { id: "broken", answer: "" }],
      escalation: { fallbackToHuman: false, handoffMessage: "Call us.", handoffKeywords: ["injury"] },
      interview: { completedFieldIds: ["cancellation-policy"], lastQuestionId: null, status: "in_progress" },
    };
    const parsed = parseKnowledgePack(raw);
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.entries[0].id).toBe("cancellation-policy");
    expect(parsed.escalation.handoffMessage).toBe("Call us.");
    expect(parsed.interview.completedFieldIds).toEqual(["cancellation-policy"]);
  });

  it("defaults an unknown category to faq and coerces isPolicy", () => {
    const parsed = parseKnowledgePack({ entries: [{ id: "x", answer: "y", category: "weird", isPolicy: "yes" }] });
    expect(parsed.entries[0].category).toBe("faq");
    expect(parsed.entries[0].isPolicy).toBe(false);
  });
});

describe("isPolicyShapedQuestion", () => {
  it("recognises safety/policy-shaped questions", () => {
    expect(isPolicyShapedQuestion("can my 8 year old come?")).toBe(true);
    expect(isPolicyShapedQuestion("what's your refund policy")).toBe(true);
    expect(isPolicyShapedQuestion("is there a minimum age")).toBe(true);
  });

  it("does not flag ordinary trip questions", () => {
    expect(isPolicyShapedQuestion("what's the best reef to see mantas")).toBe(false);
  });
});

describe("matchesHandoffKeywords and summarizeKnowledgePack", () => {
  it("detects operator-defined force-handoff keywords", () => {
    const pack = { ...EMPTY_KNOWLEDGE_PACK, escalation: { ...EMPTY_KNOWLEDGE_PACK.escalation, handoffKeywords: ["injury", "complaint"] } };
    expect(matchesHandoffKeywords("I have a complaint about my last trip", pack)).toBe(true);
    expect(matchesHandoffKeywords("what time do we leave", pack)).toBe(false);
  });

  it("summarizes topics for grounding, null when empty", () => {
    expect(summarizeKnowledgePack(EMPTY_KNOWLEDGE_PACK)).toBeNull();
    const summary = summarizeKnowledgePack(packWith([cancellation, meetingPoint]));
    expect(summary).toContain("cancellation");
    expect(summary).toContain("meet");
  });
});
