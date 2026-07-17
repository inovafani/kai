import {
  EMPTY_KNOWLEDGE_PACK,
  type KnowledgeCategory,
  type OperatorKnowledgeEntry,
  type OperatorKnowledgePack,
} from "./types";

/**
 * Deterministic guest-question → knowledge-entry matching. Pure core so
 * both the generic booking flow and (later) the marketplace flow can use
 * it. The matched entry's answer becomes the deterministic reply; the LLM
 * layer only rephrases it within a requiredFacts guard, so an operator's
 * policy text is never invented or lost.
 */

const CATEGORIES: KnowledgeCategory[] = ["policies", "logistics", "itinerary", "seasonal", "faq"];

const STOPWORDS = new Set([
  "the", "and", "for", "are", "you", "your", "our", "does", "what", "when",
  "where", "how", "any", "can", "will", "with", "that", "this", "have", "has",
  "not", "but", "who", "why", "there", "their", "they", "them", "from",
]);

/**
 * Coalesce any stored value (null, {}, malformed, older) into a valid pack.
 * Mirrors parsePublicProductCatalog: read paths never crash on bad JSON.
 */
export function parseKnowledgePack(raw: unknown): OperatorKnowledgePack {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_KNOWLEDGE_PACK;
  }
  const obj = raw as Record<string, unknown>;
  const entries = Array.isArray(obj.entries)
    ? obj.entries.filter(isValidEntry).map(normalizeEntry)
    : [];
  const esc = (obj.escalation ?? {}) as Record<string, unknown>;
  const interview = (obj.interview ?? {}) as Record<string, unknown>;

  return {
    version: 1,
    entries,
    escalation: {
      fallbackToHuman: typeof esc.fallbackToHuman === "boolean" ? esc.fallbackToHuman : true,
      handoffMessage: typeof esc.handoffMessage === "string" ? esc.handoffMessage : null,
      handoffKeywords: Array.isArray(esc.handoffKeywords)
        ? esc.handoffKeywords.filter((k): k is string => typeof k === "string")
        : [],
    },
    interview: {
      completedFieldIds: Array.isArray(interview.completedFieldIds)
        ? interview.completedFieldIds.filter((k): k is string => typeof k === "string")
        : [],
      lastQuestionId: typeof interview.lastQuestionId === "string" ? interview.lastQuestionId : null,
      status:
        interview.status === "in_progress" || interview.status === "complete"
          ? interview.status
          : "not_started",
    },
  };
}

function isValidEntry(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  return typeof e.id === "string" && typeof e.answer === "string" && e.answer.trim().length > 0;
}

function normalizeEntry(value: Record<string, unknown>): OperatorKnowledgeEntry {
  return {
    id: String(value.id),
    question: typeof value.question === "string" ? value.question : "",
    answer: String(value.answer),
    keywords: Array.isArray(value.keywords)
      ? value.keywords.filter((k): k is string => typeof k === "string")
      : [],
    category: CATEGORIES.includes(value.category as KnowledgeCategory)
      ? (value.category as KnowledgeCategory)
      : "faq",
    isPolicy: value.isPolicy === true,
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

/** Score how well a message matches one entry. Higher = better. */
function scoreEntry(messageLower: string, messageTokens: Set<string>, entry: OperatorKnowledgeEntry): number {
  let keywordHits = 0;
  for (const keyword of entry.keywords) {
    if (keyword && messageLower.includes(keyword.toLowerCase())) keywordHits += 1;
  }
  let overlap = 0;
  for (const token of tokenize(entry.question)) {
    if (messageTokens.has(token)) overlap += 1;
  }
  return keywordHits * 2 + overlap;
}

const MATCH_FLOOR = 2;

/**
 * Best knowledge entry for a guest message, or null if nothing is
 * confidently on-topic. Ties break toward policy entries — those are the
 * answers we most want to serve verbatim rather than let Kai improvise.
 */
export function matchKnowledgeEntry(
  message: string,
  pack: OperatorKnowledgePack,
): OperatorKnowledgeEntry | null {
  if (pack.entries.length === 0) return null;
  const messageLower = message.toLowerCase();
  const messageTokens = new Set(tokenize(message));

  let best: OperatorKnowledgeEntry | null = null;
  let bestScore = 0;
  for (const entry of pack.entries) {
    const score = scoreEntry(messageLower, messageTokens, entry);
    const better = score > bestScore || (score === bestScore && entry.isPolicy && !best?.isPolicy);
    if (score >= MATCH_FLOOR && better) {
      best = entry;
      bestScore = score;
    }
  }
  return best;
}

const POLICY_SHAPE = [
  "cancel", "refund", "reschedule", "deposit", "pay", "payment", "policy",
  "age", "minimum age", "year old", "years old", "kid", "child", "toddler",
  "pregnant", "pregnancy", "disab", "wheelchair", "allerg", "medical",
  "health", "insurance", "liable", "liability", "safety", "weather",
];

/**
 * Heuristic: is this the kind of question we must NOT improvise an answer to
 * when there's no matching entry? Drives the no-guess escalation path.
 */
export function isPolicyShapedQuestion(message: string): boolean {
  const lower = message.toLowerCase();
  return POLICY_SHAPE.some((term) => lower.includes(term));
}

/** Does the message hit an operator-defined force-handoff keyword? */
export function matchesHandoffKeywords(message: string, pack: OperatorKnowledgePack): boolean {
  const lower = message.toLowerCase();
  return pack.escalation.handoffKeywords.some((keyword) => keyword && lower.includes(keyword.toLowerCase()));
}

/**
 * One-line grounding summary for the LLM system prompt (context only, never
 * the load-bearing answer). Null when the pack is empty.
 */
export function summarizeKnowledgePack(pack: OperatorKnowledgePack): string | null {
  if (pack.entries.length === 0) return null;
  const topics = pack.entries.map((entry) => entry.question.replace(/\?$/, "")).filter(Boolean);
  if (topics.length === 0) return null;
  return `This operator has answered guest questions about: ${topics.join("; ")}.`;
}
