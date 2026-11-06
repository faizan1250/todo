import { DateTime } from "luxon";
import { dayBounds, resolveTimezone, type DayBoundsResult } from "./dayBounds";
import type { FilterTask } from "./filter";

/** Minimal task surface needed by the view predicates. */
export type ViewTask = Pick<
  FilterTask,
  "status" | "priority" | "dueAt" | "due_at" | "startAt" | "start_at" | "allDay" | "all_day"
>;

function pickDate(task: ViewTask): { ms: number; allDay: boolean } | null {
  const raw = (task.dueAt ?? task.due_at ?? task.startAt ?? task.start_at) as
    | Date
    | number
    | string
    | null
    | undefined;
  if (raw === null || raw === undefined) return null;
  const ms = raw instanceof Date ? raw.getTime() : new Date(raw as number | string).getTime();
  if (isNaN(ms)) return null;
  return { ms, allDay: (task.allDay ?? task.all_day) ?? false };
}

/** Two-branch floating rule: all-day compares against UTC-midnight bounds. */
function inBounds(ms: number, allDay: boolean, b: DayBoundsResult): boolean {
  if (allDay) {
    return ms >= b.floatStart.getTime() && ms < b.floatEnd.getTime();
  }
  return ms >= b.startUtc.getTime() && ms < b.endUtc.getTime();
}

function isActive(task: ViewTask): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

/** Effective date (due ?? start) falls inside the local day containing `now`. */
export function matchToday(task: ViewTask, now: Date | number = new Date(), tz = "UTC"): boolean {
  const d = pickDate(task);
  if (!d) return false;
  return inBounds(d.ms, d.allDay, dayBounds(new Date(now), resolveTimezone(tz)));
}

/** Effective date is before the start of today's bounds and the task is active. */
export function matchOverdue(task: ViewTask, now: Date | number = new Date(), tz = "UTC"): boolean {
  const d = pickDate(task);
  if (!d || !isActive(task)) return false;
  const b = dayBounds(new Date(now), resolveTimezone(tz));
  return d.ms < (d.allDay ? b.floatStart.getTime() : b.startUtc.getTime());
}

/**
 * Effective date is at/after the end of today, optionally within
 * `windowDays` calendar days from start-of-today, and the task is active.
 */
export function matchUpcoming(
  task: ViewTask,
  now: Date | number = new Date(),
  tz = "UTC",
  windowDays = 7
): boolean {
  const d = pickDate(task);
  if (!d || !isActive(task)) return false;
  const safeTz = resolveTimezone(tz);
  const b = dayBounds(new Date(now), safeTz);
  const dayEnd = d.allDay ? b.floatEnd.getTime() : b.endUtc.getTime();
  if (d.ms < dayEnd) return false;
  const windowEnd = DateTime.fromJSDate(new Date(now))
    .setZone(safeTz)
    .startOf("day")
    .plus({ days: windowDays })
    .toMillis();
  return d.ms < windowEnd;
}

/** Priority at or above threshold (default 1 = any explicit priority). */
export function matchPriority(task: ViewTask, min = 1): boolean {
  return (task.priority ?? 0) >= min;
}

/** No effective date (neither due nor start). */
export function matchNoDate(task: ViewTask): boolean {
  return pickDate(task) === null;
}

/** Completed tasks. */
export function matchCompleted(task: ViewTask): boolean {
  return task.status === "done";
}

/** All tasks (local "all" view). */
export function matchAll(_task: ViewTask): boolean {
  return true;
}

/** Effective date falls inside the local day containing `date`. */
export function matchDateInDay(
  task: ViewTask,
  date: Date | number | string,
  tz = "UTC"
): boolean {
  const d = pickDate(task);
  if (!d) return false;
  return inBounds(d.ms, d.allDay, dayBounds(date, resolveTimezone(tz)));
}
