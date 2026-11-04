import { DateTime } from "luxon";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

export interface RecomputeOptions {
  task?: typeof schema.tasks.$inferSelect;
  tx?: any;
  now?: Date;
}

/**
 * Parses "HH:MM" into hour and minute numbers. Defaults to [9, 0].
 */
export function parseTime(timeStr?: string | null): [number, number] {
  if (!timeStr) return [9, 0];
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return [isNaN(h) ? 9 : h, isNaN(m) ? 0 : m];
}

/**
 * Calculates resolved fire time for a relative reminder.
 */
export function calculateRelativeRemindAt(params: {
  anchorDate: Date | null;
  offsetMin: number;
  allDay: boolean;
  userTimezone: string;
  defaultReminderTime: string;
  now?: Date;
}): { remindAt: Date; firedAt: Date | null } {
  const { anchorDate, offsetMin, allDay, userTimezone, defaultReminderTime } = params;
  const now = params.now ?? new Date();

  if (!anchorDate) {
    // Missing anchor: set remindAt = 0 (inactive), firedAt = null
    return { remindAt: new Date(0), firedAt: null };
  }

  let anchorInstant: Date;

  if (allDay) {
    // All-day anchors: anchor timestamp is the calendar date at user's defaultReminderTime in user's timezone
    const [hour, minute] = parseTime(defaultReminderTime);
    const dt = DateTime.fromObject(
      {
        year: anchorDate.getUTCFullYear(),
        month: anchorDate.getUTCMonth() + 1,
        day: anchorDate.getUTCDate(),
        hour,
        minute,
        second: 0,
        millisecond: 0,
      },
      { zone: userTimezone }
    );
    anchorInstant = dt.toJSDate();
  } else {
    anchorInstant = anchorDate;
  }

  const resolvedTime = new Date(anchorInstant.getTime() + offsetMin * 60 * 1000);

  if (resolvedTime.getTime() > now.getTime()) {
    return { remindAt: resolvedTime, firedAt: null };
  } else {
    // In the past -> firedAt = now (prevents late firing)
    return { remindAt: resolvedTime, firedAt: now };
  }
}

/**
 * Resolves snooze target time from preset or custom timestamp.
 */
export function resolveSnoozeTarget(
  input: string | number,
  userTimezone = "UTC",
  defaultReminderTime = "09:00",
  now = new Date()
): Date {
  if (typeof input === "string") {
    switch (input) {
      case "10m":
        return new Date(now.getTime() + 10 * 60 * 1000);
      case "1h":
        return new Date(now.getTime() + 60 * 60 * 1000);
      case "3h":
        return new Date(now.getTime() + 3 * 60 * 60 * 1000);
      case "tomorrow_9am": {
        const [hour, minute] = parseTime(defaultReminderTime);
        const tomorrow = DateTime.fromJSDate(now)
          .setZone(userTimezone)
          .plus({ days: 1 })
          .set({ hour, minute, second: 0, millisecond: 0 });
        return tomorrow.toJSDate();
      }
      default: {
        const d = new Date(input);
        if (isNaN(d.getTime())) {
          throw new Error("Invalid snooze time format");
        }
        return d;
      }
    }
  }

  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error("Invalid snooze timestamp");
  }
  return d;
}

/**
 * Recomputes all relative reminders for a task when task dates change.
 * Can run inside a provided database transaction.
 */
export async function recomputeTaskReminders(
  taskId: string,
  userId: string,
  options?: RecomputeOptions
): Promise<void> {
  const executor = options?.tx ?? db;
  const now = options?.now ?? new Date();

  // 1. Fetch task if not provided
  let task = options?.task;
  if (!task) {
    const [found] = await executor
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, userId)));
    task = found;
  }
  if (!task) return;

  // 2. Fetch user timezone and preferences
  const [user] = await executor
    .select({ timezone: schema.users.timezone, preferences: schema.users.preferences })
    .from(schema.users)
    .where(eq(schema.users.id, userId));

  const userTimezone = user?.timezone || "UTC";
  const defaultReminderTime = user?.preferences?.defaultReminderTime || "09:00";

  // 3. Fetch all active relative reminders for this task
  const relativeReminders = await executor
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

  if (relativeReminders.length === 0) return;

  // 4. Update each reminder based on new task dates
  for (const reminder of relativeReminders) {
    let anchorDate: Date | null = null;
    if (reminder.relativeTo === "due") anchorDate = task.dueAt;
    else if (reminder.relativeTo === "start") anchorDate = task.startAt;
    else if (reminder.relativeTo === "deadline") anchorDate = task.deadlineAt;

    const { remindAt, firedAt } = calculateRelativeRemindAt({
      anchorDate,
      offsetMin: reminder.offsetMin ?? 0,
      allDay: Boolean(task.allDay),
      userTimezone,
      defaultReminderTime,
      now,
    });

    await executor
      .update(schema.reminders)
      .set({
        remindAt,
        firedAt,
        version: sql`${schema.reminders.version} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.reminders.id, reminder.id));
  }
}

/**
 * Fires (dismisses) all pending reminders when a task is completed.
 */
export async function firePendingTaskReminders(
  taskId: string,
  userId: string,
  tx?: any
): Promise<void> {
  const executor = tx ?? db;
  const now = new Date();

  await executor
    .update(schema.reminders)
    .set({
      firedAt: now,
      version: sql`${schema.reminders.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(schema.reminders.taskId, taskId),
        eq(schema.reminders.userId, userId),
        isNull(schema.reminders.firedAt),
        isNull(schema.reminders.deletedAt)
      )
    );
}
