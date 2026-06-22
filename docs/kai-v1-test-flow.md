# Kai V1 Final Test Flow and Demo Checklist

Use this runbook before pushing, before presenting Kai internally, and before moving Kai logic into BluePass.

## Goal

Kai V1 proves a tenant-safe AI booking assistant that can be embedded on a client site, resolve the correct tenant, read tenant/PMS configuration, answer booking questions from PMS-grounded facts, collect manual inquiries, and give the operator an admin surface to review settings, inquiries, and conversations.

Kai V1 is not yet a production booking engine. It must not confirm bookings automatically until real PMS booking-write APIs are mapped and tested.

## 1. Local Setup

1. Open the project:

```bash
cd /Users/inovafani/Work/Kai
```

2. Confirm `.env` exists locally.
3. Confirm `.env` is ignored and never pushed.
4. Required baseline values:

```text
DATABASE_URL
DIRECT_URL
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
PMS_CREDENTIAL_ENCRYPTION_KEY
KAI_ADMIN_TOKEN
```

5. Optional LLM values for Groq:

```text
ENABLE_LLM="true"
LLM_PROVIDER="groq"
GROQ_API_KEY="your-groq-key"
GROQ_MODEL="llama-3.1-8b-instant"
GROQ_TIMEOUT_MS="3000"
LLM_MAX_OUTPUT_TOKENS="260"
```

6. Optional LLM values for OpenAI:

```text
ENABLE_LLM="true"
LLM_PROVIDER="openai"
OPENAI_API_KEY="your-openai-key"
OPENAI_MODEL="gpt-4.1-mini"
OPENAI_TIMEOUT_MS="3000"
LLM_MAX_OUTPUT_TOKENS="260"
```

Security note: if any API key appears in screenshots, chat, or `.env.example`, revoke it and create a new key.

## 2. Database Baseline

Run:

```bash
npm run db:seed
```

Expected seeded tenant:

```text
Tenant slug: kai-demo
Widget key: pk_test_kai_demo
PMS provider: MOCK
Allowed origins: http://localhost:3107, http://127.0.0.1:3107
Admin token: dev-admin-token
```

## 3. Automated Verification

Run these before presenting or pushing:

```bash
npm run test
npm run typecheck
npm run build
KAI_ADMIN_TOKEN=dev-admin-token npm run test:e2e
```

Expected result:

```text
Unit tests pass
TypeScript passes
Production build passes
Playwright e2e passes
```

If e2e becomes slow or LLM responses make text assertions unstable, run the deterministic suite with:

```bash
ENABLE_LLM=false KAI_ADMIN_TOKEN=dev-admin-token npm run test:e2e
```

## 4. Start Local App

Run:

```bash
KAI_ADMIN_TOKEN=dev-admin-token npm run dev -- -p 3107
```

Open:

```text
http://localhost:3107/demo/tenant-site
```

Expected result:

```text
BluePass demo tenant site loads
Kai launcher appears
Widget opens when clicked
Widget header shows Kai Demo and current PMS provider
```

## 5. Demo Script for Stakeholders

Use this order for a clean presentation.

### Step A: Show Tenant Website Embed

Open:

```text
http://localhost:3107/demo/tenant-site
```

Say:

```text
This is a standalone tenant website simulation. Kai is embedded through the same widget path we can later transplant into BluePass.
```

Show:

```text
Kai launcher
Widget open/close behavior
Tenant branding
PMS provider label
```

### Step B: Show Availability Check

Send:

```text
Can you check Komodo Day Trip for 3 guests tomorrow?
```

Expected deterministic answer when LLM is off:

```text
Komodo Day Trip is available for 3 guests on tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.
```

Expected behavior when LLM is on:

```text
Answer may sound more natural, but must still preserve Komodo Day Trip, 3 guests, tomorrow, 7 spots, USD 185.00, and no confirmed booking.
```

### Step C: Show Product Recommendation

Send:

```text
do you have recommendation for me tomorrow?
```

Expected behavior:

```text
Kai recommends only products from the tenant PMS list.
Kai distinguishes instant-check products from manual-confirmation products.
Kai asks which product and how many guests.
```

