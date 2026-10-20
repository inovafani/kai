/**
 * The right control for the question Kai just asked.
 *
 * When Kai asks "How many of you are going?", a person can answer in a hundred ways and Kai has to guess
 * which. A number box can only be answered one way. So the question carries a small descriptor of the
 * control that answers it (a stepper for a head count, months for dates, choices for diving or cruising),
 * and the chat draws it under Kai's message. Pressing it sends an ordinary message in wording Kai's own
 * reader is certain to understand, so no extra AI call is made and nothing can be misread. The text box
 * stays: anyone who would rather type still can.
 *
 * The wording lives here, with the question, so the website and the embedded widget cannot drift apart.
 */

export type BluePassQuestionInput =
  | {
      kind: "guests";
      min: number;
      max: number;
      initial: number;
      /** What is sent for one person. */
      soloText: string;
      /** What is sent for more than one; `{n}` is the number. */
      groupText: string;
    }
  | {
      kind: "month";
      options: { label: string; value: string }[];
      unsure: { label: string; value: string };
    }
  | {
      kind: "choice";
      options: { label: string; value: string }[];
    };

// The same sentences reply.ts asks with; the question is recognised by how a reply ends.
const GUESTS_QUESTION = "How many of you are going?";
const DATES_QUESTION = "When are you thinking of going?";
const INTERESTS_QUESTION = "Are you more after the diving, or cruising the islands?";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTHS_OFFERED = 12;

export function bluePassQuestionInput(reply: string, now: Date = new Date()): BluePassQuestionInput | null {
  const text = reply.trim();

  if (text.endsWith(GUESTS_QUESTION)) {
    return { kind: "guests", min: 1, max: 20, initial: 2, soloText: "Just me", groupText: "{n} of us" };
  }

  if (text.endsWith(DATES_QUESTION)) {
    const options = Array.from({ length: MONTHS_OFFERED }, (_, index) => {
      // From next month on: nobody is asking about a month that is nearly over.
      const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1 + index, 1));
      const month = MONTH_NAMES[date.getUTCMonth()];
      return { label: `${month.slice(0, 3)} ${date.getUTCFullYear()}`, value: month };
    });
    return { kind: "month", options, unsure: { label: "Not sure yet", value: "Not sure yet" } };
  }

  if (text.endsWith(INTERESTS_QUESTION)) {
    return {
      kind: "choice",
      options: [
        { label: "Diving", value: "Diving" },
        { label: "Cruising the islands", value: "Cruising the islands" },
        { label: "A bit of both", value: "A bit of both" }
      ]
    };
  }

  return null;
}

/** The message a stepper sends for a head count. */
export function guestsAnswerText(input: Extract<BluePassQuestionInput, { kind: "guests" }>, count: number) {
  return count <= 1 ? input.soloText : input.groupText.replace("{n}", String(count));
}
