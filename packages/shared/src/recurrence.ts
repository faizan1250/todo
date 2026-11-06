import { rrulestr, RRule } from "rrule";
import { DateTime } from "luxon";
import { toUtcMidnight } from "./dayBounds";

export interface RecurrenceValidationResult {
  valid: boolean;
  error?: string;
  rrule?: string;
}

/**
 * Validates RRULE string and constraints:
 * - Reject FREQ=SECONDLY or FREQ=MINUTELY
 * - Reject COUNT > 1000
 * - Reject interval < 1 day for after_completion
 */
export function validateRecurrenceRule(
  rruleStr: string,
  mode: "fixed" | "after_completion" = "fixed",
  maxCount?: number | null
): RecurrenceValidationResult {
  if (!rruleStr || typeof rruleStr !== "string") {
    return { valid: false, error: "rrule string is required" };
  }

  const upper = rruleStr.toUpperCase();

  if (upper.includes("FREQ=SECONDLY") || upper.includes("FREQ=MINUTELY")) {
    return { valid: false, error: "Sub-hourly/minutely recurrences not supported" };
  }

  // Check for COUNT > 1000 in rule string
  const countMatch = upper.match(/COUNT=(\d+)/);
  if (countMatch) {
    const countVal = parseInt(countMatch[1], 10);
    if (countVal > 1000) {
      return { valid: false, error: "Recurrence count cannot exceed 1000" };
    }
  }

  if (maxCount !== undefined && maxCount !== null && maxCount > 1000) {
    return { valid: false, error: "Recurrence count cannot exceed 1000" };
  }

  if (mode === "after_completion") {
    if (upper.includes("FREQ=HOURLY")) {
      return { valid: false, error: "after_completion mode requires at least 1 day interval" };
    }
  }

  // Validate syntax with rrulestr
  try {
    rrulestr(rruleStr);
  } catch (err: any) {
    return { valid: false, error: `Invalid RRULE syntax: ${err.message}` };
  }

  return { valid: true, rrule: rruleStr };
}

/**
 * Converts wall-clock time in a given timezone into a UTC Date representing that wall-clock time.
 */
export function toWallClockUtc(date: Date, timezone: string): Date {
  const dt = DateTime.fromJSDate(date).setZone(timezone);
  return new Date(
    Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second, dt.millisecond)
  );
}

/**
 * Converts a UTC Date representing wall-clock time back to a real Date in the target timezone.
 */
export function fromWallClockUtc(wallClockUtc: Date, timezone: string): Date {
  const dt = DateTime.fromObject(
    {
      year: wallClockUtc.getUTCFullYear(),
      month: wallClockUtc.getUTCMonth() + 1,
      day: wallClockUtc.getUTCDate(),
      hour: wallClockUtc.getUTCHours(),
      minute: wallClockUtc.getUTCMinutes(),
      second: wallClockUtc.getUTCSeconds(),
      millisecond: wallClockUtc.getUTCMilliseconds(),
    },
    { zone: timezone }
  );
  return dt.toJSDate();
}

/**
 * Calculates the next occurrence date for a recurring task.
 * Fixed mode: first occurrence after task dueAt; if in the past, jump to first occurrence after now.
 * After-completion mode: now plus rule's interval at the original time of day.
 */
