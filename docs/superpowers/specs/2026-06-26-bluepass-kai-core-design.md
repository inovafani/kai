# BluePass Kai Core Design

Date: 2026-06-26

## Executive Summary

Build the next Kai as a reusable OpenKai core while making BluePass its first marketplace-native business pack.

This direction follows the BluePass pitch deck:

- BluePass is the consumer marketplace for conservation-first ocean experiences.
- Kai is the AI concierge that plans, matches, books, remembers, and hands off.
- OpenKai is the reusable booking, trust, payment, and operator infrastructure layer.

Boattime proves the operator-direct tenant path: one tenant, one operator, Rezdy-first live booking, and payment through a deterministic booking flow. BluePass needs a different pack: marketplace discovery, trust and conservation storytelling, referral attribution, inquiry creation, operator WhatsApp dispatch, commission ledger estimates, and later payment only after operator acceptance and booking readiness.

The core rule stays unchanged: the LLM may talk, explain, and extract intent, but deterministic tools own availability, price, payment, booking confirmation, operator status, referral attribution, and ledger state.

## Current Source Systems

### Kai Repository

The `kai` repository is the standalone OpenKai core. It already contains the tenant-safe app direction, embeddable widget work, Boattime tenant behavior, Rezdy adapter work, payment panel work, and tests around booking orchestration.

This repository is where reusable Kai Core should continue to be built.

### BluePass App Repository

The `bluepass-app` repository is the current BluePass website and domain system. It already contains:

- Cinematic BluePass website pages.
- Global native `KaiWebChat`.
- Static preview yacht catalog in `lib/data/yachts.ts`.
- Kai slot extraction, planner, conversation persistence, yacht matching, and safe fallback replies.
- Referral capture from `?ref=`.
- Referral partners, links, clicks, and attribution cookies.
- Booking inquiries and inquiry events.
- Operator WhatsApp dispatch and inbound operator accept/decline/counter handling.
- Admin pages for inquiries, applications, and referral ledger.
- Commission ledger estimates for referred inquiries.
- Bokun integration scaffolding and booking adapter contracts.

BluePass app remains the source of truth for BluePass-specific marketplace/referral/inquiry behavior until we intentionally migrate or expose those behaviors through stable APIs.

## Product Positioning

### Operator Tenant Pack

Used by tenants such as Boattime.

Characteristics:

- Single operator brand.
- Operator-owned inventory and PMS credentials.
- Direct sales widget.
- Live availability through the tenant PMS.
- Instant booking only when the provider and tenant policy allow it.
- Payment may happen in the Kai flow when the provider/payment policy supports it.

### BluePass Marketplace Pack

Used by BluePass itself.

Characteristics:

- Marketplace concierge, not single-operator sales bot.
- Search across BluePass yachts, trips, operators, and future inventory.
- Explain trust, protection, conservation, and vetted operator positioning.
- Carry referral attribution from creators, operators, dive shops, groups, and travellers.
- Create BluePass booking inquiries with traveller details and selected yacht/trip.
- Sync pending commission/conservation/operator payout ledger estimates.
- Dispatch inquiries to operators/admin over WhatsApp.
- Track operator response state.
- Defer payment until operator acceptance and any required PMS hold/payment readiness.

### OpenKai Core

The reusable core underneath both packs.

Responsibilities:

- Tenant/business-pack resolution.
- Conversation/session memory.
- Intent and slot orchestration.
- Tool registry and capability gating.
- Deterministic booking state boundaries.
- Handoff state.
- Audit-friendly tool events.
- Shared widget/native chat API shapes.

OpenKai Core must not depend on BluePass marketplace assumptions. BluePass behavior belongs behind BluePass tools/adapters.

## Integration Model

### BluePass Native Integration

BluePass should not be embedded like an external tenant. Since BluePass owns the website, the best UX is a first-party native chat shell mounted in the BluePass app layout.

Final flow:

```text
bluepass.co
-> native Kai chat shell
-> Kai Core API with tenantSlug = bluepass
-> BluePass Marketplace Pack
-> BluePass domain tools
-> native chat response with BluePass cards/actions
```

The native shell can pass:

- Referral cookie attribution.
- Logged-in traveller profile.
- Current page context.
- Selected yacht/trip context.
- Existing Kai session ID.

### External Tenant Embed

External tenants should use the embeddable widget script/iframe.

Final flow:

