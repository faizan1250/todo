import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import {
  calculateRelativeRemindAt,
  resolveSnoozeTarget,
  parseTime,
} from "../services/reminders";
import { nudge } from "../utils/notify-scheduler";

export const reminderRoutes = new Elysia()
  .use(authMacro)
  // GET /api/v1/tasks/:id/reminders - get all active reminders for a task
  .get(
    "/api/v1/tasks/:id/reminders",
    async ({ user, params: { id }, status }) => {
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!task) {
        return status(404, { error: "Task not found" });
      }

      const taskReminders = await db
        .select()
        .from(schema.reminders)
        .where(
          and(
            eq(schema.reminders.taskId, id),
            eq(schema.reminders.userId, user.id),
            isNull(schema.reminders.deletedAt)
          )
        )
        .orderBy(asc(schema.reminders.remindAt), asc(schema.reminders.createdAt));

      return taskReminders;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /api/v1/tasks/:id/reminders - add a reminder to a task
  .post(
    "/api/v1/tasks/:id/reminders",
    async ({ user, params: { id }, body, status }) => {
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!task) {
        return status(404, { error: "Task not found" });
      }

      // Check 10 reminders per task cap
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.reminders)
        .where(
          and(
            eq(schema.reminders.taskId, id),
            eq(schema.reminders.userId, user.id),
            isNull(schema.reminders.deletedAt)
          )
        );

      if ((countResult?.count ?? 0) >= 10) {
        return status(400, { error: "Maximum of 10 reminders per task reached" });
      }

      const now = new Date();
      let finalRemindAt: Date;
      let finalFiredAt: Date | null = null;
      const kind = body.kind;

      if (kind === "absolute") {
        if (!body.remindAt) {
          return status(400, { error: "remindAt is required for absolute reminders" });
        }
        const parsed = new Date(body.remindAt);
        if (isNaN(parsed.getTime())) {
          return status(400, { error: "Invalid remindAt timestamp" });
        }
        if (parsed.getTime() <= now.getTime()) {
          return status(400, { error: "Absolute reminder must be in the future" });
        }
        finalRemindAt = parsed;
        finalFiredAt = null;
      } else {
        // relative
        const relativeTo = body.relativeTo ?? "due";
        const offsetMin = body.offsetMin ?? 0;

        const [userInfo] = await db
          .select({ timezone: schema.users.timezone, preferences: schema.users.preferences })
          .from(schema.users)
          .where(eq(schema.users.id, user.id));

        const userTimezone = userInfo?.timezone || "UTC";
        const defaultReminderTime = userInfo?.preferences?.defaultReminderTime || "09:00";

        let anchorDate: Date | null = null;
        if (relativeTo === "due") anchorDate = task.dueAt;
        else if (relativeTo === "start") anchorDate = task.startAt;
        else if (relativeTo === "deadline") anchorDate = task.deadlineAt;

        const res = calculateRelativeRemindAt({
          anchorDate,
          offsetMin,
          allDay: Boolean(task.allDay),
          userTimezone,
          defaultReminderTime,
          now,
        });

        finalRemindAt = res.remindAt;
        finalFiredAt = res.firedAt;
      }

      const [newReminder] = await db
        .insert(schema.reminders)
        .values({
          userId: user.id,
          taskId: id,
          kind,
          relativeTo: kind === "relative" ? (body.relativeTo ?? "due") : null,
          offsetMin: kind === "relative" ? (body.offsetMin ?? 0) : null,
          remindAt: finalRemindAt,
          firedAt: finalFiredAt,
          version: 1,
        })
        .returning();

      // Prompt scheduler: a reminder landing within the next minute should
      // fire without waiting for the next 30s tick.
      nudge();
      return status(201, newReminder);
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        kind: t.Union([t.Literal("absolute"), t.Literal("relative")]),
        remindAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        relativeTo: t.Optional(
          t.Union([t.Literal("due"), t.Literal("start"), t.Literal("deadline"), t.Null()])
        ),
        offsetMin: t.Optional(t.Union([t.Integer(), t.Null()])),
      }),
    }
  )
  // PATCH /api/v1/reminders/:id - update a reminder
  .patch(
    "/api/v1/reminders/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.reminders)
        .where(
          and(
            eq(schema.reminders.id, id),
            eq(schema.reminders.userId, user.id),
            isNull(schema.reminders.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Reminder not found" });
      }

      const now = new Date();
      const nextKind = body.kind ?? existing.kind;
      let nextRemindAt = existing.remindAt;
      let nextFiredAt = existing.firedAt;
      let nextRelativeTo = existing.relativeTo;
      let nextOffsetMin = existing.offsetMin;

      if (nextKind === "absolute") {
        if (body.remindAt !== undefined) {
          if (!body.remindAt) {
            return status(400, { error: "remindAt is required for absolute reminders" });
          }
          const parsed = new Date(body.remindAt);
          if (isNaN(parsed.getTime())) {
            return status(400, { error: "Invalid remindAt timestamp" });
          }
          if (parsed.getTime() <= now.getTime()) {
            return status(400, { error: "Absolute reminder must be in the future" });
          }
          nextRemindAt = parsed;
          nextFiredAt = null;
        }
        nextRelativeTo = null;
        nextOffsetMin = null;
      } else {
        // relative
        nextRelativeTo = body.relativeTo !== undefined ? body.relativeTo : existing.relativeTo;
        nextOffsetMin = body.offsetMin !== undefined ? body.offsetMin : existing.offsetMin;

        const [task] = await db
          .select()
          .from(schema.tasks)
          .where(eq(schema.tasks.id, existing.taskId));

        if (!task) {
          return status(404, { error: "Associated task not found" });
        }

        const [userInfo] = await db
          .select({ timezone: schema.users.timezone, preferences: schema.users.preferences })
          .from(schema.users)
          .where(eq(schema.users.id, user.id));

        const userTimezone = userInfo?.timezone || "UTC";
        const defaultReminderTime = userInfo?.preferences?.defaultReminderTime || "09:00";

        let anchorDate: Date | null = null;
        if (nextRelativeTo === "due") anchorDate = task.dueAt;
        else if (nextRelativeTo === "start") anchorDate = task.startAt;
        else if (nextRelativeTo === "deadline") anchorDate = task.deadlineAt;

        const res = calculateRelativeRemindAt({
          anchorDate,
          offsetMin: nextOffsetMin ?? 0,
          allDay: Boolean(task.allDay),
          userTimezone,
          defaultReminderTime,
          now,
        });

        nextRemindAt = res.remindAt;
        nextFiredAt = res.firedAt;
      }

      const [updated] = await db
        .update(schema.reminders)
        .set({
          kind: nextKind,
          relativeTo: nextRelativeTo,
          offsetMin: nextOffsetMin,
          remindAt: nextRemindAt,
          firedAt: nextFiredAt,
          version: sql`${schema.reminders.version} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.reminders.id, id))
        .returning();

      nudge();
      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        kind: t.Optional(t.Union([t.Literal("absolute"), t.Literal("relative")])),
        remindAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        relativeTo: t.Optional(
          t.Union([t.Literal("due"), t.Literal("start"), t.Literal("deadline"), t.Null()])
        ),
        offsetMin: t.Optional(t.Union([t.Integer(), t.Null()])),
      }),
    }
  )
  // DELETE /api/v1/reminders/:id - soft delete a reminder
  .delete(
    "/api/v1/reminders/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.reminders)
        .where(
          and(
            eq(schema.reminders.id, id),
            eq(schema.reminders.userId, user.id),
            isNull(schema.reminders.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Reminder not found" });
      }

      const now = new Date();
      await db
        .update(schema.reminders)
        .set({
          deletedAt: now,
          updatedAt: now,
          version: sql`${schema.reminders.version} + 1`,
        })
        .where(eq(schema.reminders.id, id));

      return { success: true };
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /api/v1/reminders/:id/snooze - snooze reminder with preset or custom timestamp
  .post(
    "/api/v1/reminders/:id/snooze",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.reminders)
        .where(
          and(
            eq(schema.reminders.id, id),
            eq(schema.reminders.userId, user.id),
            isNull(schema.reminders.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Reminder not found" });
      }

      const [userInfo] = await db
        .select({ timezone: schema.users.timezone, preferences: schema.users.preferences })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      const userTimezone = userInfo?.timezone || "UTC";
      const defaultReminderTime = userInfo?.preferences?.defaultReminderTime || "09:00";
      const now = new Date();

      const input = (body as any)?.preset || (body as any)?.time || (body as any)?.snoozeUntil;
      if (!input) {
        return status(400, { error: "preset or time is required to snooze" });
      }

      let targetTime: Date;
      try {
        targetTime = resolveSnoozeTarget(input, userTimezone, defaultReminderTime, now);
      } catch (err: any) {
        return status(400, { error: err.message });
      }

      if (targetTime.getTime() <= now.getTime()) {
        return status(400, { error: "Snooze time must be in the future" });
      }

      const [updated] = await db
        .update(schema.reminders)
        .set({
          remindAt: targetTime,
          firedAt: null,
          version: sql`${schema.reminders.version} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.reminders.id, id))
        .returning();

      nudge();
      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Optional(
        t.Object({
          preset: t.Optional(
            t.Union([
              t.Literal("10m"),
              t.Literal("1h"),
              t.Literal("3h"),
              t.Literal("tomorrow_9am"),
            ])
          ),
          time: t.Optional(t.Union([t.String(), t.Integer()])),
          snoozeUntil: t.Optional(t.Union([t.String(), t.Integer()])),
        })
      ),
    }
  )
  // POST /api/v1/reminders/:id/dismiss - dismiss reminder (marks firedAt = new Date())
  .post(
    "/api/v1/reminders/:id/dismiss",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.reminders)
        .where(
          and(
            eq(schema.reminders.id, id),
            eq(schema.reminders.userId, user.id),
            isNull(schema.reminders.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Reminder not found" });
      }

      const now = new Date();
      const [updated] = await db
        .update(schema.reminders)
        .set({
          firedAt: now,
          version: sql`${schema.reminders.version} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.reminders.id, id))
        .returning();

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  );
