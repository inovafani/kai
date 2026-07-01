# BluePass Inquiry Tools Design

Date: 2026-06-26

## Goal

Replace the temporary BluePass marketplace gate with real deterministic BluePass inquiry tools inside Kai Core.

This milestone does not migrate the full BluePass website or admin system. It creates the first Kai Core-native version of the BluePass marketplace inquiry pipeline so the `bluepass` tenant can search preview inventory, collect traveller intent, create/reuse an inquiry, estimate referral/commission ledger rows, create an operator WhatsApp dispatch record, and answer inquiry status without using the operator-direct booking flow.

## Scope

Implement these BluePass marketplace tools:

- `search_bluepass_yachts`
- `create_bluepass_inquiry`
- `sync_referral_ledger_estimate`
- `dispatch_operator_whatsapp`
- `get_bluepass_inquiry_status`

The tools are deterministic. LLM output may shape copy later, but it must not own availability, final price, inquiry status, dispatch state, payment readiness, or booking confirmation.

## Data Model

Add Kai Core-local BluePass records:

- `BluePassInquiry`: tenant/conversation-scoped marketplace inquiry with traveller fields, trip intent, selected yacht, referral attribution, and status.
- `BluePassInquiryEvent`: audit trail for creation, updates, ledger sync, dispatch, and operator-status changes.
- `BluePassLedgerEntry`: pending ledger estimates for creator commission, BluePass platform commission, conservation allocation, and operator payout placeholder.
- `BluePassOperatorDispatch`: WhatsApp dispatch attempt record. In this milestone dispatch is a stored stub, not a live WhatsApp provider send.

Statuses:

- Inquiry: `DRAFT`, `READY_TO_DISPATCH`, `OPERATOR_PENDING`, `OPERATOR_ACCEPTED`, `COUNTER_OFFERED`, `DECLINED`, `CLOSED`.
- Dispatch: `QUEUED`, `SENT`, `FAILED`.
- Ledger: `PENDING`, `FINALIZED`, `VOIDED`.

## Tool Behavior

### Search

`search_bluepass_yachts` reads a small BluePass preview catalog in Kai Core. It returns ranked cards with truth labels:

- availability source: `preview_catalog`
- price source: `preview_catalog`
- booking confirmation source: `operator_admin`

It must never claim live availability.

### Inquiry Creation

`create_bluepass_inquiry` requires:

- destination
- date window
- guests
- traveller name
- traveller email
- traveller phone

Selected yacht and budget are useful but not mandatory. If an active inquiry exists for the same tenant and conversation, update and reuse it instead of creating duplicates.

### Ledger Estimate

`sync_referral_ledger_estimate` creates ledger rows only when referral attribution exists. The split is:

- 5% conservation allocation
- 15% BluePass gross commission capped at USD 750
- 30% of commission to creator when referral role is `CREATOR`
- remaining estimated amount as operator payout placeholder

Amounts are stored in USD cents and remain `PENDING`.

### Operator Dispatch

`dispatch_operator_whatsapp` creates a `BluePassOperatorDispatch` record and marks the inquiry `OPERATOR_PENDING`. It records the destination phone, operator id/name when available, and a generated outbound text payload. It does not call Meta/WhatsApp in this milestone.

### Status

`get_bluepass_inquiry_status` reads the active conversation inquiry and latest events. User-facing status must stay honest: operator pending is not booking confirmation, payment is not available before operator acceptance/readiness, and prices remain preview/quote signals.

## Widget Message Flow

For `bluepass_marketplace`:

1. Store traveller message.
2. Search catalog from message + previous traveller messages.
3. Extract/update inquiry intent from message history.
4. If required fields are missing, store assistant message asking for the next missing fields and return matches.
5. If ready, create or reuse inquiry.
6. Sync referral ledger estimate when referral fields exist.
7. Create operator dispatch stub when a selected yacht/operator target is known; otherwise keep inquiry `READY_TO_DISPATCH`.
8. Store assistant message with deterministic status.
9. Return `bluepassInquiry`, `bluepassMatches`, `bluepassLedger`, `bluepassDispatch`, `paymentRequest: null`, and `manualInquiry: null`.

For `operator_direct`, keep the existing generic booking flow unchanged.

## Non-Goals

- No real WhatsApp provider send.
- No live PMS availability.
- No BluePass payment panel.
- No admin UI in this milestone.
- No full migration from `bluepass-app`.

## Verification

Required checks:

- Pure unit tests for search, intent/readiness, ledger split, dispatch stub, and status.
- Server repository tests for create/reuse inquiry and event writes.
- Route/e2e tests proving BluePass creates an inquiry response instead of the old gate copy.
- Regression tests proving `kai-demo` and Boattime operator-direct flow still work.
- `npm test`, `npm run typecheck`, `npm run build`, and targeted Playwright widget tests pass.
