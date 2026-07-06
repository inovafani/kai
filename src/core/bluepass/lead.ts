/**
 * Deterministic lead extraction for operator / partner conversations.
 *
 * Every branch of the onboarding playbooks funnels toward "company + one
 * reachable channel". This module pulls those details out of the message
 * history so Kai can acknowledge what it heard and the flow can persist a
 * lead instead of asking again for things already given.
 */

export type BluePassLead = {
  company?: string;
  name?: string;
  email?: string;
  phone?: string;
  region?: string;
};

const knownRegions = [
  "raja ampat",
  "komodo",
  "labuan bajo",
  "sorong",
  "bali",
  "lombok",
  "gili",
  "lembeh",
  "sulawesi",
  "flores",
  "indonesia"
];

export function extractBluePassLead(messages: string[]): BluePassLead {
  const text = messages.join("\n");
  const lead: BluePassLead = {};

  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) lead.email = emailMatch[0];

  const phoneMatch = text.match(/\b(?:phone|whatsapp|wa)(?:\s+number)?\s*(?:is|:)?\s*([+\d][\d\s().-]{6,})/i);
  if (phoneMatch) lead.phone = phoneMatch[1].trim();

  const nameMatch = text.match(
    /\b(?:my name is|name is|i am|i'm)\s+([A-Za-z][A-Za-z' -]{1,60}?)(?=,|\.|$|\s+(?:email|phone|whatsapp|from|at|and)\b)/im
  );
  if (nameMatch) lead.name = nameMatch[1].trim();

  // Prefix is case-insensitive via explicit casings; the company words
  // themselves must be capitalised (that is the signal).
  const companyMatch = text.match(
    /\b(?:[Cc]ompany(?:\s+name)?\s+is|[Cc]ompany's|[Ww]e'?re\s+called|[Ww]e\s+are\s+called|[Cc]alled|[Nn]amed|[Ii]'?m\s+from|[Ww]e'?re|[Ww]e\s+are|[Tt]his\s+is)\s+((?:[A-Z][\w&'.-]*)(?:\s+[A-Z][\w&'.-]*){0,4})(?=,|\.|$|\s+(?:in|at|out|and|based)\b)/m
  );
  if (companyMatch) {
    const candidate = companyMatch[1].trim();
    // Skip pronoun-ish and place-only captures ("we're In Indonesia").
    if (!knownRegions.includes(candidate.toLowerCase()) && candidate.length > 1) {
      lead.company = candidate;
    }
  }

  const lowerText = text.toLowerCase();
  const basedMatch = text.match(/\b(?:based in|out of|port is|home port is|from)\s+([A-Za-z][A-Za-z' -]{2,40}?)(?=,|\.|$|\s+and\b)/im);
  const region =
    knownRegions.find((candidate) => candidate !== "indonesia" && lowerText.includes(candidate)) ??
    (lowerText.includes("indonesia") ? "indonesia" : undefined);
  if (basedMatch) {
    lead.region = basedMatch[1].trim();
  } else if (region) {
    lead.region = titleCase(region);
  }

  return lead;
}

export function mergeBluePassLead(previous: BluePassLead | null | undefined, next: BluePassLead): BluePassLead {
  return {
    ...(previous ?? {}),
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined))
  };
}

/** Minimum viable lead: some way for the team to actually reach them. */
export function leadHasReachableChannel(lead: BluePassLead) {
  return Boolean(lead.email || lead.phone);
}

function titleCase(value: string) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
