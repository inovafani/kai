# Kai Transplant-Ready SaaS Core Design

Date: 2026-06-18

## Executive Summary

Build Kai from scratch as a standalone SaaS application that can later be ported into the BluePass app without disturbing existing BluePass work. The foundation combines Architecture A's SaaS platform boundaries with Architecture B's practical execution path.

The v1 goal is a tenant-safe booking loop:

1. Create a tenant and tenant business pack.
2. Configure branding, booking rules, product source, and PMS provider.
3. Open a white-label web widget.
4. Chat with Kai in the tenant's voice.
5. Search products and check availability through deterministic tools.
6. Create either an inquiry or an instant booking.
7. Show the resulting conversation, inquiry, booking, and events in an operator/admin view.

The first PMS implementation will be a mock adapter so the full booking state machine can be tested safely. Rezdy and Inseanq are tenant-selected provider implementations behind the same normalized adapter contract.

## Product Positioning

Kai is a white-label AI booking orchestrator for businesses that already have websites and may use PMS or reservation systems such as Rezdy, Inseanq, FareHarbor, Bokun, or native systems.

Kai should not be a marketplace-first product in v1. It should be a tenant-owned booking assistant that can answer grounded questions, recommend products, check availability, collect booking details, create inquiries, trigger human handoff, and eventually create confirmed bookings through PMS integrations.

## Stack

- Next.js for app shell, API routes, widget host, and admin/operator UI.
- TypeScript for strict app and adapter contracts.
- Prisma as the application database layer.
- Supabase Postgres as the hosted database.
- Mock PMS adapter for first full-loop development and tests.
- Provider adapters for Rezdy and Inseanq after the normalized contract is stable.

Prisma remains the main app data layer so the code stays portable when modules are later moved into BluePass. Supabase is used as the Postgres provider, with optional future use of Supabase Auth and Storage.

## Architecture Principles

### Tenant First

Every request must resolve to exactly one tenant before Kai loads conversations, knowledge, products, bookings, credentials, prompts, or tool configuration.

The widget public key is a tenant selector, not an authorization secret. Server-side tenant resolution, origin checks, feature flags, and rate limits enforce the boundary.

### One Tenant-Scoped Orchestrator

Each conversation runs through one tenant-scoped Kai orchestrator. Network recommendations, PMS booking, inquiry creation, and handoff are tools, not separate chat agents.

The LLM may help with:

- Understanding natural language.
- Extracting intent and missing slots.
- Asking follow-up questions.
- Producing brand-voice replies.
- Summarizing deterministic tool results.

The LLM must not own:

- Tenant access decisions.
- Availability truth.
- Price truth.
- Booking confirmation.
- Payment readiness.
- Credential handling.
- Booking state transitions.

### Deterministic Booking Tools

Booking correctness lives in typed tools and state machines. Kai can narrate the result, but the result must come from deterministic services.

Required tools for v1:

- `knowledgeSearch`
- `productSearch`
- `checkAvailability`
- `createInquiry`
- `createInstantBooking`
- `handoffToOperator`
- `dispatchMessage`

### Tenant-Selected PMS Adapter Contract

Each tenant can use a different PMS provider. Kai talks to a normalized adapter contract, and provider-specific logic lives behind that interface.

Initial adapters:

- `MockPmsAdapter` for v1 development and automated tests.
- `RezdyAdapter` when Rezdy credentials and sandbox access are available.
- `InseanqAdapter` after its API shape is confirmed.

Future adapters:

- `FareHarborAdapter`
- `BokunAdapter`
- `NativeAdapter`
- `ManualInquiryAdapter`

The generic PMS adapter contract should include:

- `listProducts`
- `getAvailability`
- `createBooking`
- `cancelBooking`
- `getBooking`
- `handleWebhook`

Adapters must return normalized capability and error shapes so the booking state machine can behave consistently across providers.

## Core Components

### Web Widget

The widget is the first user-facing channel. It loads tenant branding and capabilities from a public widget configuration endpoint.

Responsibilities:

- Bootstrap a tenant-scoped anonymous session.
- Validate allowed origin on every server request.
- Render tenant branding and welcome copy.
- Send traveller messages to the chat API.
- Display assistant replies, suggested replies, product cards, inquiry calls to action, booking state, and handoff state.

### Kai API

API routes stay thin:

- Validate request shape.
- Resolve tenant.
- Enforce origin, auth, rate limit, and feature flags.
- Call application services.
- Return structured JSON.

Expected public widget routes:

- `GET /api/widget/config`
- `POST /api/widget/session`
- `POST /api/widget/chat`
- `POST /api/widget/lead`

Expected internal/admin routes:

- Tenant management.
- Business pack configuration.
- Product and provider configuration.
- Conversation and inquiry views.
- Booking and event views.

### Tenant Core

The tenant core owns:

- Tenant identity and status.
- Branding.
- Business rules.
- Supported channels.
- Required booking slots.
- Escalation policy.
- PMS provider selection.
- Feature flags.
- Operator/admin memberships.

### Orchestrator

The orchestrator owns conversation flow, but not booking truth.

Responsibilities:

- Load tenant business pack.
- Load conversation memory and current slots.
- Classify intent.
- Determine missing fields.
- Call deterministic tools.
- Persist messages and tool events.
- Generate grounded replies.
- Stop when the conversation is in `HUMAN` or `PAUSED` mode.

### Operator/Admin View

The first admin surface should be functional, not overbuilt.

Required views:

- Tenant list and active tenant selector.
- Business pack details.
- Conversations.
- Inquiries.
- Bookings.
- Booking events.
- Integration status.

Operator boundaries must be tenant-aware from the start.