```html
<script src="https://openkai.example.com/embed/kai.js" data-widget-key="pk_tenant_..."></script>
```

Server-side tenant resolution validates widget key, origin allowlist, tenant status, and feature flags before loading any tenant data or tools.

### Shared Core, Different Shells

BluePass native shell and external widget shell should call the same core service contract. Their UI differs, but orchestration, tool gating, guardrails, and state rules should stay shared.

## BluePass Tool Contracts

The BluePass pack should expose these deterministic tools to Kai Core.

### `search_bluepass_yachts`

Input:

- tenant/business pack ID.
- structured travel intent.
- optional selected yacht slug.
- optional current page context.

Output:

- ranked yacht/listing cards.
- reasons.
- price signals.
- conservation notes.
- explicit truth labels: preview catalog, live availability, or operator-confirmed.

This tool must not claim live availability unless a live provider check actually ran.

### `create_bluepass_inquiry`

Input:

- Kai session ID.
- traveller name, email, phone.
- destination, trip type, date window, guests, budget, interests.
- selected yacht/trip or freeform notes.
- referral attribution.

Output:

- inquiry ID.
- status.
- missing fields if not ready.
- whether an existing active inquiry was reused.

This maps to the existing BluePass `BookingInquiry` behavior.

### `sync_referral_ledger_estimate`

Input:

- inquiry ID.
- referral partner/link/code/role.
- budget or quote signal.

Output:

- pending ledger row summaries.
- estimated creator commission.
- BluePass platform commission.
- conservation allocation.
- operator payout placeholder.

This is BluePass-specific and must not exist in generic operator tenant behavior unless a tenant explicitly enables an equivalent business model.

### `dispatch_operator_whatsapp`

Input:

- inquiry ID.
- operator ID or operator phone routing target.
- dispatch policy.

Output:

- outbound message ID.
- provider message ID if available.
- inquiry status.
- failure reason if dispatch fails.

This reuses BluePass WhatsApp templates/free-text fallback and stores outbound context for operator replies.

### `get_bluepass_inquiry_status`

Input:

- inquiry ID or active Kai session ID.

Output:

- inquiry status.
- latest events.
- operator response summary.
- next recommended user-facing action.

This lets Kai answer follow-up questions without inventing operator acceptance or booking state.

## Booking and Payment Policy

### BluePass

BluePass v1 should be inquiry-first.

Allowed:

- Discovery.
- Matching.
- Trust/conservation explanation.
- Contact capture.
- Inquiry creation.
- Operator dispatch.
- Operator accept/decline/counter tracking.
- Payment readiness explanation.

Not allowed before operator acceptance and booking readiness:

- Payment panel.
- Payment link.
- Confirmed booking language.
- Final availability claim.
- Final price claim.

Future BluePass payment flow:

```text
Traveller inquiry
-> operator accepts/counters
-> PMS hold or explicit operator availability confirmation
-> payment attempt
-> confirmed booking
-> conservation allocation and commission ledger finalization
```

### Operator Tenants

Operator-direct tenants may allow instant booking when:

- tenant policy enables it.
- product is instant-bookable.
- provider supports the needed availability/booking/payment flow.
- live re-check succeeds.
- payment and external booking saga can be reconciled.

Boattime remains the reference implementation for this path.

## Conversation Modes

Kai Core should support:

- `AI`: Kai may reply and call tools.
- `HUMAN`: operator/admin owns the thread; Kai stays silent unless explicitly handed back.
- `PAUSED`: no automated user-facing reply.

BluePass inquiry dispatch does not always require immediate `HUMAN` mode. The mode should depend on whether the operator or admin is expected to take over the traveller conversation, not merely whether an inquiry was sent to an operator.

## Milestones

### Milestone 0: Baseline and Contracts

Goals:

- Verify current `kai` and `bluepass-app` behavior.
- Define shared Business Pack, Tool, Conversation State, Payment Policy, and Handoff Policy contracts.
- Decide which BluePass behavior is called via internal API versus temporarily duplicated in the Kai repo for development.

Verification:

- Existing `kai` tests pass.
- Existing `bluepass-app` tests pass.

### Milestone 1: Kai Core Platform

Goals:

- Remove Boattime hardcoding from core orchestration boundaries.
- Introduce tenant/business-pack resolver and tool registry.
- Keep Boattime as `boattime-operator`.
- Add guardrails proving unavailable tools cannot be called for a tenant.

Verification:

- Boattime tests and e2e still pass.
- Cross-tenant/tool-availability tests pass.

