import { DateTime, IANAZone } from "luxon";
import { and, eq, gte, lt, or, sql, type SQL } from "drizzle-orm";
import * as schema from "../db/schema";

/**
 * Normalizes a date to UTC midnight for all-day floating dates.
 * e.g. "2026-11-04" or Date -> 2026-11-04T00:00:00.000Z
 */
export function toUtcMidnight(val: string | number | Date): Date {
  if (typeof val === "string") {
    const match = val.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
    }
  }
  const d = new Date(val);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Validates startAt <= dueAt. Subtasks are not constrained inside parent range.
 */
export function validateStartDue(
  startAt?: Date | null,
  dueAt?: Date | null
): { valid: boolean; error?: string } {
  if (startAt && dueAt && startAt.getTime() > dueAt.getTime()) {
    return {
      valid: false,
      error: "startAt cannot be after dueAt",
    };
  }
  return { valid: true };
}

/**
 * Validates estimateMin is an integer between 1 and 1440.
 */
export function validateEstimateMin(
  estimateMin?: number | null
): { valid: boolean; error?: string } {
  if (estimateMin === undefined || estimateMin === null) {
    return { valid: true };
  }
  if (!Number.isInteger(estimateMin) || estimateMin < 1 || estimateMin > 1440) {
    return {
      valid: false,
      error: "estimateMin must be an integer between 1 and 1440",
    };
  }
  return { valid: true };
}

/**
 * Validates location coordinates: lat (-90..90), lng (-180..180), radiusM (50..5000)
 */
export function validateLocationCoords(
  lat?: number | null,
  lng?: number | null,
  radiusM?: number | null
): { valid: boolean; error?: string } {
  if (lat !== undefined && lat !== null) {
    if (typeof lat !== "number" || isNaN(lat) || lat < -90 || lat > 90) {
      return { valid: false, error: "lat must be a number between -90 and 90" };
    }
  }
  if (lng !== undefined && lng !== null) {
    if (typeof lng !== "number" || isNaN(lng) || lng < -180 || lng > 180) {
      return { valid: false, error: "lng must be a number between -180 and 180" };
    }
  }
  if (radiusM !== undefined && radiusM !== null) {
    if (typeof radiusM !== "number" || !Number.isInteger(radiusM) || radiusM < 50 || radiusM > 5000) {
      return { valid: false, error: "radiusM must be an integer between 50 and 5000" };
    }
  }
  return { valid: true };
}

export interface DayBoundsResult {
  startUtc: Date;
  endUtc: Date;
  floatStart: Date;
  floatEnd: Date;
  localDate: string;
}

/**
 * Validates timezone with fallback to "UTC".
 */
export function resolveTimezone(tz?: string | null): string {
  if (!tz || typeof tz !== "string") return "UTC";
  return IANAZone.isValidZone(tz) ? tz : "UTC";
}

/**
 * Computes start and end of day in local timezone and UTC, respecting DST transitions.
 * Returns { startUtc, endUtc, floatStart, floatEnd, localDate }.
 */
export function dayBounds(
  dateInput: string | Date | number | DateTime,
  tz: string = "UTC"
): DayBoundsResult {
  const validZone = resolveTimezone(tz);

  let localDayStart: DateTime;
  if (DateTime.isDateTime(dateInput)) {
    localDayStart = dateInput.setZone(validZone).startOf("day");
  } else if (dateInput instanceof Date) {
    localDayStart = DateTime.fromJSDate(dateInput, { zone: validZone }).startOf("day");
  } else if (typeof dateInput === "number") {
    localDayStart = DateTime.fromMillis(dateInput, { zone: validZone }).startOf("day");
  } else if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      localDayStart = DateTime.fromISO(trimmed, { zone: validZone }).startOf("day");
    } else {
      const parsed = DateTime.fromISO(trimmed, { zone: validZone });
      localDayStart = (parsed.isValid ? parsed : DateTime.fromJSDate(new Date(trimmed), { zone: validZone })).startOf("day");
    }
  } else {
    localDayStart = DateTime.now().setZone(validZone).startOf("day");
  }

  if (!localDayStart.isValid) {
    localDayStart = DateTime.now().setZone(validZone).startOf("day");
  }

  // Local day end is localDayStart + 1 day (never +24h due to DST)
  const localDayEnd = localDayStart.plus({ days: 1 }).startOf("day");
  const localDate = localDayStart.toISODate()!;
  const nextLocalDate = localDayEnd.toISODate()!;

  return {
    startUtc: localDayStart.toUTC().toJSDate(),
    endUtc: localDayEnd.toUTC().toJSDate(),
    floatStart: toUtcMidnight(localDate),
    floatEnd: toUtcMidnight(nextLocalDate),
    localDate,
  };
}

/**
 * Date query predicate helper for Drizzle:
 * (all_day = 0 AND due_at >= :startUtc AND due_at < :endUtc) OR (all_day = 1 AND due_at >= :floatStart AND due_at < :floatEnd)
 */
export function buildDateBoundsPredicate(
  bounds: { startUtc: Date; endUtc: Date; floatStart: Date; floatEnd: Date },
  dueCol = schema.tasks.dueAt,
  allDayCol = schema.tasks.allDay
): SQL {
  return or(
    and(
      eq(allDayCol, false),
      gte(dueCol, bounds.startUtc),
      lt(dueCol, bounds.endUtc)
    ),
    and(
      eq(allDayCol, true),
      gte(dueCol, bounds.floatStart),
      lt(dueCol, bounds.floatEnd)
    )
  )!;
}

/**
 * Builds raw SQL predicate for SQLite queries
 */
export function buildDateBoundsSql(
  bounds: { startUtc: Date; endUtc: Date; floatStart: Date; floatEnd: Date },
  tableAlias = "tasks",
  dueColName = "due_at",
  allDayColName = "all_day"
): SQL {
  return sql`(((${sql.raw(tableAlias)}.${sql.raw(allDayColName)} = 0 OR ${sql.raw(tableAlias)}.${sql.raw(allDayColName)} IS NULL) AND ${sql.raw(tableAlias)}.${sql.raw(dueColName)} >= ${bounds.startUtc.getTime()} AND ${sql.raw(tableAlias)}.${sql.raw(dueColName)} < ${bounds.endUtc.getTime()}) OR (${sql.raw(tableAlias)}.${sql.raw(allDayColName)} = 1 AND ${sql.raw(tableAlias)}.${sql.raw(dueColName)} >= ${bounds.floatStart.getTime()} AND ${sql.raw(tableAlias)}.${sql.raw(dueColName)} < ${bounds.floatEnd.getTime()}))`;
}

/**
 * Helper to build overdue predicate:
 * Timed tasks with due_at < now, all-day tasks with due_at < floatStart
 */
export function buildOverduePredicate(
  now: Date,
  todayFloatStart: Date,
  dueCol = schema.tasks.dueAt,
  allDayCol = schema.tasks.allDay
): SQL {
  return or(
    and(
      eq(allDayCol, false),
      lt(dueCol, now)
    ),
    and(
      eq(allDayCol, true),
      lt(dueCol, todayFloatStart)
    )
  )!;
}
