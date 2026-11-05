import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { dayBounds, resolveTimezone } from "../utils/dates";
import { DateTime } from "luxon";

export interface CapacitySummary {
  workMin: number;
  scheduledMin: number;
  estimatedMin: number;
}

export function validateBlockTimes(
  startAt: Date,
  endAt: Date,
  tz: string
): { valid: true } | { valid: false; error: string } {
  const durationMs = endAt.getTime() - startAt.getTime();
  const min5Ms = 5 * 60 * 1000;
  const max12hMs = 12 * 60 * 60 * 1000;

  if (durationMs < min5Ms || durationMs > max12hMs) {
    return {
      valid: false,
      error: "Block duration must be between 5 minutes and 12 hours",
    };
  }

  // 5-minute increments check (in user's timezone, not process/UTC time)
  const startLocalDt = DateTime.fromJSDate(startAt, { zone: tz });
  const endLocalDt = DateTime.fromJSDate(endAt, { zone: tz });
  if (
    startLocalDt.minute % 5 !== 0 ||
    endLocalDt.minute % 5 !== 0 ||
    startLocalDt.second !== 0 ||
    endLocalDt.second !== 0 ||
    startLocalDt.millisecond !== 0 ||
    endLocalDt.millisecond !== 0
  ) {
    return {
      valid: false,
      error: "Block start and end times must be aligned to 5-minute increments",
    };
  }

  // Midnight crossing check within user's local timezone
  const startLocal = DateTime.fromJSDate(startAt, { zone: tz }).toISODate();
  // Using endAt - 1ms allows ending exactly at midnight (local 24:00 / 00:00 next day)
  const endLocal = DateTime.fromJSDate(new Date(endAt.getTime() - 1), { zone: tz }).toISODate();

  if (startLocal !== endLocal) {
    return {
      valid: false,
      error: "Block must fall entirely within one local calendar day",
    };
  }

  return { valid: true };
}

