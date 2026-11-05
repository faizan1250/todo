/**
 * Repeat presets + custom RRULE builder/validator (Phase 3 premium Day 5).
 *
 * Pure logic, no React. Mirrors the backend validation constraints in
 * `packages/shared/src/recurrence.ts` (`validateRecurrenceRule`) and
 * `MAX_RECURRENCE_COUNT` (1000):
 * - no sub-daily rules (only day/week/month/year units exist here)
 * - COUNT <= 1000
 * - after_completion mode needs >= 1 day between occurrences
 *   (weekday custom sets and intervals below are all >= daily by construction)
 */

export type RepeatMode = "fixed" | "after_completion";

export type RepeatPresetId =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

export type RepeatUnit = "day" | "week" | "month" | "year";

export interface RepeatEnds {
  kind: "never" | "on_date" | "after_n";
  /** ISO date (yyyy-mm-dd) for `on_date`. */
  untilDate?: string;
  /** Occurrence count for `after_n`. */
  count?: number;
}

export interface RepeatCustomConfig {
  interval: number;
  unit: RepeatUnit;
  /** BYDAY codes, e.g. ["MO","WE"]. Only used for weekly. */
  weekdays: string[];
  /** Day of month 1-31. Only used for monthly. Null = no BYMONTHDAY. */
  monthDay: number | null;
  ends: RepeatEnds;
}

export const MAX_REPEAT_COUNT = 1000;

export const WEEKDAY_OPTIONS: Array<{ code: string; label: string }> = [
  { code: "MO", label: "Mon" },
  { code: "TU", label: "Tue" },
  { code: "WE", label: "Wed" },
  { code: "TH", label: "Thu" },
  { code: "FR", label: "Fri" },
  { code: "SA", label: "Sat" },
  { code: "SU", label: "Sun" },
];

export interface RepeatPreset {
  id: Exclude<RepeatPresetId, "none" | "custom">;
  label: string;
  example: string;
  rrule: string;
}

export const REPEAT_PRESETS: RepeatPreset[] = [
  { id: "daily", label: "Every day", example: "Due 9:00 Mon → again 9:00 Tue", rrule: "FREQ=DAILY;INTERVAL=1" },
  {
    id: "weekdays",
    label: "Every weekday (Mon–Fri)",
    example: "Due Fri → again Mon",
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
  },
  { id: "weekly", label: "Every week", example: "Due Mon 9:00 → again next Mon 9:00", rrule: "FREQ=WEEKLY;INTERVAL=1" },
  { id: "monthly", label: "Every month", example: "Due 5th → again the 5th next month", rrule: "FREQ=MONTHLY;INTERVAL=1" },
  { id: "yearly", label: "Every year", example: "Due 16 Mar → again 16 Mar next year", rrule: "FREQ=YEARLY;INTERVAL=1" },
];

export function presetRrule(id: RepeatPresetId): string | null {
  if (id === "none" || id === "custom") return null;
  return REPEAT_PRESETS.find((p) => p.id === id)?.rrule ?? null;
}

const UNIT_TO_FREQ: Record<RepeatUnit, string> = {
  day: "DAILY",
  week: "WEEKLY",
  month: "MONTHLY",
  year: "YEARLY",
};

function toUntilStamp(dateStr: string): string | null {
  // yyyy-mm-dd → UNTIL=YYYYMMDDT000000Z (midnight UTC end bound).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
  if (!m) return null;
  const [, y, mo, d] = m;
  const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (
    dt.getUTCFullYear() !== Number(y) ||
    dt.getUTCMonth() !== Number(mo) - 1 ||
    dt.getUTCDate() !== Number(d)
  ) {
    return null;
  }
  return `${y}${mo}${d}T000000Z`;
}

export interface BuildResult {
  ok: boolean;
  rrule?: string;
  error?: string;
}

