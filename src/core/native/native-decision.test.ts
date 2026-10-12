import { describe, expect, it } from "vitest";
import { isPastOperatorDeadline, OPERATOR_DECISION_HOURS, operatorDeadlineFrom } from "./native-decision";

describe("native operator decision window", () => {
  it("gives the operator 24 hours", () => {
    expect(OPERATOR_DECISION_HOURS).toBe(24);
    expect(operatorDeadlineFrom(new Date("2026-10-08T10:00:00Z")).toISOString()).toBe("2026-10-09T10:00:00.000Z");
  });

  it("is past the deadline only at or after it, and never when there is no deadline", () => {
    const deadline = new Date("2026-10-09T10:00:00Z");
    expect(isPastOperatorDeadline(deadline, new Date("2026-10-09T09:59:59Z"))).toBe(false);
    expect(isPastOperatorDeadline(deadline, new Date("2026-10-09T10:00:00Z"))).toBe(true);
    expect(isPastOperatorDeadline(null, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});
