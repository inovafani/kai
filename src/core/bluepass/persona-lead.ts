import type { BluePassPersona } from "./triage";

// Renamed from lead.ts to make room for Tony's differently-shaped lead.ts (used by his triage.ts
// for the "thanks, got your email" reply text). This file's extraction feeds a different concern:
// persisting operator/partner leads to the BluePassInquiry table via upsertBluePassPersonaLead.
export type BluePassPersonaLead = {
  persona: Extract<BluePassPersona, "OPERATOR" | "PARTNER">;
  name?: string;
  email?: string;
  phone?: string;
};

export function extractBluePassPersonaLead(input: {
  persona: Extract<BluePassPersona, "OPERATOR" | "PARTNER">;
  messages: string[];
}): BluePassPersonaLead | null {
  const text = input.messages.join("\n");
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = extractLeadPhone(text);
  const name = extractLeadName(text);

  if (!email && !phone) return null;

  return {
    persona: input.persona,
    name,
    email,
    phone
  };
}

function extractLeadPhone(text: string) {
  const explicit = text.match(/\b(?:phone|whatsapp|wa|contact(?: me)? at)(?:\s+number)?\s*(?:is|:|at)?\s*([+\d][\d\s().-]{6,})/i);
  if (explicit) return explicit[1].trim().replace(/[,.]$/g, "");

  const fallback = text.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
  return fallback?.[0].trim().replace(/[,.]$/g, "");
}

function extractLeadName(text: string) {
  const person = text.match(/\b(?:my name is|name is|i am|i'm)\s+([A-Za-z][A-Za-z' -]{1,60})(?=,|\.|$|\s+(?:email|phone|whatsapp|and)\b)/i);
  if (person) return person[1].trim();

  const company = text.match(/\b(?:i run|we run|i operate|we operate|i own)\s+([A-Za-z0-9][A-Za-z0-9' &.-]{1,60})(?=\.|,|$|\s+(?:in|and|with|contact)\b)/i);
  return company?.[1].trim();
}