export function buildCustomRRule(config: RepeatCustomConfig, _mode: RepeatMode): BuildResult {
  const interval = Math.floor(config.interval);
  if (!Number.isFinite(interval) || interval < 1) {
    return { ok: false, error: "Repeat every must be at least 1." };
  }
  if (interval > MAX_REPEAT_COUNT) {
    return { ok: false, error: `Repeat interval cannot exceed ${MAX_REPEAT_COUNT}.` };
  }

  const freq = UNIT_TO_FREQ[config.unit];
  if (!freq) return { ok: false, error: "Unknown repeat unit." };

  let rrule = `FREQ=${freq}`;
  if (interval > 1) rrule += `;INTERVAL=${interval}`;

  if (config.unit === "week" && config.weekdays.length > 0) {
    const valid = config.weekdays.filter((c) => WEEKDAY_OPTIONS.some((w) => w.code === c));
    if (valid.length > 0) rrule += `;BYDAY=${valid.join(",")}`;
  }

  if (config.unit === "month" && config.monthDay != null) {
    if (config.monthDay < 1 || config.monthDay > 31) {
      return { ok: false, error: "Monthly day must be between 1 and 31." };
    }
    rrule += `;BYMONTHDAY=${config.monthDay}`;
  }

  if (config.ends.kind === "after_n") {
    const count = Math.floor(config.ends.count ?? 0);
    if (!Number.isFinite(count) || count < 1) {
      return { ok: false, error: "Repeat count must be at least 1." };
    }
    if (count > MAX_REPEAT_COUNT) {
      return { ok: false, error: `Repeat count cannot exceed ${MAX_REPEAT_COUNT}.` };
    }
    rrule += `;COUNT=${count}`;
  } else if (config.ends.kind === "on_date") {
    const stamp = toUntilStamp(config.ends.untilDate ?? "");
    if (!stamp) {
      return { ok: false, error: "Pick a valid end date (yyyy-mm-dd)." };
    }
    rrule += `;UNTIL=${stamp}`;
  }

  return { ok: true, rrule };
}

/**
 * Client-side mirror of the backend `validateRecurrenceRule` constraints.
 * The editor only builds rules from day+ units, so sub-daily rules can only
 * arrive via pasted custom strings — still rejected here.
 */
export function validateRepeatRule(
  rrule: string,
  mode: RepeatMode = "fixed"
): { valid: boolean; error?: string } {
  if (!rrule || typeof rrule !== "string" || !rrule.trim()) {
    return { valid: false, error: "Repeat rule is required." };
  }
  const upper = rrule.toUpperCase();
  if (upper.includes("FREQ=SECONDLY") || upper.includes("FREQ=MINUTELY")) {
    return { valid: false, error: "Repeats faster than daily are not supported." };
  }
  if (upper.includes("FREQ=HOURLY")) {
    return { valid: false, error: "Repeats faster than daily are not supported." };
  }
  const countMatch = upper.match(/COUNT=(\d+)/);
  if (countMatch && parseInt(countMatch[1], 10) > MAX_REPEAT_COUNT) {
    return { valid: false, error: `Repeat count cannot exceed ${MAX_REPEAT_COUNT}.` };
  }
  if (!/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.test(upper)) {
    return { valid: false, error: "Rule must start with a daily, weekly, monthly, or yearly frequency." };
  }
  if (mode === "after_completion" && upper.includes("INTERVAL=0")) {
    return { valid: false, error: "“When I finish” repeats need at least 1 day apart." };
  }
  return { valid: true };
}

const FREQ_TO_UNIT: Record<string, RepeatUnit> = {
  DAILY: "day",
  WEEKLY: "week",
  MONTHLY: "month",
  YEARLY: "year",
};

/**
 * Best-effort parse of an RRULE string back into the custom form so the
 * editor can open on existing values. Returns null when unparseable.
 */
export function parseRRuleToCustom(rrule: string): RepeatCustomConfig | null {
  try {
    const upper = rrule.toUpperCase();
    const freqMatch = upper.match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/);
    if (!freqMatch) return null;
    const unit = FREQ_TO_UNIT[freqMatch[1]];
    const intervalMatch = upper.match(/INTERVAL=(\d+)/);
    const interval = intervalMatch ? parseInt(intervalMatch[1], 10) : 1;
    if (!Number.isFinite(interval) || interval < 1) return null;

    const bydayMatch = upper.match(/BYDAY=([A-Z,]+)/);
    const weekdays = bydayMatch
      ? bydayMatch[1].split(",").filter((c) => WEEKDAY_OPTIONS.some((w) => w.code === c))
      : [];

    const monthDayMatch = upper.match(/BYMONTHDAY=(\d{1,2})/);
    const monthDay = monthDayMatch ? parseInt(monthDayMatch[1], 10) : null;

    const countMatch = upper.match(/COUNT=(\d+)/);
    const untilMatch = upper.match(/UNTIL=(\d{8})T\d{6}Z?/);
    let ends: RepeatEnds = { kind: "never" };
    if (countMatch) {
      ends = { kind: "after_n", count: parseInt(countMatch[1], 10) };
    } else if (untilMatch) {
      const d = untilMatch[1];
      ends = { kind: "on_date", untilDate: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` };
    }

    return { interval, unit, weekdays, monthDay, ends };
  } catch {
    return null;
  }
}

/** "Mon 16 Mar" — short label for toasts and next-date previews. */
export function formatNextDateLabel(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("day")} ${get("month")}`.replace(/\s+/g, " ").trim();
}
