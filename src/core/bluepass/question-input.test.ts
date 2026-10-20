import { describe, expect, it } from "vitest";
import { guestsFromAnswer, intentFromAnswer } from "./answer-intent";
import { guestsAnswerText, bluePassQuestionInput } from "./question-input";
import { extractBluePassInquiryIntent } from "./intent";

const NOW = new Date("2026-10-20T10:00:00Z");

describe("bluePassQuestionInput", () => {
  it("offers a stepper for the head count", () => {
    const input = bluePassQuestionInput("Komodo is a good call. How many of you are going?", NOW);
    expect(input).toMatchObject({ kind: "guests", min: 1, initial: 2 });
  });

  it("offers the next twelve months for the dates, starting next month, and an honest way out", () => {
    const input = bluePassQuestionInput("Komodo is a good call. When are you thinking of going?", NOW);
    expect(input?.kind).toBe("month");
    if (input?.kind !== "month") return;
    expect(input.options).toHaveLength(12);
    expect(input.options[0]).toEqual({ label: "Nov 2026", value: "November" });
    expect(input.options[11]).toEqual({ label: "Oct 2027", value: "October" });
    expect(input.unsure.value).toBe("Not sure yet");
  });

  it("offers diving, cruising or both", () => {
    const input = bluePassQuestionInput("Are you more after the diving, or cruising the islands?", NOW);
    expect(input?.kind === "choice" && input.options.map((o) => o.value)).toEqual(["Diving", "Cruising the islands", "A bit of both"]);
  });

  it("offers nothing for a reply that does not end in one of Kai's questions", () => {
    expect(bluePassQuestionInput("Here's what I'd put in front of you in Komodo.", NOW)).toBeNull();
    expect(bluePassQuestionInput("How many of you are going? Let me know.", NOW)).toBeNull();
  });
});

// What every control sends has to be understood with no doubt, since that is the whole point of it.
describe("what the controls send is always understood", () => {
  it("reads every head count the stepper can send", () => {
    const input = bluePassQuestionInput("How many of you are going?", NOW);
    if (input?.kind !== "guests") throw new Error("expected a stepper");
    for (let count = input.min; count <= input.max; count += 1) {
      expect(guestsFromAnswer(guestsAnswerText(input, count))).toBe(count);
      expect(intentFromAnswer("guests", guestsAnswerText(input, count))).toEqual({ guests: count });
    }
  });

  it("reads every month it offers", () => {
    const input = bluePassQuestionInput("When are you thinking of going?", NOW);
    if (input?.kind !== "month") throw new Error("expected months");
    for (const option of input.options) {
      expect(extractBluePassInquiryIntent([option.value]).dateWindow).toBe(option.value);
    }
    expect(intentFromAnswer("dateWindow", input.unsure.value)).toEqual({ dateWindow: "flexible" });
  });

  it("reads every choice it offers", () => {
    const input = bluePassQuestionInput("Are you more after the diving, or cruising the islands?", NOW);
    if (input?.kind !== "choice") throw new Error("expected choices");
    expect(intentFromAnswer("interests", "Diving")).toEqual({ interests: ["dive"] });
    expect(intentFromAnswer("interests", "Cruising the islands")).toEqual({ interests: ["cruise"] });
    expect(intentFromAnswer("interests", "A bit of both")).toEqual({ interests: ["dive", "cruise"] });
  });
});
