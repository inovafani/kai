import { describe, expect, it } from "vitest";
import { addDaysIso, dateRange, formatTimeLabel, isIsoDate, localToUtc, resolveRequestedDate, todayInZone, weekdayOf } from "./native-time";

describe("native time", () => {
  it("validates real calendar dates only", () => {
    expect(isIsoDate("2026-10-14")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("14/10/2026")).toBe(false);
  });

  it("adds days across month and year ends and reads the weekday", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOf("2026-10-14")).toBe(3); // Wednesday
    expect(dateRange("2026-10-30", 3)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  it("makes 9am in Barbados 9am for everyone, whatever the server zone", () => {
    expect(localToUtc("2026-10-14", "09:00", "America/Barbados").toISOString()).toBe("2026-10-14T13:00:00.000Z");
  });

  it("follows daylight saving on both sides of the change", () => {
    // Sydney moves to daylight time on 2026-10-04.
    expect(localToUtc("2026-10-03", "09:00", "Australia/Sydney").toISOString()).toBe("2026-10-02T23:00:00.000Z");
    expect(localToUtc("2026-10-05", "09:00", "Australia/Sydney").toISOString()).toBe("2026-10-04T22:00:00.000Z");
    // New York leaves daylight time on 2026-11-01.
    expect(localToUtc("2026-10-31", "09:00", "America/New_York").toISOString()).toBe("2026-10-31T13:00:00.000Z");
    expect(localToUtc("2026-11-02", "09:00", "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });

  it("reads today in the trip's zone, not the server's", () => {
    const now = new Date("2026-10-08T23:30:00Z");
    expect(todayInZone("Australia/Sydney", now)).toBe("2026-10-09");
    expect(todayInZone("America/Barbados", now)).toBe("2026-10-08");
  });

  it("resolves the loose date text the booking flow carries", () => {
    const now = new Date("2026-10-08T12:00:00Z");
    expect(resolveRequestedDate("2026-10-14", "America/Barbados", now)).toEqual({ date: "2026-10-14", time: null });
    expect(resolveRequestedDate("2026-10-14 09:30:00", "America/Barbados", now)).toEqual({ date: "2026-10-14", time: "09:30" });
    expect(resolveRequestedDate("tomorrow", "America/Barbados", now)).toEqual({ date: "2026-10-09", time: null });
    expect(resolveRequestedDate("today", "America/Barbados", now)).toEqual({ date: "2026-10-08", time: null });
    expect(resolveRequestedDate("sometime soon", "America/Barbados", now)).toBeNull();
  });

  it("labels times the way travellers read them", () => {
    expect(formatTimeLabel("09:00")).toBe("9:00 AM");
    expect(formatTimeLabel("12:30")).toBe("12:30 PM");
    expect(formatTimeLabel("00:15")).toBe("12:15 AM");
    expect(formatTimeLabel("17:45")).toBe("5:45 PM");
  });
});