## Required Data Models

### Tenant and Configuration

- `Tenant`
- `TenantBranding`
- `TenantConfig`
- `BusinessPack`
- `TenantIntegration`
- `TenantUser`
- `TenantMembership`

### Conversation

- `Conversation`
- `Message`
- `ConversationEvent`
- `Lead`
- `Traveller`

`Conversation` must include a control mode:

- `AI`
- `HUMAN`
- `PAUSED`

When mode is `HUMAN` or `PAUSED`, Kai must not generate traveller-facing replies.

### Product and Knowledge

- `KnowledgeSource`
- `KnowledgeChunk`
- `Product`
- `ProductVariant`
- `ProductSource`
- `AvailabilitySnapshot`

### Booking

- `BookingInquiry`
- `Booking`
- `BookingEvent`
- `PaymentAttempt`
- `ExternalBookingRef`

Booking must be event-driven enough to support retries, reconciliation, cancellation, and audit.

### Audit and Operations

- `AuditEvent`
- `OutboundDispatch`
- `RateLimitEvent`
- `WebhookEvent`

## Booking Modes

### Manual Inquiry

Used when the product is custom, quote-required, unsupported by PMS booking, or tenant policy requires operator approval.

Flow:

1. Collect required traveller and product slots.
2. Create `BookingInquiry`.
3. Notify operator.
4. Move conversation to `HUMAN` if needed.

### Instant Booking

Used only when the product and provider support instant booking.

Flow:

1. Collect required slots.
2. Check cached availability for discovery.
3. Live re-check availability before committing.
4. Create payment attempt when payment is in scope.
5. Create external PMS booking.
6. Persist external booking reference.
7. Mark booking confirmed only after deterministic success.
8. Compensate or flag reconciliation if payment/PMS steps disagree.

Payment can be mocked in v1 if needed. The booking state machine should still represent payment and external write-back states.

## Security Requirements

- Resolve tenant before loading tenant data.
- Require `tenantId` on all tenant-owned tables.
- Validate widget origins server-side.
- Rate limit by tenant, widget key, IP, and session.
- Encrypt PMS credentials at rest.
- Never expose PMS credentials to the browser, LLM, logs, analytics, or client payloads.
- Verify webhook signatures before processing.
- Store webhook idempotency keys.
- Enforce tenant-aware RBAC on every admin/operator action.
- Audit all booking, handoff, credential, tenant config, and denied access events.

## Testing Strategy

Development should follow test-first implementation for behavior-bearing code.

Required first test groups:

- Tenant resolution from widget key and origin.
- Cross-tenant data isolation.
- Business pack loading.
- Conversation control mode: `AI`, `HUMAN`, `PAUSED`.
- Orchestrator does not invent availability or confirmation.
- Mock PMS availability and booking behavior.
- Booking state transitions.
- Inquiry creation.
- Widget API validation.
- Admin/operator tenant authorization.

The mock PMS adapter is not throwaway. It is the deterministic test fixture for provider-independent booking behavior.

## V1 Scope

In scope:

- New standalone Next.js app.
- Prisma schema targeting Supabase Postgres.
- Tenant foundation.
- Business pack configuration.
- Web widget shell.
- Admin/operator shell.
- Conversation persistence.
- Tenant-scoped orchestrator.
- Mock PMS adapter.
- Product search over seeded products.
- Availability check via mock PMS.
- Inquiry creation.
- Instant booking state machine with mock PMS.
- Conversation control mode and handoff state.
- Audit events.

Out of scope for v1:

- Full BluePass integration.
- Full self-serve onboarding wizard.
- Real payments.
- Rezdy production booking.
- Inseanq production booking.
- FareHarbor/Bokun.
- WhatsApp.
- Referral mesh.
- Billing/subscription management.
- Advanced analytics.

## BluePass Migration Strategy

Keep module names and contracts portable:

- `tenant`
- `business-pack`
- `orchestrator`
- `tools`
- `pms`
- `widget`
- `booking`
- `conversation`
- `audit`

When the standalone system proves the core loop, migrate by mapping:

- Kai `Tenant` to BluePass organization/operator concepts.
- Kai `Product` to BluePass listing/trip concepts.
- Kai `Conversation` to existing inquiry/message models.
- Kai `TenantIntegration` to BluePass operator integration records.
- Kai PMS adapter contracts to BluePass reservation services.

No BluePass-specific assumptions should be added to the standalone core unless they sit behind an adapter or mapping layer.

## V1 Implementation Decisions

These choices are fixed for the first implementation plan:

1. Use Supabase Auth for admin and operator sign-in. Domain data remains in Prisma-managed tables, and tenant membership stores the Supabase auth user id.
2. Use a `FakePaymentProvider` contract in v1. Do not integrate real payments until the booking state machine and PMS adapter behavior are stable.
3. Build the widget as an iframe first, plus a tiny script-loader wrapper that injects the iframe. Keep the dashboard/admin app unframeable.
4. Use Vitest for unit and service tests. Use Playwright for widget/admin end-to-end smoke tests.
5. Use Supabase-hosted Postgres through `.env` first. Do not require Docker Compose for day-one development. Add Supabase local development later only if it improves test speed or developer ergonomics.

## Approved Direction

The selected direction is the transplant-ready core:

- Build from scratch.
- Use Next.js, TypeScript, Prisma, and Supabase Postgres.
- Preserve Architecture A's SaaS and safety boundaries.
- Use Architecture B's widget-first and booking-first MVP sequence.
- Support tenant-selected PMS providers through a normalized adapter contract.
- Start with mock PMS before real Rezdy or Inseanq integrations.
- Keep the core portable for later BluePass integration.
