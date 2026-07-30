import { describe, expect, it } from "vitest";
import { calculateBookingGrossAmountCents } from "./booking-pricing";

describe("calculateBookingGrossAmountCents", () => {
  it("falls back to a single ticket option covering all guests when no ticketQuantities are given", () => {
    const result = calculateBookingGrossAmountCents({
      guests: 4,
      ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }]
    });

    expect(result).toEqual({
      grossAmountCents: 20000,
      resolvedTicketQuantities: [{ optionLabel: "Adult", quantity: 4 }]
    });
  });

  it("sums multiple ticket quantities against their matching options", () => {
    const result = calculateBookingGrossAmountCents({
      guests: 3,
      ticketOptions: [
        { label: "Adult", unitPriceCents: 5000 },
        { label: "Child", unitPriceCents: 2500 }
      ],
      ticketQuantities: [
        { optionLabel: "Adult", quantity: 2 },
        { optionLabel: "Child", quantity: 1 }
      ]
    });

    expect(result?.grossAmountCents).toBe(12500);
  });

  it("adds extras on top of ticket totals", () => {
    const result = calculateBookingGrossAmountCents({
      guests: 2,
      ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }],
      ticketQuantities: [{ optionLabel: "Adult", quantity: 2 }],
      extraOptions: [{ label: "Snorkel gear", unitPriceCents: 1000 }],
      extraQuantities: [{ optionLabel: "Snorkel gear", quantity: 2 }]
    });

    expect(result?.grossAmountCents).toBe(12000);
  });

  it("ignores an extra quantity whose option is missing rather than failing", () => {
    const result = calculateBookingGrossAmountCents({
      guests: 1,
      ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }],
      ticketQuantities: [{ optionLabel: "Adult", quantity: 1 }],
      extraQuantities: [{ optionLabel: "Unknown extra", quantity: 1 }]
    });

    expect(result?.grossAmountCents).toBe(5000);
  });

  it("fails closed when a ticket quantity references an unknown option", () => {
    const result = calculateBookingGrossAmountCents({
      guests: 1,
      ticketOptions: [{ label: "Adult", unitPriceCents: 5000 }],
      ticketQuantities: [{ optionLabel: "Senior", quantity: 1 }]
    });

    expect(result).toBeNull();
  });

  it("fails closed when there are multiple ticket options but no explicit quantities", () => {
    const result = calculateBookingGrossAmountCents({
      guests: 2,
      ticketOptions: [
        { label: "Adult", unitPriceCents: 5000 },
        { label: "Child", unitPriceCents: 2500 }
      ]
    });

    expect(result).toBeNull();
  });

  it("fails closed when there are no ticket options at all", () => {
    const result = calculateBookingGrossAmountCents({ guests: 2, ticketOptions: [] });

    expect(result).toBeNull();
  });
});
