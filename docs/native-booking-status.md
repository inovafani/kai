# Native booking system (own operator CMS): status

Paused on 2026-10-09 so we can focus on FareHarbor affiliate and Rezdy agent bookings for Australia.
Nothing here is live for travellers yet. This page says what exists, what is missing, and how to pick
it up again.

## Why it exists

Operators that have no booking system of their own (likely in Indonesia, possibly in Barbados) run
their trips, schedules and seats on Kai instead of Rezdy or FareHarbor. Tony approved the rules:
manual confirmation, one Kai tenant per operator, admin onboards operators, the operator can always
decline with a full refund, operators pay commission only.

## Done (steps 1 to 5, tested)

| Step | What | Where |
|---|---|---|
| 1 | Create the Kai tenant for a BluePass operator, idempotent on the operator id. `goLive` turns on the traveller-facing features. | `POST /api/admin/native-tenants`, `src/server/tenant/create-native-tenant.ts` |
| 2 | Tables: trips, ticket types, weekly schedules, departures, blackouts, bookings, plus `Tenant.externalOperatorId` | migration `20261008120000_native_booking_tables` (applied to the database) |
| 3 | Read side: published trips, live seats per departure, available dates. Departures are created on demand from the schedules. Local times are read in the trip's time zone. | `src/core/pms/native-pms-adapter.ts`, `src/server/native/prisma-native-store.ts`, `src/core/native/*` |
| 4 | Seat holds (30 minutes, free themselves), never oversold under concurrency | same files |
| 5 | Paid, then waiting for the operator for 24 hours. Accept confirms and writes the ledger. Decline or no answer refunds in full. One answer wins if several arrive at once. | `src/server/payments/native-booking-decision.ts`, `POST /api/admin/[tenantSlug]/native-bookings/[attemptId]/decision`, migration `20261008150000_native_operator_decision` (applied) |

Shared changes made along the way that also help everyone else:

- The booking flow no longer assumes AUD. The trip's currency is carried on the ticket options all the
  way to Stripe (it used to charge AUD for any trip). Rezdy tenants still default to AUD.
- "What happens once a booking is confirmed" is one function, `finalizeConfirmedPmsBooking`, used by
  Rezdy and native bookings alike.

## Not done yet

| Step | What |
|---|---|
| 6 | Operator screens in the BluePass app: trips, ticket prices, weekly schedule, blocked dates (mobile first, photo upload) |
| 7 | Bookings inbox with Accept and Decline, plus Accept and Decline from the operator's WhatsApp. Telling a WhatsApp traveller the outcome needs an approved template. |
| 8 | Publishing a trip writes a Discover listing in the BluePass app |
| 9 | End-to-end run with a test operator and a real Stripe test payment through the webhook |

Known limits to fix before going live:

- The 24 hour refund runs inside the daily cron (21:00), so an unanswered booking is refunded up to a
  day after its deadline. Hourly needs Vercel Pro or an external hourly trigger of the same endpoint.
- The commission ledger only knows USD, IDR, EUR and AUD, so price Barbados trips in USD for now.
- A second "yes" after the payment link was sent creates a second hold and checkout. This is old
  behaviour for every booking system, not only native.

## Trying it locally

```bash
node --env-file=.env --env-file=.env.local scripts/seed-native-demo.mjs
```

Then `npm run dev` and open http://localhost:3000/demo/native. The demo tenant (`native-demo`) is
hidden from WhatsApp and the Australian recommendation. Remove it, with its bookings and payment
attempts, with:

```bash
node --env-file=.env --env-file=.env.local scripts/seed-native-demo.mjs remove
```

## Tests

Pure tests: `src/core/native/*.test.ts`, `src/core/pms/native-pms-adapter.test.ts`,
`src/server/tenant/create-native-tenant.test.ts`, the two native route tests.

Database tests (`*.db.test.ts`) write to the shared database and clean up after themselves. Run them
one file at a time with `--testTimeout=300000`, the database is far away and they are slow.