export function calculateNextOccurrence(params: {
  rruleStr: string;
  mode: "fixed" | "after_completion";
  timezone: string;
  dtstart: Date;
  referenceDueAt: Date | null;
  allDay: boolean;
  now?: Date;
}): Date | null {
  const { rruleStr, mode, timezone, dtstart, referenceDueAt, allDay } = params;
  const now = params.now ?? new Date();

  if (allDay) {
    // All-day tasks operate on UTC calendar dates directly
    const rule = rrulestr(rruleStr, { dtstart });

    if (mode === "after_completion") {
      // Calculate interval from rule
      const parsedOptions = RRule.parseString(rruleStr);
      const freq = parsedOptions.freq ?? RRule.DAILY;
      const interval = parsedOptions.interval ?? 1;

      let nextDt = DateTime.fromJSDate(now).toUTC();
      if (freq === RRule.DAILY) nextDt = nextDt.plus({ days: interval });
      else if (freq === RRule.WEEKLY) nextDt = nextDt.plus({ weeks: interval });
      else if (freq === RRule.MONTHLY) nextDt = nextDt.plus({ months: interval });
      else if (freq === RRule.YEARLY) nextDt = nextDt.plus({ years: interval });

      return toUtcMidnight(nextDt.toJSDate());
    }

    // Fixed mode for all-day
    const anchor = referenceDueAt ?? dtstart;
    let nextDate = rule.after(anchor);
    if (!nextDate) return null;

    if (nextDate.getTime() <= now.getTime()) {
      nextDate = rule.after(toUtcMidnight(now));
      if (!nextDate) return null;
    }

    return toUtcMidnight(nextDate);
  }

  // Timed tasks: DST-safe wall-clock arithmetic
  const dtstartWallClock = toWallClockUtc(dtstart, timezone);
  const rule = rrulestr(rruleStr, { dtstart: dtstartWallClock });

  if (mode === "after_completion") {
    const parsedOptions = RRule.parseString(rruleStr);
    const freq = parsedOptions.freq ?? RRule.DAILY;
    const interval = parsedOptions.interval ?? 1;

    const nowInZone = DateTime.fromJSDate(now).setZone(timezone);
    let nextInZone = nowInZone;

    if (freq === RRule.DAILY) nextInZone = nextInZone.plus({ days: interval });
    else if (freq === RRule.WEEKLY) nextInZone = nextInZone.plus({ weeks: interval });
    else if (freq === RRule.MONTHLY) nextInZone = nextInZone.plus({ months: interval });
    else if (freq === RRule.YEARLY) nextInZone = nextInZone.plus({ years: interval });

    // Set to original time of day if referenceDueAt is available
    if (referenceDueAt) {
      const origDueInZone = DateTime.fromJSDate(referenceDueAt).setZone(timezone);
      nextInZone = nextInZone.set({
        hour: origDueInZone.hour,
        minute: origDueInZone.minute,
        second: origDueInZone.second,
        millisecond: 0,
      });
    }

    return nextInZone.toJSDate();
  }

  // Fixed mode for timed task
  const anchorDate = referenceDueAt ?? dtstart;
  const anchorWallClock = toWallClockUtc(anchorDate, timezone);

  let nextWallClock = rule.after(anchorWallClock);
  if (!nextWallClock) return null;

  let nextInstant = fromWallClockUtc(nextWallClock, timezone);

  // If next occurrence is in the past, jump to first occurrence after now (prevents backlog of missed tasks)
  if (nextInstant.getTime() <= now.getTime()) {
    const nowWallClock = toWallClockUtc(now, timezone);
    nextWallClock = rule.after(nowWallClock);
    if (!nextWallClock) return null;
    nextInstant = fromWallClockUtc(nextWallClock, timezone);
  }

  return nextInstant;
}

const WEEKDAY_SHORT: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

function ordinal(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n}st`;
  if (mod10 === 2 && mod100 !== 12) return `${n}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${n}rd`;
  return `${n}th`;
}

function formatUntil(until: Date): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(until);
}

/**
 * Builds a plain-words summary of an RRULE string, e.g.
 * "Every 2 weeks on Mon and Wed, until 30 Jun".
 * Never throws: falls back to the raw rule string when unparseable.
 */
export function buildRecurrenceSummary(
  rruleStr: string,
  mode: "fixed" | "after_completion" = "fixed"
): string {
  let parsed: Record<string, any>;
  try {
    parsed = RRule.parseString(rruleStr);
  } catch {
    return rruleStr;
  }

  const freq: number | undefined = parsed.freq;
  const interval: number = parsed.interval ?? 1;
  const bymonthday = parsed.bymonthday as number[] | number | undefined;
  const count: number | undefined = parsed.count;
  const until: Date | undefined = parsed.until;

  const unitWord =
    freq === RRule.DAILY
      ? interval === 1
        ? "day"
        : "days"
      : freq === RRule.WEEKLY
        ? interval === 1
          ? "week"
          : "weeks"
        : freq === RRule.MONTHLY
          ? interval === 1
            ? "month"
            : "months"
          : freq === RRule.YEARLY
            ? interval === 1
              ? "year"
              : "years"
            : null;

  if (unitWord === null) return rruleStr;

  let summary = interval === 1 ? `Every ${unitWord}` : `Every ${interval} ${unitWord}`;

  // Extract weekday codes from the raw string (stable across rrule versions)
  const bydayMatch = rruleStr.toUpperCase().match(/BYDAY=([A-Z,]+)/);
  if (bydayMatch) {
    const codes = bydayMatch[1]
      .split(",")
      .map((c) => c.trim())
      .filter((c) => WEEKDAY_SHORT[c]);
    if (codes.length > 0) {
      const names = codes.map((c) => WEEKDAY_SHORT[c]);
      const joined =
        names.length === 1
          ? names[0]
          : names.length === 2
            ? `${names[0]} and ${names[1]}`
            : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
      summary += ` on ${joined}`;
    }
  } else if (freq === RRule.MONTHLY && bymonthday !== undefined) {
    const days = Array.isArray(bymonthday) ? bymonthday : [bymonthday];
    if (days.length > 0) {
      summary += ` on the ${days.map(ordinal).join(", ")}`;
    }
  }

  if (typeof count === "number") {
    summary += count === 1 ? `, once` : `, ${count} times`;
  } else if (until instanceof Date && !isNaN(until.getTime())) {
    summary += `, until ${formatUntil(until)}`;
  }

  if (mode === "after_completion") {
    summary += " after done";
  }

  return summary;
}
