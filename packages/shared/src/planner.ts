import { DateTime } from "luxon";
import { resolveTimezone } from "./dayBounds";

export type BlockValidation = { valid: true } | { valid: false; error: string };

function toDate(v: Date | number): Date {
  return v instanceof Date ? v : new Date(v);
}

/**
 * Snap an epoch-ms instant to the nearest step boundary (default 5 min).
 * Half-step rounds up.
 */
export function snapToStepMs(ms: number, stepMin = 5): number {
  const stepMs = stepMin * 60 * 1000;
  return Math.round(ms / stepMs) * stepMs;
}

/**
 * Mirror of backend validateBlockTimes (apps/backend/src/routes/planner.ts):
 * duration 5min–12h, 5-min aligned in the user's tz (minute % 5, zero
 * seconds/ms), and fully within one local calendar day — where ending
 * exactly at midnight is allowed (end - 1ms day check).
 */
export function blockValidation(
  start: Date | number,
  end: Date | number,
  tz = "UTC"
): BlockValidation {
  const startAt = toDate(start);
  const endAt = toDate(end);
  if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
    return { valid: false, error: "Invalid start or end date" };
  }

  const safeTz = resolveTimezone(tz);
  const durationMs = endAt.getTime() - startAt.getTime();
  const min5Ms = 5 * 60 * 1000;
  const max12hMs = 12 * 60 * 60 * 1000;

  if (durationMs < min5Ms || durationMs > max12hMs) {
    return { valid: false, error: "Block duration must be between 5 minutes and 12 hours" };
  }

  const startLocal = DateTime.fromJSDate(startAt, { zone: safeTz });
  const endLocal = DateTime.fromJSDate(endAt, { zone: safeTz });
  if (
    startLocal.minute % 5 !== 0 ||
    endLocal.minute % 5 !== 0 ||
    startLocal.second !== 0 ||
    endLocal.second !== 0 ||
    startLocal.millisecond !== 0 ||
    endLocal.millisecond !== 0
  ) {
    return {
      valid: false,
      error: "Block start and end times must be aligned to 5-minute increments",
    };
  }

  const startDay = startLocal.toISODate();
  const endDay = DateTime.fromJSDate(new Date(endAt.getTime() - 1), { zone: safeTz }).toISODate();
  if (startDay !== endDay) {
    return { valid: false, error: "Block must fall entirely within one local calendar day" };
  }
  return { valid: true };
}

export interface PlannerBlockInput {
  startAt: Date | number;
  endAt: Date | number;
}

export interface CapacityResult {
  scheduledMin: number;
  freeMin: number;
  overCapacity: boolean;
}

/**
 * Roll up scheduled minutes from blocks against a work-day budget.
 * scheduledMin rounds each block to whole minutes (mirrors backend);
 * freeMin is clamped at 0; overCapacity flags scheduledMin > workMin.
 */
export function capacityMath(blocks: PlannerBlockInput[], workMin: number): CapacityResult {
  let scheduledMin = 0;
  for (const b of blocks) {
    const s = toDate(b.startAt).getTime();
    const e = toDate(b.endAt).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) continue;
    scheduledMin += Math.round((e - s) / (1000 * 60));
  }
  return {
    scheduledMin,
    freeMin: Math.max(0, workMin - scheduledMin),
    overCapacity: scheduledMin > workMin,
  };
}
