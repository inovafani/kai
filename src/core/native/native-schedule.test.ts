import { describe, expect, it } from "vitest";
import { isBlackedOut, plannedDeparturesForDate, type NativeScheduleRule } from "./native-schedule";

const base: NativeScheduleRule = { daysOfWeek: [3, 6], localTime: "09:00", seats: 12, validFrom: null, validUntil: null, active: true };

describe("native schedule", () => {
  it("plans departures only on the scheduled weekdays", () => {
    expect(plannedDeparturesForDate([base], "2026-10-14")).toEqual([{ localTime: "09:00", seats: 12 }]); // Wednesday
    expect(plannedDeparturesForDate([base], "2026-10-15")).toEqual([]); // Thursday
  });

  it("respects the validity window, inclusively", () => {
    const limited = { ...base, validFrom: "2026-10-14", validUntil: "2026-10-21" };
    expect(plannedDeparturesForDate([limited], "2026-10-07")).toEqual([]);
    expect(plannedDeparturesForDate([limited], "2026-10-14")).toHaveLength(1);
    expect(plannedDeparturesForDate([limited], "2026-10-21")).toHaveLength(1);
    expect(plannedDeparturesForDate([limited], "2026-10-28")).toEqual([]);
  });

  it("ignores inactive schedules and schedules without seats", () => {
    expect(plannedDeparturesForDate([{ ...base, active: false }], "2026-10-14")).toEqual([]);
    expect(plannedDeparturesForDate([{ ...base, seats: 0 }], "2026-10-14")).toEqual([]);
  });

  it("orders departures by time and merges two schedules at the same time", () => {
    const planned = plannedDeparturesForDate(
      [{ ...base, localTime: "14:00" }, { ...base, localTime: "09:00", seats: 8 }, { ...base, localTime: "09:00", seats: 12 }],
      "2026-10-14"
    );
    expect(planned).toEqual([
      { localTime: "09:00", seats: 12 },
      { localTime: "14:00", seats: 12 }
    ]);
  });

  it("applies trip blackouts and tenant-wide blackouts", () => {
    const blackouts = [
      { tripId: "trip-a", fromDate: "2026-10-10", toDate: "2026-10-12" },
      { tripId: null, fromDate: "2026-12-25", toDate: "2026-12-25" }
    ];
    expect(isBlackedOut(blackouts, "trip-a", "2026-10-11")).toBe(true);
    expect(isBlackedOut(blackouts, "trip-b", "2026-10-11")).toBe(false);
    expect(isBlackedOut(blackouts, "trip-b", "2026-12-25")).toBe(true);
    expect(isBlackedOut(blackouts, "trip-a", "2026-10-13")).toBe(false);
  });
});
