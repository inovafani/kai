import type { FollowUpCandidate, FollowUpKind } from "./types";

/**
 * Follow-up copy — Kai's voice: warm, quick, one clear next step, no guilt,
 * no pressure, WhatsApp-friendly length. Never more than one nudge's worth
 * of ask. When context is missing the copy degrades gracefully rather than
 * printing "null".
 */

function firstName(candidate: FollowUpCandidate): string {
  const name = candidate.contact.name?.trim();
  if (!name) return "there";
  return name.split(/\s+/)[0];
}

function trip(candidate: FollowUpCandidate): string {
  return candidate.tripSummary?.trim() || candidate.destination?.trim() || "your trip";
}

export function buildFollowUpMessage(kind: FollowUpKind, candidate: FollowUpCandidate): string {
  const name = firstName(candidate);
  const operator = candidate.operatorName?.trim();

  switch (kind) {
    case "QUOTE_AWAITING_TRAVELLER": {
      const from = operator ? ` from ${operator}` : "";
      const link = candidate.quoteUrl ? ` ${candidate.quoteUrl}` : "";
      return `Hi ${name} — your quote for ${trip(candidate)}${from} is ready and still holding. Want me to help you lock it in?${link}`;
    }
    case "OPERATOR_UNRESPONSIVE": {
      const when = candidate.dateWindow ? ` for ${candidate.dateWindow}` : "";
      const party = candidate.guests ? `, ${candidate.guests} guest${candidate.guests === 1 ? "" : "s"}` : "";
      return `Hi — a BluePass guest is waiting on your reply for ${trip(candidate)}${when}${party}. Accept, decline, or counter whenever you can and I'll take it from there.`;
    }
    case "DECLINED_NEEDS_ALTERNATIVE": {
      const place = candidate.destination?.trim() || "that trip";
      return `Hi ${name} — that boat didn't work out for your dates, but I've got a couple of strong alternatives for ${place}. Want me to line them up?`;
    }
    case "LEAD_UNCLAIMED":
      return `Hi ${name} — your BluePass page is ready to claim whenever you are: one click, no password, and it's yours to run. Want me to resend the link?`;
    case "TRIP_ABANDONED": {
      const place = candidate.destination?.trim() || "your ocean trip";
      return `Hi ${name} — still thinking about ${place}? Tell me your dates and group size and I'll line up the right boat.`;
    }
  }
}
