export type WhenInput = Date | number | string | null | undefined;

export interface FormatWhenOptions {
  /** Reference point for relative labels. Defaults to now. */
  now?: Date | number;
  /** True for date-only tasks: labels omit the clock time. */
  allDay?: boolean;
  /** BCP 47 locale for Intl formatting. Defaults to "en-US". */
  locale?: string;
  /** IANA zone used for calendar-day math. Defaults to the device zone. */
  timeZone?: string;
}

function toDate(value: Exclude<WhenInput, null | undefined>): Date | null {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayParts(d: Date, timeZone: string | undefined): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function diffCalendarDays(target: Date, now: Date, timeZone: string | undefined): number {
  const a = dayParts(target, timeZone);
  const b = dayParts(now, timeZone);
  return (
    Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)
  ) / (24 * 60 * 60 * 1000);
}

function formatTime(d: Date, locale: string, timeZone: string | undefined): string {
  // Whole hours read cleaner ("5 PM"); keep minutes otherwise ("5:05 PM").
  // Minute-ness is read in the display zone so zone shifts can't leak ":00".
  const probe = new Intl.DateTimeFormat(locale, {
    minute: "numeric",
    second: "numeric",
    timeZone,
  }).formatToParts(d);
  const num = (type: string): number => Number(probe.find((p) => p.type === type)?.value ?? 0);
  const onHour = num("minute") === 0 && num("second") === 0;
  return new Intl.DateTimeFormat(locale, onHour ? { hour: "numeric", timeZone } : {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

function formatDayWithDate(d: Date, locale: string, timeZone: string | undefined): string {
  // "Mon 9 Mar" — short weekday, day, short month.
  const parts = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone,
  }).formatToParts(d);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`;
}

/**
 * Friendly scheduling label for a due date, computed with Intl only.
 * - Today / Tomorrow (+ ", 5 PM" when timed)
 * - "Mon 9 Mar" (+ ", 5 PM" when timed) for other upcoming days
 * - "Overdue by 1 day" / "Overdue by N days" for past days
 * Returns null for missing or invalid input.
 */
export function formatWhen(dueAt: WhenInput, options: FormatWhenOptions = {}): string | null {
  if (dueAt === null || dueAt === undefined) return null;
  const target = toDate(dueAt);
  if (!target) return null;

  const { allDay = false, locale = "en-US", timeZone } = options;
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const diff = diffCalendarDays(target, now, timeZone);

  if (diff < 0) {
    const days = Math.abs(diff);
    return days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`;
  }
  if (diff === 0) {
    return allDay ? "Today" : `Today, ${formatTime(target, locale, timeZone)}`;
  }
  if (diff === 1) {
    return allDay ? "Tomorrow" : `Tomorrow, ${formatTime(target, locale, timeZone)}`;
  }
  const day = formatDayWithDate(target, locale, timeZone);
  return allDay ? day : `${day}, ${formatTime(target, locale, timeZone)}`;
}

/**
 * Overdue-only label. Returns null when the date is today-or-later,
 * missing, or invalid — use formatWhen for the general case.
 */
export function formatOverdue(dueAt: WhenInput, options: FormatWhenOptions = {}): string | null {
  if (dueAt === null || dueAt === undefined) return null;
  const target = toDate(dueAt);
  if (!target) return null;

  const { timeZone } = options;
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const diff = diffCalendarDays(target, now, timeZone);
  if (diff >= 0) return null;
  const days = Math.abs(diff);
  return days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`;
}
