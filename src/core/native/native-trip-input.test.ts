import { describe, expect, it } from "vitest";
import { lowestTicketCents, nativeTripInputSchema, publishProblems } from "./native-trip-input";

const valid = {
  title: "Sunset catamaran",
  durationMinutes: 150,
  currency: "USD",
  timeZone: "America/Barbados",
  tickets: [{ label: "Adult", priceCents: 9500 }],
  schedules: [{ daysOfWeek: [1, 3], localTime: "16:00", seats: 20 }]
};

describe("nativeTripInputSchema", () => {
  it("accepts a normal trip and fills defaults", () => {
    const parsed = nativeTripInputSchema.parse(valid);
    expect(parsed.description).toBe("");
    expect(parsed.photoUrls).toEqual([]);
    expect(parsed.blackouts).toEqual([]);
    expect(parsed.tickets[0]).toMatchObject({ kind: "TICKET", active: true });
    expect(parsed.schedules[0]).toMatchObject({ validFrom: null, validUntil: null, active: true });
  });

  it("refuses a currency the ledger cannot book", () => {
    expect(nativeTripInputSchema.safeParse({ ...valid, currency: "BBD" }).success).toBe(false);
  });

  it("refuses a bad time zone, time and photo link", () => {
    expect(nativeTripInputSchema.safeParse({ ...valid, timeZone: "Barbados" }).success).toBe(false);
    expect(nativeTripInputSchema.safeParse({ ...valid, schedules: [{ ...valid.schedules[0], localTime: "4pm" }] }).success).toBe(false);
    expect(nativeTripInputSchema.safeParse({ ...valid, photoUrls: ["http://x.test/a.jpg"] }).success).toBe(false);
  });

  it("refuses duplicate tickets but allows the same label as a ticket and an extra", () => {
    const duplicate = nativeTripInputSchema.safeParse({ ...valid, tickets: [valid.tickets[0], { label: "adult", priceCents: 100 }] });
    expect(duplicate.success).toBe(false);
    const split = nativeTripInputSchema.safeParse({ ...valid, tickets: [valid.tickets[0], { label: "Adult", priceCents: 100, kind: "EXTRA" }] });
    expect(split.success).toBe(true);
  });

  it("refuses dates that run backwards", () => {
    const schedule = { ...valid.schedules[0], validFrom: "2026-12-01", validUntil: "2026-11-01" };
    expect(nativeTripInputSchema.safeParse({ ...valid, schedules: [schedule] }).success).toBe(false);
    expect(nativeTripInputSchema.safeParse({ ...valid, blackouts: [{ fromDate: "2026-12-05", toDate: "2026-12-01" }] }).success).toBe(false);
    expect(nativeTripInputSchema.safeParse({ ...valid, blackouts: [{ fromDate: "2026-12-24", toDate: "2026-12-26" }] }).success).toBe(true);
  });

  it("refuses fractional or negative prices", () => {
    expect(nativeTripInputSchema.safeParse({ ...valid, tickets: [{ label: "Adult", priceCents: 95.5 }] }).success).toBe(false);
    expect(nativeTripInputSchema.safeParse({ ...valid, tickets: [{ label: "Adult", priceCents: -1 }] }).success).toBe(false);
  });
});

describe("publishProblems", () => {
  const parsed = nativeTripInputSchema.parse(valid);

  it("is clear when there is a paid ticket and a departure time", () => {
    expect(publishProblems(parsed)).toEqual([]);
  });

  it("asks for both missing pieces at once", () => {
    expect(publishProblems({ tickets: [], schedules: [] })).toHaveLength(2);
  });

  it("does not count free, inactive or extra tickets, or inactive times", () => {
    const tickets = nativeTripInputSchema.parse({
      ...valid,
      tickets: [
        { label: "Free", priceCents: 0 },
        { label: "Old", priceCents: 500, active: false },
        { label: "Snorkel", priceCents: 500, kind: "EXTRA" }
      ],
      schedules: [{ ...valid.schedules[0], active: false }]
    });
    expect(publishProblems(tickets)).toHaveLength(2);
  });
});

describe("lowestTicketCents", () => {
  it("is the cheapest paid, active ticket", () => {
    expect(
      lowestTicketCents([
        { kind: "TICKET", active: true, priceCents: 9500 },
        { kind: "TICKET", active: true, priceCents: 4500 },
        { kind: "TICKET", active: false, priceCents: 100 },
        { kind: "EXTRA", active: true, priceCents: 50 }
      ])
    ).toBe(4500);
  });

  it("is null when nothing is for sale", () => {
    expect(lowestTicketCents([])).toBeNull();
  });
});
