# Kai V1 Test Flow

Use this flow before pushing or before moving Kai logic into BluePass.

## 1. Local Setup

1. Open the project at `/Users/inovafani/Work/Kai`.
2. Confirm `.env` exists locally and is not committed.
3. Confirm these values exist in `.env`:
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `PMS_CREDENTIAL_ENCRYPTION_KEY`
   - `KAI_ADMIN_TOKEN`

## 2. Database Baseline

1. Run the seed command:

```bash
npm run db:seed
```

2. Expected tenant:
   - Slug: `kai-demo`
   - Widget key: `pk_test_kai_demo`
   - PMS provider: `MOCK`
   - Allowed origins include `http://localhost:3107`

## 3. Automated Verification

Run these commands in order:

```bash
npm run test
npm run build
npm run typecheck
KAI_ADMIN_TOKEN=dev-admin-token npm run test:e2e
```

Expected result:
   - Unit tests pass.
   - Production build passes.
   - TypeScript passes.
   - Playwright e2e tests pass.

## 4. Start Local App

```bash
KAI_ADMIN_TOKEN=dev-admin-token npm run dev -- -p 3107
```

Open:

```text
http://localhost:3107/demo/tenant-site
```

## 5. Widget Smoke Test

1. Open the demo tenant site.
2. Click the Kai launcher.
3. Confirm the widget opens.
4. Confirm the header says:
   - `Kai`
   - `Kai Demo · MOCK`
5. Send:

```text
Can you check Komodo Day Trip for 3 guests tomorrow?
```

Expected reply:

```text
Komodo Day Trip is available for 3 guests on tomorrow. PMS shows 7 spots remaining at USD 185.00 per guest. I have not confirmed a booking yet.
```

## 6. Product Alias Test

Send:

```text
private boat for 2 guests tomorrow
```

Expected result:
   - Kai maps `private boat` to `Private Charter`.
   - Kai does not claim automatic availability.
   - Kai says operator confirmation is required.

## 7. Slot Memory Test

Start a fresh widget conversation.

Send:

```text
private boat
```

Then send:

```text
tomorrow for 2 people
```

Expected result:
   - Kai remembers the earlier product context.
   - Kai treats this as `Private Charter`.
   - Kai routes it as a manual inquiry.

## 8. Admin Inquiry Test

Open:

```text
http://localhost:3107/admin/kai-demo/inquiries?token=dev-admin-token
```

Expected result:
   - Manual inquiries are visible.
   - Inquiry cards show product, guests, date, status, and traveller message.
   - Status actions can move the inquiry through operator workflow.

## 9. Conversation Transcript Test

From an inquiry card, click `View conversation`.

Expected result:
   - The transcript page opens.
   - Traveller and assistant messages are shown in order.
   - Tenant, conversation id, inquiry id, and status are visible.

## 10. Admin Settings Test

Open:

```text
http://localhost:3107/admin/kai-demo/settings?token=dev-admin-token
```

Expected result:
   - Tenant settings are visible.
   - Widget key, origins, branding, PMS provider, features, and guardrails are visible.
   - Settings can be updated and saved.

Recommended manual check:
   - Temporarily switch PMS provider to `REZDY` or `INSEANQ`.
   - Save.
   - Confirm Kai fails closed instead of pretending the real PMS is connected.
   - Switch back to `MOCK`.

## 11. Security Guard Checks

1. Open admin pages without `?token=dev-admin-token`.
2. Expected result:
   - Admin pages deny access.

3. Call widget config from a disallowed origin.
4. Expected result:
   - Request is rejected.

## 12. LLM Safety Checks

Current V1 behavior:
   - Kai has an LLM reply composer layer.
   - The deterministic booking engine still owns PMS facts and booking safety.
   - LLM rewrites are accepted only if they preserve required PMS facts and do not claim confirmed bookings.
   - No real external LLM provider is connected yet.

Manual expectation:
   - Kai must never invent availability.
   - Kai must never invent prices.
   - Kai must never confirm booking without a real booking tool result.

## 13. Done Criteria

Kai V1 is ready for the next implementation stage when:
   - All automated verification commands pass.
   - Demo tenant site opens.
   - Widget opens from loader.
   - MOCK availability flow works.
   - Manual inquiry flow works.
   - Admin inquiry inbox works.
   - Admin conversation transcript works.
   - Admin settings works.
   - Real PMS providers fail closed until credentials and API mapping are implemented.