### Step D: Show Manual Inquiry Safety

Send:

```text
private boat for 2 guests tomorrow
```

Expected behavior:

```text
Kai maps private boat to Private Charter.
Kai does not claim availability automatically.
Kai creates a manual inquiry.
Kai says operator confirmation is required.
```

### Step E: Show Slot Memory

Start a fresh widget conversation.

Send:

```text
private boat
```

Then send:

```text
tomorrow for 2 people
```

Expected behavior:

```text
Kai remembers the product context.
Kai combines product, date, and guest count safely.
Kai routes Private Charter to manual inquiry.
```

## 6. Admin Demo Flow

### Admin Settings

Open:

```text
http://localhost:3107/admin/kai-demo/settings
```

If asked, enter:

```text
dev-admin-token
```

Show:

```text
Tenant metadata
Widget public key
Allowed origins
Branding
Brand voice
PMS provider
Enabled features
Response guardrails
LLM runtime provider/model/configured status
```

Important talking point:

```text
Each client can have different tenant settings, PMS provider, allowed origins, brand voice, and guardrails.
```

### Admin Inquiries

Open:

```text
http://localhost:3107/admin/kai-demo/inquiries
```

Show:

```text
Manual inquiries created by the widget
Product title
Date
Guests
Traveller message
Status workflow
View conversation link
```

Expected status workflow:

```text
OPEN -> OPERATOR_NOTIFIED -> CLOSED
```

### Conversation Transcript

From an inquiry, click the conversation link.

Show:

```text
Traveller messages
Assistant messages
Conversation id
Tenant id/slug context
Manual inquiry context
```

Talking point:

```text
Operators can audit what Kai said before taking over.
```

## 7. Security and Tenant Isolation Checks

### Admin Access

Open admin settings in a private/incognito window without admin cookie.

Expected result:

```text
Admin access screen appears
Tenant settings are not visible
```

### Allowed Origin

Use automated e2e or API request from a disallowed origin.

Expected result:

```text
403 ORIGIN_NOT_ALLOWED
```

### Widget Key

Use an invalid widget key.

Expected result:

```text
404 TENANT_NOT_FOUND or request rejected
```

## 8. LLM Safety Checks

Kai has two reply layers:

```text
Deterministic booking brain: owns facts, PMS decisions, and safety.
LLM rewrite layer: only polishes wording when required facts are preserved.
```

Test these manually when LLM is enabled:

```text
what is 1 + 1
```

Expected behavior:

```text
Kai remains a booking assistant and should guide back to booking/help context.
```

```text
Can you book Komodo Day Trip for 3 guests tomorrow and confirm it now?
```

Expected behavior:

```text
Kai may check availability, but must not say the booking is confirmed.
```

```text
Do you have recommendation for tomorrow?
```

Expected behavior:

```text
Kai recommends only PMS products and asks follow-up details.
```

LLM fallback expectations:

```text
If provider fails, Kai falls back to deterministic reply.
If LLM drops required PMS facts, Kai falls back to deterministic reply.
If LLM claims booking confirmation, Kai falls back to deterministic reply.
```

## 9. PMS Provider Checks

### MOCK Provider

Use `MOCK` for normal demo.

Expected result:

```text
Product list works
Availability checks work
Manual inquiry products fail safely into operator confirmation
```

### REZDY or INSEANQ Without Credentials

Temporarily switch PMS provider in admin settings to `REZDY` or `INSEANQ`.

Expected result:

```text
Kai fails closed with an actionable setup error.
Kai must not pretend real PMS is connected.
```

Switch back to `MOCK` after the test.

### REZDY/INSEANQ Pilot Env Fields

Use these only when ready for a controlled PMS pilot:

```text
REZDY_BASE_URL
REZDY_API_KEY
REZDY_PRODUCT_LIST_PATH
REZDY_AVAILABILITY_PATH
REZDY_TIMEOUT_MS
INSEANQ_BASE_URL
INSEANQ_API_KEY
INSEANQ_PRODUCT_LIST_PATH
INSEANQ_AVAILABILITY_PATH
INSEANQ_TIMEOUT_MS
```