export const plannerRoutes = new Elysia()
  .use(authMacro)
  // GET /api/v1/planner - daily planner capacity, time blocks, unscheduled tasks, and conflict detection
  .get(
    "/api/v1/planner",
    async ({ user, query, status }) => {
      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const dateInput = query.date || DateTime.now().setZone(tz).toISODate()!;
      const bounds = dayBounds(dateInput, tz);

      // Work hours from user preferences
      const [userRow] = await db
        .select({ preferences: schema.users.preferences })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      const workHours = (userRow?.preferences as any)?.workHours || "09:00-18:00";
      let workMin = 540; // default 9h

      const whMatch = workHours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
      if (whMatch) {
        const startH = parseInt(whMatch[1], 10);
        const startM = parseInt(whMatch[2], 10);
        const endH = parseInt(whMatch[3], 10);
        const endM = parseInt(whMatch[4], 10);
        workMin = Math.max(0, endH * 60 + endM - (startH * 60 + startM));
      }

      // Query blocks in range [startUtc, endUtc)
      const blocksSql = `
        SELECT
          tb.id,
          tb.user_id AS userId,
          tb.task_id AS taskId,
          tb.title,
          tb.start_at AS startAt,
          tb.end_at AS endAt,
          tb.color,
          tb.created_at AS createdAt,
          tb.updated_at AS updatedAt,
          t.title AS taskTitle,
          t.status AS taskStatus,
          t.priority AS taskPriority,
          t.estimate_min AS taskEstimateMin,
          t.list_id AS taskListId,
          l.color AS listColor
        FROM time_blocks tb
        LEFT JOIN tasks t ON t.id = tb.task_id
        LEFT JOIN lists l ON l.id = t.list_id
        WHERE tb.user_id = ?
          AND tb.deleted_at IS NULL
          AND tb.start_at >= ?
          AND tb.start_at < ?
          AND (tb.task_id IS NULL OR t.deleted_at IS NULL)
        ORDER BY tb.start_at ASC
      `;

      const rawBlocks = sqlite.query(blocksSql).all(
        user.id,
        bounds.startUtc.getTime(),
        bounds.endUtc.getTime()
      ) as any[];

      const blocks = rawBlocks.map((b) => ({
        id: b.id,
        userId: b.userId,
        taskId: b.taskId || null,
        title: b.title || b.taskTitle || "Time Block",
        startAt: new Date(b.startAt).toISOString(),
        endAt: new Date(b.endAt).toISOString(),
        color: b.color || b.listColor || null,
        createdAt: new Date(b.createdAt).toISOString(),
        updatedAt: new Date(b.updatedAt).toISOString(),
        task: b.taskId
          ? {
              id: b.taskId,
              title: b.taskTitle,
              status: b.taskStatus,
              priority: Number(b.taskPriority) || 0,
              estimateMin: b.taskEstimateMin !== null ? Number(b.taskEstimateMin) : null,
              listId: b.taskListId,
            }
          : null,
      }));

      // Scheduled minutes rollup
      let scheduledMin = 0;
      let scheduledTasksEstimateMin = 0;

      for (const b of rawBlocks) {
        const durMin = Math.round((b.endAt - b.startAt) / (1000 * 60));
        scheduledMin += durMin;
        if (b.taskEstimateMin !== null && b.taskEstimateMin !== undefined) {
          scheduledTasksEstimateMin += Number(b.taskEstimateMin);
        } else {
          scheduledTasksEstimateMin += durMin;
        }
      }

      // Overlap / Conflict detection: compare all block pairs
      const conflicts: [string, string][] = [];
      for (let i = 0; i < rawBlocks.length; i++) {
        for (let j = i + 1; j < rawBlocks.length; j++) {
          const b1 = rawBlocks[i];
          const b2 = rawBlocks[j];
          if (b1.endAt > b2.startAt && b1.startAt < b2.endAt) {
            conflicts.push([b1.id, b2.id]);
          }
        }
      }

      // Query unscheduled tasks for this day (active tasks due/start on this day without a block)
      const scheduledTaskIds = new Set(rawBlocks.map((b) => b.taskId).filter(Boolean));

      const unscheduledSql = `
        SELECT
          t.id,
          t.user_id AS userId,
          t.list_id AS listId,
          t.title,
          t.status,
          t.priority,
          t.start_at AS startAt,
          t.due_at AS dueAt,
          t.all_day AS allDay,
          t.estimate_min AS estimateMin,
          l.name AS listName,
          l.color AS listColor,
          COALESCE(st.done_count, 0) AS subtaskDone,
          COALESCE(st.total_count, 0) AS subtaskTotal
        FROM tasks t
        LEFT JOIN lists l ON l.id = t.list_id
        LEFT JOIN (
          SELECT
            parent_id,
            COUNT(CASE WHEN status = 'done' THEN 1 END) AS done_count,
            COUNT(*) AS total_count
          FROM tasks
          WHERE deleted_at IS NULL AND parent_id IS NOT NULL
          GROUP BY parent_id
        ) st ON st.parent_id = t.id
        WHERE t.user_id = ?
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND t.status IN ('todo', 'in_progress')
          AND NOT EXISTS (SELECT 1 FROM lists l2 WHERE l2.id = t.list_id AND l2.archived_at IS NOT NULL)
          AND (
            (t.due_at IS NOT NULL AND ((t.all_day = 0 AND t.due_at >= ? AND t.due_at < ?) OR (t.all_day = 1 AND t.due_at >= ? AND t.due_at < ?)))
            OR (t.due_at IS NULL AND t.start_at IS NOT NULL AND ((t.all_day = 0 AND t.start_at >= ? AND t.start_at < ?) OR (t.all_day = 1 AND t.start_at >= ? AND t.start_at < ?)))
          )
        ORDER BY t.priority DESC, t.position ASC
      `;

      const rawUnscheduled = sqlite.query(unscheduledSql).all(
        user.id,
        bounds.startUtc.getTime(),
        bounds.endUtc.getTime(),
        bounds.floatStart.getTime(),
        bounds.floatEnd.getTime(),
        bounds.startUtc.getTime(),
        bounds.endUtc.getTime(),
        bounds.floatStart.getTime(),
        bounds.floatEnd.getTime()
      ) as any[];

      const unscheduled = rawUnscheduled
        .filter((t) => !scheduledTaskIds.has(t.id))
        .map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: Number(t.priority) || 0,
          dueAt: t.dueAt ? new Date(t.dueAt).toISOString() : null,
          startAt: t.startAt ? new Date(t.startAt).toISOString() : null,
          allDay: Boolean(t.allDay),
          estimateMin: t.estimateMin !== null && t.estimateMin !== undefined ? Number(t.estimateMin) : null,
          listName: t.listName || null,
          listColor: t.listColor || null,
          subtaskDone: Number(t.subtaskDone) || 0,
          subtaskTotal: Number(t.subtaskTotal) || 0,
        }));

      let unscheduledEstimateMin = 0;
      for (const u of unscheduled) {
        unscheduledEstimateMin += u.estimateMin || 30; // default 30 min if not estimated
      }

      const estimatedMin = scheduledTasksEstimateMin + unscheduledEstimateMin;

      const capacity: CapacitySummary = {
        workMin,
        scheduledMin,
        estimatedMin,
      };

      return {
        date: bounds.localDate,
        workHours,
        blocks,
        unscheduled,
        capacity,
        conflicts,
      };
    },
    {
      auth: true,
      query: t.Object({
        date: t.Optional(t.String()),
        tz: t.Optional(t.String()),
      }),
    }
  )
  // POST /api/v1/time-blocks - create a time block
  .post(
    "/api/v1/time-blocks",
    async ({ user, body, query, status }) => {
      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const startAt = new Date(body.startAt);
      const endAt = new Date(body.endAt);

      if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
        return status(422, { error: "Invalid date format for startAt or endAt" });
      }

      const validation = validateBlockTimes(startAt, endAt, tz);
      if (!validation.valid) {
        return status(422, { error: validation.error });
      }

      // If taskId provided, verify task exists and belongs to user
      let taskTitle: string | null = null;
      if (body.taskId) {
        const [task] = await db
          .select({ id: schema.tasks.id, title: schema.tasks.title })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.id, body.taskId),
              eq(schema.tasks.userId, user.id),
              isNull(schema.tasks.deletedAt)
            )
          );
        if (!task) {
          return status(404, { error: "Task not found" });
        }
        taskTitle = task.title;
      }

      const [newBlock] = await db
        .insert(schema.timeBlocks)
        .values({
          userId: user.id,
          taskId: body.taskId || null,
          title: body.title || taskTitle || null,
          startAt,
          endAt,
          color: body.color || null,
        })
        .returning();

      return status(201, newBlock);
    },
    {
      auth: true,
      body: t.Object({
        taskId: t.Optional(t.String()),
        title: t.Optional(t.String()),
        startAt: t.String(),
        endAt: t.String(),
        color: t.Optional(t.String()),
      }),
      query: t.Object({
        tz: t.Optional(t.String()),
      }),
    }
  )
  // PATCH /api/v1/time-blocks/:id - update a time block
  .patch(
    "/api/v1/time-blocks/:id",
    async ({ user, params: { id }, body, query, status }) => {
      const tz = resolveTimezone(query.tz || (user as any).timezone);

      const [existing] = await db
        .select()
        .from(schema.timeBlocks)
        .where(
          and(
            eq(schema.timeBlocks.id, id),
            eq(schema.timeBlocks.userId, user.id),
            isNull(schema.timeBlocks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Time block not found" });
      }

      const startAt = body.startAt ? new Date(body.startAt) : existing.startAt;
      const endAt = body.endAt ? new Date(body.endAt) : existing.endAt;

      if (body.startAt || body.endAt) {
        if (isNaN(startAt.getTime()) || isNaN(endAt.getTime())) {
          return status(422, { error: "Invalid date format for startAt or endAt" });
        }
        const validation = validateBlockTimes(startAt, endAt, tz);
        if (!validation.valid) {
          return status(422, { error: validation.error });
        }
      }

      const updates: Record<string, any> = {
        updatedAt: new Date(),
        version: sql`${schema.timeBlocks.version} + 1`,
      };

      if (body.title !== undefined) updates.title = body.title;
      if (body.color !== undefined) updates.color = body.color;
      if (body.startAt !== undefined) updates.startAt = startAt;
      if (body.endAt !== undefined) updates.endAt = endAt;
      if (body.taskId !== undefined) updates.taskId = body.taskId;

      const [updated] = await db
        .update(schema.timeBlocks)
        .set(updates)
        .where(
          and(
            eq(schema.timeBlocks.id, id),
            eq(schema.timeBlocks.userId, user.id)
          )
        )
        .returning();

      return updated;
    },
    {
      auth: true,
      body: t.Object({
        taskId: t.Optional(t.Nullable(t.String())),
        title: t.Optional(t.Nullable(t.String())),
        startAt: t.Optional(t.String()),
        endAt: t.Optional(t.String()),
        color: t.Optional(t.Nullable(t.String())),
      }),
      query: t.Object({
        tz: t.Optional(t.String()),
      }),
    }
  )
  // DELETE /api/v1/time-blocks/:id - delete time block
  .delete(
    "/api/v1/time-blocks/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.timeBlocks)
        .where(
          and(
            eq(schema.timeBlocks.id, id),
            eq(schema.timeBlocks.userId, user.id),
            isNull(schema.timeBlocks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Time block not found" });
      }

      await db
        .update(schema.timeBlocks)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.timeBlocks.id, id),
            eq(schema.timeBlocks.userId, user.id)
          )
        );

      return { success: true };
    },
    { auth: true }
  )
  // POST /api/v1/planner/schedule - schedule a task into a time block
  .post(
    "/api/v1/planner/schedule",
    async ({ user, body, query, status }) => {
      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const startAt = new Date(body.start);

      if (isNaN(startAt.getTime())) {
        return status(422, { error: "Invalid start date format" });
      }

      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, body.taskId),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!task) {
        return status(404, { error: "Task not found" });
      }

      // Default duration is task estimateMin or 30 minutes
      const durationMin = task.estimateMin && task.estimateMin > 0 ? task.estimateMin : 30;
      const endAt = new Date(startAt.getTime() + durationMin * 60 * 1000);

      const validation = validateBlockTimes(startAt, endAt, tz);
      if (!validation.valid) {
        return status(422, { error: validation.error });
      }

      const [block] = await db
        .insert(schema.timeBlocks)
        .values({
          userId: user.id,
          taskId: task.id,
          title: task.title,
          startAt,
          endAt,
          color: null,
        })
        .returning();

      return status(201, block);
    },
    {
      auth: true,
      body: t.Object({
        taskId: t.String(),
        start: t.String(),
      }),
      query: t.Object({
        tz: t.Optional(t.String()),
      }),
    }
  );
