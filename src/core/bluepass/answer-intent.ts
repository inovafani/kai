import type { BluePassInquiryIntent } from "@/core/bluepass/intent";

/**
 * Understanding a reply by what Kai just asked.
 *
 * "2" means nothing on its own, but as the answer to "How many of you are going?" it is the party size.
 * The general intent reader works on a message in isolation, so a traveller who answers Kai's question
 * the way a person would ("2", "just me and my wife", "diving mostly", "not sure yet") was not heard, and
 * Kai asked again. This reads the reply against the question that was actually put to them.
 */

export type KaiQuestion = "dateWindow" | "guests" | "interests";

/** Which of Kai's trip questions a message of Kai's was asking, if any. */
export function questionKaiAsked(message: string | null | undefined): KaiQuestion | null {
  if (!message) return null;
  const text = message.toLowerCase();
  if (/how many (?:of you|people|guests|travell?ers|are (?:you|coming|going))/.test(text)) return "guests";
  if (/when are you (?:thinking|planning|hoping)|what dates|which month|when would you like/.test(text)) return "dateWindow";
  if (/more after the diving|diving, or cruising|diving or cruising/.test(text)) return "interests";
  return null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  satu: 1, dua: 2, tiga: 3, empat: 4, lima: 5, enam: 6, tujuh: 7, delapan: 8, sembilan: 9, sepuluh: 10
};
const MAX_PARTY = 40;

/** A party size from a short reply, or null when it does not give one. */
export function guestsFromAnswer(reply: string): number | null {
  const text = reply.toLowerCase().replace(/[^a-z0-9\s']/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > 80) return null;

  // "just me", "solo", "myself": one.
  if (/\b(?:just me|only me|solo|myself|by myself|on my own|alone)\b/.test(text)) return 1;
  // "the two of us", "a couple", "me and my wife": two.
  if (/\b(?:a couple|couple|the two of us|two of us|just us two|me and my (?:wife|husband|partner|girlfriend|boyfriend|fianc[ee]e?|spouse|mate|friend|mum|mom|dad|brother|sister)|my (?:wife|husband|partner|girlfriend|boyfriend) and i|my partner and me)\b/.test(text)) return 2;

  // "family of four", "group of 8", "6 of us", "4 people", "5 adults and 2 kids": count what is said.
  const tokens = text.split(" ");
  let total = 0;
  let counted = 0;
  for (let i = 0; i < tokens.length; i += 1) {
    const value = /^\d{1,2}$/.test(tokens[i]) ? Number(tokens[i]) : NUMBER_WORDS[tokens[i]];
    if (value === undefined || value === 0) continue;
    // A number followed by a month or "th/nd" is a date, not a head count.
    if (/^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|st|nd|rd|th)/.test(tokens[i + 1] ?? "")) continue;
    // Nor is a length of time or an amount of money ("4 nights", "3000 usd").
    if (/^(?:nights?|days?|weeks?|months?|hours?|years?|usd|idr|aud|eur|dollars?|bucks|k)$/.test(tokens[i + 1] ?? "")) continue;
    total += value;
    counted += 1;
  }
  if (counted === 0) return null;

  // Several numbers only add up when they are clearly people ("2 adults and 1 kid"), not "4 nights, 2 people".
  const peopleWords = /\b(?:adults?|kids?|children|child|people|persons?|of us|guests?|pax|friends?|family|group|travell?ers?|teens?|babies|baby|infants?)\b/;
  if (counted > 1 && !peopleWords.test(text)) return null;
  if (counted === 1 && tokens.length > 6 && !peopleWords.test(text)) return null;

  return total >= 1 && total <= MAX_PARTY ? total : null;
}

/** What a reply tells Kai, given the question it was answering. Empty when the reply says nothing about it. */
export function intentFromAnswer(question: KaiQuestion | null, reply: string): BluePassInquiryIntent {
  if (!question) return {};
  const text = reply.toLowerCase();

  if (question === "guests") {
    const guests = guestsFromAnswer(reply);
    return guests ? { guests } : {};
  }

  if (question === "dateWindow") {
    // A month or date is read by the general reader. "Not sure" or "any time" is still an answer: Kai
    // stops asking and works with what it has.
    if (/\b(?:not sure|no idea|flexible|any ?time|whenever|open|undecided|don'?t know|dont know|haven'?t decided)\b/.test(text)) {
      return { dateWindow: "flexible" };
    }
    return {};
  }

  if (/\b(?:dive|diving|dives|scuba|snorkel\w*)\b/.test(text)) return { interests: ["dive"] };
  if (/\b(?:cruis\w*|islands?|relax\w*|sightsee\w*|chill\w*|beach\w*|scenery|sunsets?|trek\w*|hik\w*)\b/.test(text)) {
    return { interests: ["cruise"] };
  }
  // "Both" or "either" is an answer too, and leaves the choice open.
  if (/\b(?:both|either|bit of both|a bit of everything|no preference|don'?t mind|dont mind|anything)\b/.test(text)) {
    return { interests: ["dive", "cruise"] };
  }
  return {};
}

/**
 * Everything the traveller has answered in this chat, each reply read against the question before it.
 * `assistantBefore[i]` is the message of Kai's that `traveller[i]` was replying to (or undefined).
 */
export function intentFromAnswers(
  pairs: { assistantBefore: string | null | undefined; traveller: string }[]
): BluePassInquiryIntent {
  let merged: BluePassInquiryIntent = {};
  for (const pair of pairs) {
    const found = intentFromAnswer(questionKaiAsked(pair.assistantBefore), pair.traveller);
    merged = { ...merged, ...found, interests: [...new Set([...(merged.interests ?? []), ...(found.interests ?? [])])] };
  }
  if (!merged.interests?.length) delete merged.interests;
  return merged;
}

/**
 * Lines each earlier traveller message up with the message of Kai's it answered. Kai's greeting is stored
 * first when there is one, so the two lists are either the same length (no greeting) or Kai has one more.
 */
export function pairTravellerWithKai(
  priorTravellerMessages: string[],
  priorAssistantMessages: string[]
): { assistantBefore: string | null; traveller: string }[] {
  const offset = priorAssistantMessages.length - priorTravellerMessages.length - 1;
  // Kai's list and the traveller's are loaded separately and can be cut off at different points. If they
  // do not line up as "same length, or Kai has one more", guessing would credit a reply to the wrong
  // question, so no reply is paired.
  if (offset !== 0 && offset !== -1) return priorTravellerMessages.map((traveller) => ({ traveller, assistantBefore: null }));
  return priorTravellerMessages.map((traveller, index) => ({
    traveller,
    assistantBefore: priorAssistantMessages[index + offset] ?? null
  }));
}