Production note:

```text
Real booking creation/cancellation remains disabled until provider-specific booking-write mapping is implemented and tested.
```

## 10. What Is Presentable Now

You can present Kai V1 as:

```text
A tenant-first AI booking assistant prototype.
An embeddable widget for client websites.
A PMS-grounded conversation engine.
A safe manual inquiry collector.
An admin surface for tenant settings, inquiries, transcripts, LLM runtime, and guardrails.
A portable standalone build that can later be transplanted into BluePass.
```

You should not present it as:

```text
A production-ready auto-booking engine.
A fully connected Rezdy/Inseanq production integration.
A payment or booking confirmation system.
```

## 11. Known Boundaries

```text
Booking confirmation is disabled.
Payment is not implemented.
Real PMS write actions are fail-closed.
Authentication is local admin-token based, not production RBAC.
Tenant credentials are currently env-based for pilots, not full tenant credential UI.
LLM cost control is basic env-level cap/status, not a full billing dashboard.
```

## 12. Final Acceptance Checklist

Kai V1 milestone is complete when all are true:

```text
[ ] npm run test passes
[ ] npm run typecheck passes
[ ] npm run build passes
[ ] KAI_ADMIN_TOKEN=dev-admin-token npm run test:e2e passes
[ ] Demo tenant site loads
[ ] Widget opens
[ ] Widget config resolves kai-demo tenant
[ ] Komodo Day Trip availability flow works
[ ] Recommendation flow uses PMS products only
[ ] Private Charter manual inquiry flow works
[ ] Slot memory works
[ ] Admin settings requires token
[ ] Admin settings can edit tenant configuration
[ ] Admin inquiries show manual inquiries
[ ] Conversation transcript is viewable
[ ] LLM runtime status is visible and does not expose keys
[ ] Real PMS providers fail closed without credentials
[ ] .env remains private
[ ] .env.example contains no real secrets
```

## 13. Recommended Next Work After V1

1. Add production auth/RBAC for admin.
2. Store encrypted tenant PMS credentials per tenant instead of env-only pilot config.
3. Implement provider-specific Rezdy/Inseanq product and availability mapping against real API docs.
4. Add booking-write mapping only after operator approval flow is designed.
5. Add LLM usage logging per tenant.
6. Add deployment plan for staging.
7. Create BluePass transplant plan.

## 14. Local Client Simulation: Boattime

Use this flow when testing Kai as if Boattime Yacht Charters were a client, without embedding anything on their real website.

1. Seed local tenants:

```bash
npm run db:seed
```

Expected output includes:

```text
Seeded tenant boattime with widget key pk_test_boattime
```

2. Start local app:

```bash
KAI_ADMIN_TOKEN=dev-admin-token npm run dev -- -p 3107
```

3. Open:

```text
http://localhost:3107/demo/boattime
```

4. Open Kai widget.

Expected widget header:

```text
Boattime Yacht Charters · MOCK
```

5. Test product recommendation:

```text
do you have recommendation for me tomorrow?
```

Expected result:

```text
Kai recommends Boattime products such as Gold Coast Whale Escape, Private Yacht Charter, Twilight Drift, Coastal Lunch Escape, and Broadwater Twilight Dining.
Kai must not mention Komodo products.
```

6. Test instant availability:

```text
Can you check Gold Coast Whale Escape for 4 guests tomorrow?
```

Expected deterministic result:

```text
Gold Coast Whale Escape is available for 4 guests on tomorrow. PMS shows 20 spots remaining at AUD 99.00 per guest. I have not confirmed a booking yet.
```

7. Test manual private charter:

```text
I want a private yacht charter for 20 people next Saturday
```

Expected result:

```text
Kai maps this to Private Yacht Charter.
Kai does not claim availability automatically.
Kai routes it to operator confirmation/manual inquiry.
```

8. Admin settings:

```text
http://localhost:3107/admin/boattime/settings
```

9. Admin inquiries:

```text
http://localhost:3107/admin/boattime/inquiries
```

This is a local simulation only. Do not add the widget to boattimeyachtcharters.com until the client approves and we have a deployment/integration plan.
