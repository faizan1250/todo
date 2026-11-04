import { rrulestr, RRule } from "rrule";
import { DateTime } from "luxon";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { positionBetween } from "../utils/position";
import { toUtcMidnight } from "../utils/dates";
import { calculateRelativeRemindAt } from "./reminders";

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

/**
 * Spawns the next recurrence instance of a task.
 * Can be triggered on task complete (increments completedCount) or task skip (does not increment).
 */
export async function spawnNextRecurrenceInstance(params: {
  taskId: string;
  userId: string;
  isSkip?: boolean;
  tx?: any;
  now?: Date;
}): Promise<typeof schema.tasks.$inferSelect | null> {
  const { taskId, userId, isSkip = false } = params;
  const executor = params.tx ?? db;
  const now = params.now ?? new Date();

  // 1. Fetch completed/skipped task
  const [task] = await executor
    .select()
    .from(schema.tasks)
    .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));

  if (!task || !task.recurrenceId) {
    return null;
  }

  // 2. Fetch recurrence record
  const [recurrence] = await executor
    .select()
    .from(schema.recurrences)
    .where(
      and(
        eq(schema.recurrences.id, task.recurrenceId),
        eq(schema.recurrences.userId, userId),
        eq(schema.recurrences.active, true)
      )
    );

  if (!recurrence) {
    return null;
  }

  // Check termination by maxCount (only completed tasks count toward maxCount)
  const nextCompletedCount = isSkip ? recurrence.completedCount : recurrence.completedCount + 1;
  if (
    !isSkip &&
    recurrence.maxCount !== null &&
    recurrence.maxCount !== undefined &&
    nextCompletedCount >= recurrence.maxCount
  ) {
    await executor
      .update(schema.recurrences)
      .set({
        completedCount: nextCompletedCount,
        active: false,
        version: sql`${schema.recurrences.version} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.recurrences.id, recurrence.id));

    return null;
  }

  // 3. Calculate next due date
  const nextDueAt = calculateNextOccurrence({
    rruleStr: recurrence.rrule,
    mode: recurrence.mode as "fixed" | "after_completion",
    timezone: recurrence.timezone,
    dtstart: recurrence.dtstart,
    referenceDueAt: task.dueAt,
    allDay: Boolean(task.allDay),
    now,
  });

  // Check termination: no more occurrences or past 'until'
  if (!nextDueAt || (recurrence.until && nextDueAt.getTime() > recurrence.until.getTime())) {
    await executor
      .update(schema.recurrences)
      .set({
        completedCount: nextCompletedCount,
        active: false,
        version: sql`${schema.recurrences.version} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.recurrences.id, recurrence.id));

    return null;
  }

  // Update recurrence completedCount
  await executor
    .update(schema.recurrences)
    .set({
      completedCount: nextCompletedCount,
      version: sql`${schema.recurrences.version} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.recurrences.id, recurrence.id));

  // 4. Calculate next startAt and deadlineAt preserving duration
  let nextStartAt: Date | null = null;
  if (task.startAt && task.dueAt) {
    const durationMs = task.dueAt.getTime() - task.startAt.getTime();
    nextStartAt = new Date(nextDueAt.getTime() - durationMs);
    if (task.allDay) nextStartAt = toUtcMidnight(nextStartAt);
  }

  let nextDeadlineAt: Date | null = null;
  if (task.deadlineAt && task.dueAt) {
    const deadlineDeltaMs = task.deadlineAt.getTime() - task.dueAt.getTime();
    nextDeadlineAt = new Date(nextDueAt.getTime() + deadlineDeltaMs);
    if (task.allDay) nextDeadlineAt = toUtcMidnight(nextDeadlineAt);
  }

  // 5. Position for cloned task
  const newPosition = await positionBetween(
    {
      table: schema.tasks,
      where: and(
        eq(schema.tasks.userId, userId),
        eq(schema.tasks.listId, task.listId),
        isNull(schema.tasks.parentId),
        isNull(schema.tasks.deletedAt)
      ),
    },
    task.id,
    null
  );

  const newTaskId = Bun.randomUUIDv7();

  // 6. Insert cloned root task
  const [clonedTask] = await executor
    .insert(schema.tasks)
    .values({
      id: newTaskId,
      userId,
      listId: task.listId,
      sectionId: task.sectionId,
      parentId: null,
      title: task.title,
      notes: task.notes,
      status: "todo",
      priority: task.priority,
      position: newPosition,
      startAt: nextStartAt,
      dueAt: nextDueAt,
      deadlineAt: nextDeadlineAt,
      allDay: task.allDay,
      estimateMin: task.estimateMin,
      recurrenceId: recurrence.id,
      placeId: task.placeId,
      locationName: task.locationName,
      lat: task.lat,
      lng: task.lng,
      radiusM: task.radiusM,
      locationTrigger: task.locationTrigger,
      completedAt: null,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  // 7. Copy tags
  const originalTags = await executor
    .select()
    .from(schema.taskTags)
    .where(eq(schema.taskTags.taskId, taskId));

  if (originalTags.length > 0) {
    await executor.insert(schema.taskTags).values(
      originalTags.map((t: any) => ({
        taskId: newTaskId,
        tagId: t.tagId,
      }))
    );
  }

  // 8. Copy checklist items (reset done = false)
  const originalChecklist = await executor
    .select()
    .from(schema.checklistItems)
    .where(
      and(
        eq(schema.checklistItems.taskId, taskId),
        eq(schema.checklistItems.userId, userId),
        isNull(schema.checklistItems.deletedAt)
      )
    );

  if (originalChecklist.length > 0) {
    await executor.insert(schema.checklistItems).values(
      originalChecklist.map((c: any) => ({
        id: Bun.randomUUIDv7(),
        userId,
        taskId: newTaskId,
        text: c.text,
        done: false,
        position: c.position,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }))
    );
  }

  // 9. Copy relative reminders
  const originalReminders = await executor
    .select()
    .from(schema.reminders)
    .where(
      and(
        eq(schema.reminders.taskId, taskId),
        eq(schema.reminders.userId, userId),
        eq(schema.reminders.kind, "relative"),
        isNull(schema.reminders.deletedAt)
      )
    );

  if (originalReminders.length > 0) {
    const [userInfo] = await executor
      .select({ timezone: schema.users.timezone, preferences: schema.users.preferences })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    const userTimezone = userInfo?.timezone || recurrence.timezone || "UTC";
    const defaultReminderTime = userInfo?.preferences?.defaultReminderTime || "09:00";

    for (const r of originalReminders) {
      let anchorDate: Date | null = null;
      if (r.relativeTo === "due") anchorDate = nextDueAt;
      else if (r.relativeTo === "start") anchorDate = nextStartAt;
      else if (r.relativeTo === "deadline") anchorDate = nextDeadlineAt;

      const { remindAt, firedAt } = calculateRelativeRemindAt({
        anchorDate,
        offsetMin: r.offsetMin ?? 0,
        allDay: Boolean(clonedTask.allDay),
        userTimezone,
        defaultReminderTime,
        now,
      });

      await executor.insert(schema.reminders).values({
        id: Bun.randomUUIDv7(),
        userId,
        taskId: newTaskId,
        kind: "relative",
        relativeTo: r.relativeTo,
        offsetMin: r.offsetMin,
        remindAt,
        firedAt,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  // 10. Copy subtasks (depth <= 3, reset status = "todo")
  const originalSubtasks = await executor
    .select()
    .from(schema.tasks)
    .where(
      and(
        eq(schema.tasks.parentId, taskId),
        eq(schema.tasks.userId, userId),
        isNull(schema.tasks.deletedAt)
      )
    )
    .orderBy(asc(schema.tasks.position));

  for (const st of originalSubtasks) {
    const newSubtaskId = Bun.randomUUIDv7();
    await executor.insert(schema.tasks).values({
      id: newSubtaskId,
      userId,
      listId: clonedTask.listId,
      sectionId: clonedTask.sectionId,
      parentId: newTaskId,
      title: st.title,
      notes: st.notes,
      status: "todo",
      priority: st.priority,
      position: st.position,
      startAt: st.startAt,
      dueAt: st.dueAt,
      deadlineAt: st.deadlineAt,
      allDay: st.allDay,
      estimateMin: st.estimateMin,
      recurrenceId: null,
      placeId: st.placeId,
      locationName: st.locationName,
      lat: st.lat,
      lng: st.lng,
      radiusM: st.radiusM,
      locationTrigger: st.locationTrigger,
      completedAt: null,
      archivedAt: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
  }

  return clonedTask;
}
