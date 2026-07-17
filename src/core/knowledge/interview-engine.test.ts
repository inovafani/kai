import { describe, expect, it } from "vitest";
import { advanceInterview, computeNextQuestion } from "./interview-engine";
import { KNOWLEDGE_INTERVIEW_QUESTIONS } from "./interview-script";
import { EMPTY_KNOWLEDGE_PACK, type OperatorKnowledgePack } from "./types";

const FIRST = KNOWLEDGE_INTERVIEW_QUESTIONS[0]; // cancellation-policy
const SECOND = KNOWLEDGE_INTERVIEW_QUESTIONS[1]; // weather-policy
const LAST = KNOWLEDGE_INTERVIEW_QUESTIONS[KNOWLEDGE_INTERVIEW_QUESTIONS.length - 1]; // handoff-line (escalation)

function fresh(): OperatorKnowledgePack {
  return structuredClone(EMPTY_KNOWLEDGE_PACK);
}

describe("computeNextQuestion", () => {
  it("returns questions in script order, skipping completed ids", () => {
    expect(computeNextQuestion(fresh())?.id).toBe(FIRST.id);
    const partial = { ...fresh(), interview: { ...fresh().interview, completedFieldIds: [FIRST.id] } };
    expect(computeNextQuestion(partial)?.id).toBe(SECOND.id);
  });

  it("returns null when every question is answered", () => {
    const allDone = {
      ...fresh(),
      interview: { ...fresh().interview, completedFieldIds: KNOWLEDGE_INTERVIEW_QUESTIONS.map((q) => q.id) },
    };
    expect(computeNextQuestion(allDone)).toBeNull();
  });
});

describe("advanceInterview", () => {
  it("starts by asking the first question without recording the trigger message", () => {
    const started = advanceInterview(fresh(), "onboard me");
    expect(started.ask?.id).toBe(FIRST.id);
    expect(started.recordedId).toBeNull();
    expect(started.pack.interview.status).toBe("in_progress");
    expect(started.pack.interview.lastQuestionId).toBe(FIRST.id);
    expect(started.pack.entries).toHaveLength(0);
  });

  it("records an answer against the PENDING question and advances", () => {
    let advance = advanceInterview(fresh(), "onboard me"); // asks Q1
    advance = advanceInterview(advance.pack, "Full refund up to 48h before, 50% inside.");

    expect(advance.recordedId).toBe(FIRST.id);
    expect(advance.ask?.id).toBe(SECOND.id);
    const entry = advance.pack.entries.find((e) => e.id === FIRST.id);
    expect(entry?.answer).toBe("Full refund up to 48h before, 50% inside.");
    expect(entry?.isPolicy).toBe(true);
    expect(advance.pack.interview.completedFieldIds).toContain(FIRST.id);
  });

  it("re-prompts the same question on empty input, recording nothing", () => {
    const started = advanceInterview(fresh(), "onboard me");
    const empty = advanceInterview(started.pack, "   ");
    expect(empty.reprompted).toBe(true);
    expect(empty.ask?.id).toBe(FIRST.id);
    expect(empty.pack.entries).toHaveLength(0);
    expect(empty.pack.interview.completedFieldIds).not.toContain(FIRST.id);
  });

  it("skips a question without creating an entry but still advances", () => {
    const started = advanceInterview(fresh(), "onboard me");
    const skipped = advanceInterview(started.pack, "skip");
    expect(skipped.ask?.id).toBe(SECOND.id);
    expect(skipped.pack.entries).toHaveLength(0);
    expect(skipped.pack.interview.completedFieldIds).toContain(FIRST.id);
  });

  it("files out-of-order / unrelated text against the question that was actually asked", () => {
    // Adversarial case: operator sends noise instead of answering Q1.
    // It must be recorded against Q1 (the pending question), never mis-filed.
    const started = advanceInterview(fresh(), "onboard me");
    const noise = advanceInterview(started.pack, "wait what is this");
    const entry = noise.pack.entries.find((e) => e.id === FIRST.id);
    expect(entry?.answer).toBe("wait what is this");
    expect(noise.ask?.id).toBe(SECOND.id);
  });

  it("writes the final answer to the escalation handoff line, then completes", () => {
    let pack = fresh();
    // Answer every question up to (but not including) the last.
    for (let i = 0; i < KNOWLEDGE_INTERVIEW_QUESTIONS.length; i += 1) {
      const advance = advanceInterview(pack, i === 0 ? "onboard me" : `answer ${i}`);
      pack = advance.pack;
    }
    // Now the last question is pending; answer it.
    const finalAdvance = advanceInterview(pack, "Ask our team on WhatsApp, we reply fast.");
    expect(finalAdvance.done).toBe(true);
    expect(finalAdvance.ask).toBeNull();
    expect(finalAdvance.pack.interview.status).toBe("complete");
    expect(finalAdvance.pack.escalation.handoffMessage).toBe("Ask our team on WhatsApp, we reply fast.");
    // The escalation question never becomes a guest-facing entry.
    expect(finalAdvance.pack.entries.some((e) => e.id === LAST.id)).toBe(false);
  });

  it("is resumable: re-deriving from a persisted pack continues where it left off", () => {
    const started = advanceInterview(fresh(), "onboard me");
    const answered = advanceInterview(started.pack, "our refund policy");
    // Simulate reload: rebuild from the persisted interview state only.
    const reloaded: OperatorKnowledgePack = structuredClone(answered.pack);
    const next = advanceInterview(reloaded, "our weather policy");
    expect(next.recordedId).toBe(SECOND.id);
  });
});
