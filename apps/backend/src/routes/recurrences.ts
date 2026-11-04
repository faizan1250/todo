import { Elysia, t } from "elysia";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import {
  validateRecurrenceRule,
  calculateNextOccurrence,
} from "../services/recurrence";
import { recomputeTaskReminders } from "../services/reminders";

export const recurrenceRoutes = new Elysia()
  .use(authMacro)
  // PUT /api/v1/tasks/:id/recurrence - attach or update recurrence rule on a task
  .put(
    "/api/v1/tasks/:id/recurrence",
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

      const mode = body.mode ?? "fixed";
      const validation = validateRecurrenceRule(body.rrule, mode, body.maxCount);
      if (!validation.valid) {
        return status(400, { error: validation.error });
      }

      const [userInfo] = await db
        .select({ timezone: schema.users.timezone })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      const timezone = body.timezone || userInfo?.timezone || "UTC";
      const dtstart = body.dtstart
        ? new Date(body.dtstart)
        : task.dueAt || task.startAt || new Date();
      const until = body.until ? new Date(body.until) : null;
      const maxCount = body.maxCount ?? null;

      const now = new Date();

      const { recurrence, updatedTask } = await db.transaction(async (tx) => {
        let recId = task.recurrenceId;
        let savedRecurrence: typeof schema.recurrences.$inferSelect;

        if (recId) {
          const [updated] = await tx
            .update(schema.recurrences)
            .set({
              rrule: body.rrule,
              mode,
              timezone,
              dtstart,
              until,
              maxCount,
              active: true,
              version: sql`${schema.recurrences.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.recurrences.id, recId),
                eq(schema.recurrences.userId, user.id)
              )
            )
            .returning();
          savedRecurrence = updated;
        } else {
          recId = Bun.randomUUIDv7();
          const [created] = await tx
            .insert(schema.recurrences)
            .values({
              id: recId,
              userId: user.id,
              rrule: body.rrule,
              mode,
              timezone,
              dtstart,
              until,
              maxCount,
              completedCount: 0,
              active: true,
              version: 1,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
          savedRecurrence = created;
        }

        const [tUpdated] = await tx
          .update(schema.tasks)
          .set({
            recurrenceId: recId,
            version: sql`${schema.tasks.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.tasks.id, id),
              eq(schema.tasks.userId, user.id)
            )
          )
          .returning();

        return { recurrence: savedRecurrence, updatedTask: tUpdated };
      });

      return { task: updatedTask, recurrence };
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        rrule: t.String({ minLength: 1 }),
        mode: t.Optional(t.Union([t.Literal("fixed"), t.Literal("after_completion")])),
        timezone: t.Optional(t.String()),
        dtstart: t.Optional(t.Union([t.String(), t.Integer()])),
        until: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        maxCount: t.Optional(t.Union([t.Integer(), t.Null()])),
      }),
    }
  )
  // DELETE /api/v1/tasks/:id/recurrence - detach recurrence rule from task
  .delete(
    "/api/v1/tasks/:id/recurrence",
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

      if (!task.recurrenceId) {
        return { success: true };
      }

      const recId = task.recurrenceId;
      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(schema.tasks)
          .set({
            recurrenceId: null,
            version: sql`${schema.tasks.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.tasks.id, id),
              eq(schema.tasks.userId, user.id)
            )
          );

        // Deactivate recurrence series
        await tx
          .update(schema.recurrences)
          .set({
            active: false,
            version: sql`${schema.recurrences.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.recurrences.id, recId),
              eq(schema.recurrences.userId, user.id)
            )
          );
      });

      return { success: true };
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // PATCH /api/v1/recurrences/:id - edit rule, recomputes open instance's due date
  .patch(
    "/api/v1/recurrences/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.recurrences)
        .where(
          and(
            eq(schema.recurrences.id, id),
            eq(schema.recurrences.userId, user.id),
            isNull(schema.recurrences.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Recurrence not found" });
      }

      const nextRrule = body.rrule ?? existing.rrule;
      const nextMode = body.mode ?? existing.mode;
      const nextMaxCount = body.maxCount !== undefined ? body.maxCount : existing.maxCount;

      const validation = validateRecurrenceRule(nextRrule, nextMode as any, nextMaxCount);
      if (!validation.valid) {
        return status(400, { error: validation.error });
      }

      const nextTimezone = body.timezone ?? existing.timezone;
      const nextUntil = body.until !== undefined ? (body.until ? new Date(body.until) : null) : existing.until;
      const nextDtstart = body.dtstart !== undefined ? new Date(body.dtstart) : existing.dtstart;
      const nextActive = body.active !== undefined ? body.active : existing.active;

      const now = new Date();

      const [updatedRecurrence] = await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(schema.recurrences)
          .set({
            rrule: nextRrule,
            mode: nextMode as any,
            timezone: nextTimezone,
            dtstart: nextDtstart,
            until: nextUntil,
            maxCount: nextMaxCount,
            active: nextActive,
            version: sql`${schema.recurrences.version} + 1`,
            updatedAt: now,
          })
          .where(eq(schema.recurrences.id, id))
          .returning();

        // Recompute open instance's due date
        const [openTask] = await tx
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.recurrenceId, id),
              eq(schema.tasks.userId, user.id),
              ne(schema.tasks.status, "done"),
              ne(schema.tasks.status, "cancelled"),
              isNull(schema.tasks.deletedAt)
            )
          );

        if (openTask) {
          const nextDueAt = calculateNextOccurrence({
            rruleStr: nextRrule,
            mode: nextMode as any,
            timezone: nextTimezone,
            dtstart: nextDtstart,
            referenceDueAt: null,
            allDay: Boolean(openTask.allDay),
            now,
          });

          if (nextDueAt) {
            const [tUpdated] = await tx
              .update(schema.tasks)
              .set({
                dueAt: nextDueAt,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: now,
              })
              .where(eq(schema.tasks.id, openTask.id))
              .returning();

            await recomputeTaskReminders(openTask.id, user.id, { task: tUpdated, tx, now });
          }
        }

        return [updated];
      });

      return updatedRecurrence;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        rrule: t.Optional(t.String()),
        mode: t.Optional(t.Union([t.Literal("fixed"), t.Literal("after_completion")])),
        timezone: t.Optional(t.String()),
        dtstart: t.Optional(t.Union([t.String(), t.Integer()])),
        until: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        maxCount: t.Optional(t.Union([t.Integer(), t.Null()])),
        active: t.Optional(t.Boolean()),
      }),
    }
  );
