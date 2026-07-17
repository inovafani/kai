/**
 * Operator Knowledge Pack — Layer 3 of the Kai tenant model.
 *
 * Business packs define a category's ops flow; tenant config wires one
 * operator's PMS/brand; the knowledge pack holds one operator's ANSWERS —
 * the policies, logistics, itineraries and FAQs that differ operator to
 * operator, so Kai answers each operator's guests correctly instead of
 * generically. The pack is also built BY Kai: it interviews the operator
 * (see interview-engine.ts) and every answer becomes an entry.
 *
 * Pure core — no Prisma / Next imports. Stored as one JSON column
 * (TenantConfig.operatorKnowledgePack), mirroring publicProductCatalog.
 */

export type KnowledgeCategory =
  | "policies" // cancellation, deposits, refunds, weather, safety, min-age
  | "logistics" // meeting point, what-to-bring, transfers, timing
  | "itinerary" // vessel specs, route, inclusions, duration, capacity
  | "seasonal" // best months, closures, tide/season notes
  | "faq"; // catch-all guest Q&A

/** One operator-authored answer the matcher can select and Kai may rephrase. */
export interface OperatorKnowledgeEntry {
  /** Stable slug, e.g. "cancellation-policy". */
  id: string;
  /** Canonical guest question, e.g. "What is your cancellation policy?" */
  question: string;
  /** Verbatim operator answer — becomes the deterministic reply + a required fact. */
  answer: string;
  /** Deterministic trigger terms, e.g. ["cancel","refund","reschedule"]. */
  keywords: string[];
  category: KnowledgeCategory;
  /** Safety-sensitive: forced verbatim through any LLM rephrase, never invented. */
  isPolicy: boolean;
}

/**
 * Resumable interview progress. Lives inside the pack (no separate turn
 * store): the next question is derived from completedFieldIds each turn,
 * and lastQuestionId pins which question a given answer belongs to.
 */
export interface OperatorKnowledgeInterviewState {
  /** Entry ids already answered or explicitly skipped. */
  completedFieldIds: string[];
  /** The question currently awaiting an answer; null when idle/complete. */
  lastQuestionId: string | null;
  status: "not_started" | "in_progress" | "complete";
}

export interface OperatorKnowledgePack {
  /** Bump on shape change; read paths coalesce anything older/missing to empty. */
  version: 1;
  entries: OperatorKnowledgeEntry[];
  escalation: {
    /** No match on a policy-shaped question → hand to a human, never guess. */
    fallbackToHuman: boolean;
    /** Operator-authored line used verbatim on escalation. */
    handoffMessage: string | null;
    /** Extra force-handoff terms, e.g. ["injury","medical","complaint"]. */
    handoffKeywords: string[];
  };
  interview: OperatorKnowledgeInterviewState;
}

/** Default pack for a tenant that has none yet. Used on every read path. */
export const EMPTY_KNOWLEDGE_PACK: OperatorKnowledgePack = {
  version: 1,
  entries: [],
  escalation: { fallbackToHuman: true, handoffMessage: null, handoffKeywords: [] },
  interview: { completedFieldIds: [], lastQuestionId: null, status: "not_started" },
};
