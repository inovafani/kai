import {
  KNOWLEDGE_INTERVIEW_QUESTIONS,
  type KnowledgeInterviewQuestion,
} from "./interview-script";
import type { OperatorKnowledgeEntry, OperatorKnowledgePack } from "./types";

/**
 * The operator onboarding interview — a pure state machine. Progress lives
 * inside the pack (interview.completedFieldIds / lastQuestionId), so an
 * operator can leave and resume with no session table: the next message
 * re-derives where they were.
 *
 * Crucially, each answer is bound to the question that was PENDING
 * (lastQuestionId), not inferred from the answer text — so an answer is
 * always recorded against the question Kai actually asked, and out-of-order
 * or empty input is handled explicitly rather than mis-filed.
 */

export interface InterviewAdvance {
  /** The updated pack (unchanged on a re-prompt). */
  pack: OperatorKnowledgePack;
  /** The question to ask now; null when the interview is complete. */
  ask: KnowledgeInterviewQuestion | null;
  /** The question id an answer was just recorded against, or null. */
  recordedId: string | null;
  /** True when the incoming message was empty and we re-asked the same question. */
  reprompted: boolean;
  /** True when this advance completed the interview. */
  done: boolean;
}

function findQuestion(id: string | null): KnowledgeInterviewQuestion | null {
  if (!id) return null;
  return KNOWLEDGE_INTERVIEW_QUESTIONS.find((question) => question.id === id) ?? null;
}

function isSkip(message: string): boolean {
  return /^(skip|pass|next|n\/?a|none|not sure|dunno)\b/i.test(message.trim());
}

/** The first scripted question not yet answered or skipped, or null if all done. */
export function computeNextQuestion(pack: OperatorKnowledgePack): KnowledgeInterviewQuestion | null {
  const done = new Set(pack.interview.completedFieldIds);
  return KNOWLEDGE_INTERVIEW_QUESTIONS.find((question) => !done.has(question.id)) ?? null;
}

/** Immutably insert-or-replace an entry by id. */
export function upsertKnowledgeEntry(
  pack: OperatorKnowledgePack,
  entry: OperatorKnowledgeEntry,
): OperatorKnowledgePack {
  const others = pack.entries.filter((existing) => existing.id !== entry.id);
  return { ...pack, entries: [...others, entry] };
}

function markCompleted(pack: OperatorKnowledgePack, id: string): OperatorKnowledgePack {
  if (pack.interview.completedFieldIds.includes(id)) return pack;
  return {
    ...pack,
    interview: { ...pack.interview, completedFieldIds: [...pack.interview.completedFieldIds, id] },
  };
}

function askQuestion(
  pack: OperatorKnowledgePack,
  question: KnowledgeInterviewQuestion,
  recordedId: string | null = null,
): InterviewAdvance {
  return {
    pack: {
      ...pack,
      interview: { ...pack.interview, lastQuestionId: question.id, status: "in_progress" },
    },
    ask: question,
    recordedId,
    reprompted: false,
    done: false,
  };
}

function completeInterview(pack: OperatorKnowledgePack, recordedId: string | null): InterviewAdvance {
  return {
    pack: {
      ...pack,
      interview: { ...pack.interview, lastQuestionId: null, status: "complete" },
    },
    ask: null,
    recordedId,
    reprompted: false,
    done: true,
  };
}

/**
 * Advance the interview by one operator message.
 *
 * - Not started (or no pending question): the message is a trigger, not an
 *   answer — ask the first unanswered question. Completes immediately if the
 *   pack is already full.
 * - Pending question set: the message answers THAT question. Empty →
 *   re-prompt the same question. "skip" → mark done with no entry. Otherwise
 *   record the answer (to an entry, or to the escalation handoff line for
 *   the final question), then ask the next question or complete.
 */
export function advanceInterview(pack: OperatorKnowledgePack, operatorMessage: string): InterviewAdvance {
  const pending = findQuestion(pack.interview.lastQuestionId);

  // Start / resume: no question is currently awaiting an answer.
  if (!pending || pack.interview.status !== "in_progress") {
    const next = computeNextQuestion(pack);
    return next ? askQuestion(pack, next) : completeInterview(pack, null);
  }

  const trimmed = operatorMessage.trim();

  // Empty input is not an answer — re-ask the same question, no state change.
  if (trimmed.length === 0) {
    return { pack, ask: pending, recordedId: null, reprompted: true, done: false };
  }

  // Record the answer against the PENDING question.
  let updated = pack;
  if (!isSkip(trimmed)) {
    if (pending.target === "escalation") {
      updated = { ...updated, escalation: { ...updated.escalation, handoffMessage: trimmed } };
    } else {
      const entry: OperatorKnowledgeEntry = {
        id: pending.id,
        question: pending.question,
        answer: trimmed,
        keywords: pending.keywords,
        category: pending.category,
        isPolicy: pending.isPolicy,
      };
      updated = upsertKnowledgeEntry(updated, entry);
    }
  }
  updated = markCompleted(updated, pending.id);

  const next = computeNextQuestion(updated);
  return next ? askQuestion(updated, next, pending.id) : completeInterview(updated, pending.id);
}
