"use client";

import { useState } from "react";
import { guestsAnswerText, type BluePassQuestionInput } from "@/core/bluepass/question-input";

/**
 * The control that answers the question Kai just asked: a stepper for how many are going, months for
 * when, choices for diving or cruising. Pressing it sends an ordinary message in wording Kai is certain to
 * understand (see core/bluepass/question-input.ts), so there is nothing to misread. The text box below
 * stays for anyone who would rather type.
 */
export default function QuestionControl({
  input,
  disabled,
  onAnswer
}: {
  input: BluePassQuestionInput;
  disabled: boolean;
  onAnswer: (text: string) => void;
}) {
  const [count, setCount] = useState(input.kind === "guests" ? input.initial : 0);

  if (input.kind === "guests") {
    return (
      <div className="kq" role="group" aria-label="How many of you are going?">
        <div className="kq__stepper">
          <button
            type="button"
            className="kq__step"
            aria-label="Fewer people"
            disabled={disabled || count <= input.min}
            onClick={() => setCount((current) => Math.max(input.min, current - 1))}
          >
            −
          </button>
          <output className="kq__count" aria-live="polite">
            {count}
          </output>
          <button
            type="button"
            className="kq__step"
            aria-label="More people"
            disabled={disabled || count >= input.max}
            onClick={() => setCount((current) => Math.min(input.max, current + 1))}
          >
            +
          </button>
        </div>
        <button type="button" className="kform__go ds-body-sm" disabled={disabled} onClick={() => onAnswer(guestsAnswerText(input, count))}>
          Send
        </button>
      </div>
    );
  }

  const options = input.kind === "month" ? input.options : input.options;

  return (
    <div className={`kq kq--chips${input.kind === "month" ? " kq--months" : ""}`} role="group" aria-label="Choose one">
      {options.map((option) => (
        <button key={option.value + option.label} type="button" className="kchip" disabled={disabled} onClick={() => onAnswer(option.value)}>
          {option.label}
        </button>
      ))}
      {input.kind === "month" ? (
        <button type="button" className="kchip kchip--quiet" disabled={disabled} onClick={() => onAnswer(input.unsure.value)}>
          {input.unsure.label}
        </button>
      ) : null}
    </div>
  );
}
