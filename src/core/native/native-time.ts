/**
 * Local dates and times for the native booking system. A trip lives in one IANA time zone and every
 * date ("2026-10-14") and time ("09:00") on it is read in that zone, so a 9am sailing in Barbados is
 * 9am for everyone whatever the server clock says. Dates are plain ISO strings so they sort and
 * compare without a zone sneaking in.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME = /^(\d{2}):(\d{2})$/;

export function isIsoDate(value: string) {
  const match = value.match(ISO_DATE);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isLocalTime(value: string) {
  const match = value.match(LOCAL_TIME);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

export function addDaysIso(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** 0 = Sunday ... 6 = Saturday for a calendar date. A date has one weekday in every zone. */
export function weekdayOf(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Every ISO date from `from` for `days` days. */
export function dateRange(from: string, days: number) {
  return Array.from({ length: Math.max(0, days) }, (_, index) => addDaysIso(from, index));
}

function zoneParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(instant);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return { year: read("year"), month: read("month"), day: read("day"), hour: read("hour"), minute: read("minute"), second: read("second") };
}

/** Today's calendar date in the zone. */
export function todayInZone(timeZone: string, now: Date = new Date()) {
  const { year, month, day } = zoneParts(now, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The UTC instant at which the wall clock in `timeZone` reads `localDate localTime`. Two passes so a
 * time near a daylight-saving change still lands on the right side of it.
 */
export function localToUtc(localDate: string, localTime: string, timeZone: string) {
  const [year, month, day] = localDate.split("-").map(Number);
  const [hour, minute] = localTime.split(":").map(Number);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wallAsUtc;

  for (let pass = 0; pass < 2; pass += 1) {
    const parts = zoneParts(new Date(guess), timeZone);
    const shownAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    guess += wallAsUtc - shownAsUtc;
  }

  return new Date(guess);
}

export type RequestedDate = { date: string; time: string | null };

/**
 * Reads the loose date text the booking flow carries: an explicit ISO date, an ISO date with a time
 * ("2026-10-14 09:00:00", which is what a chosen time option looks like), or "today"/"tomorrow".
 * Returns null when it is none of those.
 */
export function resolveRequestedDate(text: string, timeZone: string, now: Date = new Date()): RequestedDate | null {
  const trimmed = text.trim();
  const withTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?/);
  if (withTime && isIsoDate(withTime[1])) {
    return { date: withTime[1], time: `${withTime[2]}:${withTime[3]}` };
  }

  const explicit = trimmed.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (explicit && isIsoDate(explicit)) {
    return { date: explicit, time: null };
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes("tomorrow")) return { date: addDaysIso(todayInZone(timeZone, now), 1), time: null };
  if (lower.includes("today")) return { date: todayInZone(timeZone, now), time: null };
  return null;
}

/** "09:00" -> "9:00 AM", the label travellers see. */
export function formatTimeLabel(localTime: string) {
  const [hour, minute] = localTime.split(":").map(Number);
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${period}`;
}

/** The `startTimeLocal` shape every PMS adapter returns: "2026-10-14 09:00:00". */
export function toStartTimeLocal(localDate: string, localTime: string) {
  return `${localDate} ${localTime}:00`;
}
