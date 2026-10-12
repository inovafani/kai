import { weekdayOf } from "./native-time";

export interface NativeScheduleRule {
  daysOfWeek: number[];
  localTime: string;
  seats: number;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
}

export interface NativeBlackoutRule {
  tripId: string | null;
  fromDate: string;
  toDate: string;
}

export interface PlannedDeparture {
  localTime: string;
  seats: number;
}

/**
 * The departures a trip's weekly schedules produce on one date. Two schedules at the same time on the
 * same day collapse into one departure holding the larger seat count, because a departure is unique
 * per trip, date and time.
 */
export function plannedDeparturesForDate(schedules: NativeScheduleRule[], date: string): PlannedDeparture[] {
  const weekday = weekdayOf(date);
  const byTime = new Map<string, number>();

  for (const schedule of schedules) {
    if (!schedule.active || schedule.seats <= 0) continue;
    if (!schedule.daysOfWeek.includes(weekday)) continue;
    if (schedule.validFrom && date < schedule.validFrom) continue;
    if (schedule.validUntil && date > schedule.validUntil) continue;
    byTime.set(schedule.localTime, Math.max(byTime.get(schedule.localTime) ?? 0, schedule.seats));
  }

  return [...byTime.entries()]
    .map(([localTime, seats]) => ({ localTime, seats }))
    .sort((left, right) => left.localTime.localeCompare(right.localTime));
}

/** True when a blackout covers the date for this trip (a blackout without a trip covers all trips). */
export function isBlackedOut(blackouts: NativeBlackoutRule[], tripId: string, date: string) {
  return blackouts.some(
    (blackout) => (blackout.tripId === null || blackout.tripId === tripId) && date >= blackout.fromDate && date <= blackout.toDate
  );
}
