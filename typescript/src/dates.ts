// Calendar dates in the YYYY-MM-DD form used by the task's data files.
// Everything is worked out in UTC so that a day is always 24 hours and the
// result never depends on the machine's timezone or on daylight saving time.

import { PlanInputError } from "./errors.js";

export interface CalendarDate {
  year: number;
  month: number; // 1 to 12
  day: number; // 1 to 31
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * Read a value as a real calendar date written YYYY-MM-DD.
 * Returns null when the value is missing, is not text, or is not a real date,
 * so "2026-02-30" and "30/09/2026" are both rejected.
 */
export function parseIsoDate(value: unknown): CalendarDate | null {
  if (typeof value !== "string" || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date: CalendarDate = { year, month, day };
  return isRealCalendarDate(date) ? date : null;
}

/** Read a date that has to be valid, and say what is wrong with it when it is not. */
export function requireIsoDate(value: unknown, label = "date"): CalendarDate {
  const date = parseIsoDate(value);
  if (date === null) {
    throw new PlanInputError(`${label} is not a real date in the form YYYY-MM-DD: ${describeValue(value)}`);
  }
  return date;
}

export function formatIsoDate(date: CalendarDate): string {
  const year = String(date.year).padStart(4, "0");
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Whole calendar days from `from` to `to`; negative when `to` is the earlier one. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Today's date in the local timezone, as YYYY-MM-DD. */
export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function isRealCalendarDate(date: CalendarDate): boolean {
  // A day that does not exist rolls over into the next month, which the
  // comparison below catches. setUTCFullYear is used because the Date
  // constructor maps the years 0 to 99 into the 20th century.
  const probe = new Date(0);
  probe.setUTCFullYear(date.year, date.month - 1, date.day);
  return (
    probe.getUTCFullYear() === date.year &&
    probe.getUTCMonth() === date.month - 1 &&
    probe.getUTCDate() === date.day
  );
}

function toEpochDay(date: CalendarDate): number {
  const midnight = new Date(0);
  midnight.setUTCFullYear(date.year, date.month - 1, date.day);
  return Math.round(midnight.getTime() / MILLISECONDS_PER_DAY);
}

function describeValue(value: unknown): string {
  if (typeof value === "string") {
    return `"${value}"`;
  }
  if (value === undefined) {
    return "nothing";
  }
  if (value === null) {
    return "null";
  }
  return JSON.stringify(value) ?? String(value);
}
