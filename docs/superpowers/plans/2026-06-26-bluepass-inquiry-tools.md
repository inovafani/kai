# BluePass Inquiry Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Kai Core-native BluePass marketplace inquiry tools and wire the `bluepass` widget message flow to create real inquiry, ledger, dispatch, and status outputs.

**Architecture:** Add focused Prisma models for BluePass inquiry state, keep pure tool logic under `src/core/bluepass`, put database writes under `src/server/bluepass`, and route `bluepass_marketplace` messages through a dedicated server handler before the operator-direct booking flow. The first implementation uses a preview catalog and a WhatsApp dispatch stub, matching current BluePass truth policy.

**Tech Stack:** Next.js App Router, TypeScript, Prisma/PostgreSQL, Vitest, Playwright.

---

## File Structure

- Modify `prisma/schema.prisma`: add BluePass inquiry, event, ledger, and dispatch models/enums.
- Create `src/core/bluepass/catalog.ts`: small preview yacht catalog and search helper.
- Create `src/core/bluepass/intent.ts`: extract/merge BluePass inquiry intent from conversation text.
- Create `src/core/bluepass/ledger.ts`: deterministic referral/commission/conservation split.
- Create `src/core/bluepass/dispatch.ts`: build WhatsApp dispatch stub text.
- Create `src/core/bluepass/reply.ts`: deterministic assistant copy for missing slots and inquiry status.
- Create matching `*.test.ts` files under `src/core/bluepass`.
- Create `src/server/bluepass/bluepass-inquiry-repository.ts`: Prisma create/reuse inquiry, events, ledger rows, dispatch rows, and active status read.
- Create `src/server/bluepass/bluepass-inquiry-repository.test.ts`.
- Create `src/server/bluepass/bluepass-message-flow.ts`: orchestrates tools for the widget route.
- Create `src/server/bluepass/bluepass-message-flow.test.ts`.
- Modify `src/app/api/widget/messages/route.ts`: route `bluepass_marketplace` to BluePass flow, keep operator-direct flow unchanged.
- Modify `tests/e2e/widget-session.spec.ts`: update BluePass test from gate response to inquiry tool response.

## Tasks

### Task 1: Schema and Migration

- [ ] Write a failing repository test that imports `createOrReuseBluePassInquiry`.
- [ ] Add Prisma enums/models for BluePass inquiry pipeline.
- [ ] Run `npx prisma migrate dev --name add-bluepass-inquiry-tools`.
- [ ] Run the repository test again to verify the import/schema compiles after implementation in later tasks.
- [ ] Commit schema and migration.

### Task 2: Pure BluePass Tools

- [ ] Write failing tests for `searchBluePassYachts`, `extractBluePassInquiryIntent`, `calculateBluePassLedgerEstimate`, and `buildBluePassDispatchText`.
- [ ] Implement the pure helpers with no database access.
- [ ] Verify all pure tests pass.
- [ ] Commit pure tools.

### Task 3: Repository Tools

- [ ] Write failing tests for create/reuse inquiry, ledger sync with referral attribution, dispatch stub creation, and status read.
- [ ] Implement `bluepass-inquiry-repository.ts`.
- [ ] Verify repository tests pass against the local test database.
- [ ] Commit repository tools.

### Task 4: Message Flow

- [ ] Write failing flow tests for missing fields and ready inquiry creation.
- [ ] Implement `handleBluePassMarketplaceMessage`.
- [ ] Verify flow tests pass.
- [ ] Commit message flow.

### Task 5: Route and E2E

- [ ] Update the BluePass Playwright test to expect real `bluepassInquiry`, matches, and no payment.
- [ ] Wire `/api/widget/messages` to call the BluePass flow for `bluepass_marketplace`.
- [ ] Run targeted Playwright widget session tests.
- [ ] Commit route wiring.

### Task 6: Final Verification

- [ ] Run targeted BluePass unit tests.
- [ ] Run `npm test`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.
- [ ] Run `npx playwright test tests/e2e/widget-config.spec.ts tests/e2e/widget-session.spec.ts`.
- [ ] Check `git status --short --branch`.

## Plan Self-Review

Spec coverage:

- Search, inquiry, ledger, dispatch, and status tools are each covered by a task.
- BluePass payment remains blocked by route output and status copy.
- Operator-direct regression is covered by existing widget session tests.

Placeholder scan:

- No task uses TBD/TODO/fill-in language.
- Dispatch is intentionally a stored stub in this milestone and is described as such in the spec.

Type consistency:

- Model names use the `BluePass*` prefix.
- Route response fields use `bluepassInquiry`, `bluepassMatches`, `bluepassLedger`, and `bluepassDispatch`.
