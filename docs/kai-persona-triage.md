# Kai persona triage — traveller / operator / partner

Kai's first job on the BluePass marketplace surface is knowing who it is talking to. Three kinds of
people reach the widget: travellers (the existing booking flow), operators who want to list their
business, and partners — dive shops, agencies, creators — who refer or book for clients. Before this,
everyone was treated as a traveller: an operator saying "I run a dive resort" was asked for a
destination and guest count.

## How it works

1. `classifyBluePassPersona` (src/core/bluepass/triage.ts) keyword-classifies the persona from the
   full message history, every turn — no stored state, no schema change. Partner identity nouns win
   over operator verb phrases ("I run a dive shop" → PARTNER). Bare "partner" and bare "referral"
   are never signals (romantic partners, referral codes).
2. OPERATOR / PARTNER personas get deterministic onboarding decision trees (level-2 branches:
   economics, claim path, vetting, commissions, catalogue with preview cards, book-on-behalf).
   They never enter the traveller booking flow. TRAVELLER falls through untouched.
3. A message with no persona and no trip signal at all ("hello") gets a triage question instead of a
   demand for trip details.
4. **Lead capture terminal node**: the moment an operator/partner message contains an email or
   phone, `extractBluePassLead` (src/core/bluepass/lead.ts) pulls company / name / email / phone /
   region from the conversation, Kai echoes it back, and the lead persists via
   `upsertBluePassPersonaLead` — a `BluePassInquiry` row with `tripType` `OPERATOR_LEAD` /
   `PARTNER_LEAD` (one per conversation, later details merge in, events logged). Persistence is
   best-effort: a DB failure never breaks the reply.

## Economics stated by the playbooks (source of truth)

Operators keep 82%; the 18% is capped and itemised as 5% conservation / 5% partner-creator
commissions / 3% payments / 5% platform. Traveller price is never marked up; partner commission is
funded from the operator side. Kai never invents percentages beyond these and never promises
approval.

## Testing

- `npx tsx scripts/kai-chat.ts` — interactive terminal chat against the real flow (no DB needed for
  triage/concierge paths). `--demo` runs a scripted three-persona walkthrough.
- Unit tests: `src/core/bluepass/triage.test.ts`, `src/core/bluepass/lead.test.ts`.
  Flow tests: persona cases in `src/server/bluepass/bluepass-message-flow.test.ts`.

## Decisions to revisit (flagging for review)

- Leads reuse `BluePassInquiry` (`tripType` marker) to avoid a schema change — a dedicated Lead
  model may be cleaner once volume justifies it.
- The BluePass tenant's `welcomeMessage` config could be set to the triage greeting so the widget
  opens with it (tenant data, not code — not changed here).
- Classification is deterministic keywords; an LLM classifier could layer on top later, but the
  keyword layer should stay as the guardrailed fallback.

Full decision-matrix spec (shared with the bluepass app): `BluePass Build/docs/kai-triage-decision-matrix.md`.
