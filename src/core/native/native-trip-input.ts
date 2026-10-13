import { z } from "zod";
import { isIsoDate, isLocalTime } from "./native-time";

/**
 * What an operator can enter for a trip on the native booking system, and what has to be true
 * before travellers can see it. Pure and DB-free so the rules are testable without a request.
 */

/** Currencies the commission ledger can book. A trip priced in anything else would be paid for and
    then fail to post, so it is refused when the trip is saved. (Barbados: price in USD for now.) */
export const NATIVE_CURRENCIES = ["USD", "AUD", "EUR", "IDR"] as const;

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return value.includes("/") || value === "UTC";
  } catch {
    return false;
  }
}

const isoDate = z.string().refine(isIsoDate, "Use a real date like 2026-10-31.");

const ticketSchema = z.object({
  label: z.string().trim().min(1, "Give every ticket a name.").max(60),
  priceCents: z.number().int("Prices are whole cents.").min(0, "A price cannot be negative.").max(10_000_000),
  kind: z.enum(["TICKET", "EXTRA"]).default("TICKET"),
  sortOrder: z.number().int().min(0).max(100).optional(),
  active: z.boolean().default(true)
});

const scheduleSchema = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, "Pick at least one day.").max(7),
  localTime: z.string().refine(isLocalTime, "Use a time like 09:00."),
  seats: z.number().int().min(1, "A sailing needs at least one seat.").max(500),
  validFrom: isoDate.nullable().default(null),
  validUntil: isoDate.nullable().default(null),
  active: z.boolean().default(true)
});

const blackoutSchema = z.object({
  fromDate: isoDate,
  toDate: isoDate,
  reason: z.string().trim().max(200).nullable().optional()
});

export const nativeTripInputSchema = z
  .object({
    title: z.string().trim().min(2, "Give the trip a name.").max(160),
    description: z.string().trim().max(4000).default(""),
    durationMinutes: z.number().int().min(15, "A trip lasts at least 15 minutes.").max(60 * 24 * 14),
    meetingPoint: z.string().trim().max(300).default(""),
    photoUrls: z
      .array(z.string().trim().url("Photo links must be full web addresses.").refine((url) => url.startsWith("https://"), "Photo links must start with https://."))
      .max(8)
      .default([]),
    currency: z.enum(NATIVE_CURRENCIES, { message: `Price the trip in ${NATIVE_CURRENCIES.join(", ")}.` }),
    timeZone: z.string().refine(isValidTimeZone, "Use a time zone like America/Barbados."),
    tickets: z.array(ticketSchema).max(20),
    schedules: z.array(scheduleSchema).max(30).default([]),
    blackouts: z.array(blackoutSchema).max(100).default([])
  })
  .superRefine((trip, context) => {
    const seen = new Set<string>();
    trip.tickets.forEach((ticket, index) => {
      const key = `${ticket.kind}:${ticket.label.toLowerCase()}`;
      if (seen.has(key)) {
        context.addIssue({ code: "custom", path: ["tickets", index, "label"], message: `"${ticket.label}" is listed twice.` });
      }
      seen.add(key);
    });

    trip.schedules.forEach((schedule, index) => {
      if (schedule.validFrom && schedule.validUntil && schedule.validUntil < schedule.validFrom) {
        context.addIssue({ code: "custom", path: ["schedules", index, "validUntil"], message: "The end date is before the start date." });
      }
    });

    trip.blackouts.forEach((blackout, index) => {
      if (blackout.toDate < blackout.fromDate) {
        context.addIssue({ code: "custom", path: ["blackouts", index, "toDate"], message: "The end date is before the start date." });
      }
    });
  });

export type NativeTripInput = z.infer<typeof nativeTripInputSchema>;

/**
 * What must be true before a trip can be shown to travellers: something to buy, and a time it runs.
 * Returned as messages rather than thrown, so a form can show them all at once.
 */
export function publishProblems(trip: Pick<NativeTripInput, "tickets" | "schedules">): string[] {
  const problems: string[] = [];
  const paidTickets = trip.tickets.filter((ticket) => ticket.kind === "TICKET" && ticket.active && ticket.priceCents > 0);
  if (paidTickets.length === 0) problems.push("Add at least one ticket with a price.");
  if (!trip.schedules.some((schedule) => schedule.active)) problems.push("Add at least one departure time.");
  return problems;
}

/** The cheapest paid ticket, in cents: what "from" means on a trip card. */
export function lowestTicketCents(tickets: Pick<NativeTripInput["tickets"][number], "kind" | "active" | "priceCents">[]) {
  const prices = tickets.filter((ticket) => ticket.kind === "TICKET" && ticket.active && ticket.priceCents > 0).map((ticket) => ticket.priceCents);
  return prices.length > 0 ? Math.min(...prices) : null;
}