### Milestone 2: BluePass Marketplace Pack

Goals:

- Add BluePass business pack.
- Add BluePass tool interfaces.
- Wire search, inquiry creation, referral ledger estimate, operator WhatsApp dispatch, and inquiry status through deterministic tools.

Verification:

- Kai can return BluePass yacht matches.
- Inquiry includes traveller details and referral attribution.
- Ledger estimates are created for referred inquiries.
- Kai cannot claim confirmed booking/payment for BluePass inquiry flows.

### Milestone 3: Native Kai on BluePass

Goals:

- Route BluePass native chat shell to Kai Core.
- Preserve BluePass visual language and card behavior.
- Pass referral cookie, logged-in traveller profile, and page context.

Verification:

- `?ref=` visitor chats with Kai, sends inquiry, and admin/referral ledger updates.
- Session history survives refresh.
- No operator tenant iframe constraints leak into BluePass native UX.

### Milestone 4: Operator/Admin Loop

Goals:

- Show chat context, lead fields, referral source, ledger estimate, dispatch state, and operator events in admin.
- Keep WhatsApp accept/decline/counter handling working.
- Allow Kai to answer status follow-ups from deterministic inquiry status.

Verification:

- Operator reply changes inquiry status.
- Admin pipeline shows latest event.
- Kai status reply matches stored status.

### Milestone 5: Booking and Payment Policy

Goals:

- Represent BluePass payment readiness separately from Boattime instant payment.
- Ensure BluePass payment cannot appear before operator acceptance and readiness.
- Keep Boattime direct RezdyPay path intact.

Verification:

- BluePass does not show payment panel before readiness.
- Boattime instant payment still passes.
- Payment/PMS mismatch states are explicit.

### Milestone 6: External Tenant Embed

Goals:

- Harden external tenant widget script/iframe.
- Validate origin allowlist and widget key.
- Keep dashboard/admin unframeable.
- Use Boattime as reference tenant.

Verification:

- Allowed origin works.
- Disallowed origin fails.
- Tenant A cannot read Tenant B state.

### Milestone 7: Production Readiness

Goals:

- Prepare env documentation.
- Add secret rotation checklist.
- Add rate limiting and audit events for tool calls.
- Add deployment smoke tests.

Verification:

- Typecheck, unit tests, e2e, and build pass.
- Production smoke covers BluePass inquiry, BluePass referral ledger, Boattime booking, and admin visibility.

## Test Strategy

Build behavior test-first where possible.

Required test groups:

- Business pack resolution.
- Tool registry gating by tenant.
- BluePass search tool returns preview catalog truth labels.
- BluePass inquiry creation requires the correct slots.
- Referral attribution is preserved from session to inquiry.
- Ledger estimates are created only when referral attribution exists.
- Operator WhatsApp dispatch updates inquiry state.
- BluePass payment is blocked before operator acceptance/readiness.
- Boattime instant booking remains unaffected.
- LLM replies cannot override deterministic booking/inquiry/payment truth.

## Migration and Reuse Strategy

Do not blindly transplant BluePass app code into Kai Core.

Use this order:

1. Preserve BluePass app as source of truth.
2. Define BluePass tool contracts in Kai Core.
3. Add adapters that call BluePass services or APIs.
4. Move only stable, reusable abstractions into Kai Core.
5. Keep marketplace/referral/conservation behavior inside the BluePass pack unless generalized by explicit tenant configuration.

This lets us build OpenKai without destroying the existing BluePass website.

## Explicit Non-Goals

Not in the first BluePass Kai build:

- Full referral mesh routing to alternative operators.
- Full public tenant onboarding UI.
- Full provider marketplace across Rezdy, FareHarbor, Bokun, and Inseanq.
- BluePass payment before operator acceptance.
- Conservation passport and dive log implementation.
- Rebuilding the BluePass marketing website.
- Rewriting all BluePass admin pages.

## Approved Direction

Proceed with an A-shaped foundation and B-shaped milestones:

- Keep Kai Core reusable and tenant-safe.
- Treat BluePass as the first marketplace business pack.
- Keep Boattime as the operator-direct reference tenant.
- Use the existing BluePass app as the source of truth for marketplace/referral/inquiry behavior.
- Build BluePass native chat integration first, then harden external tenant embed.
- Follow the pitch deck positioning: BluePass is the marketplace, Kai is the concierge, OpenKai is the infrastructure.
