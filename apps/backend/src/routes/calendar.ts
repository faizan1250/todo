import { Elysia, t } from "elysia";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { resolveTimezone, toUtcMidnight } from "../utils/dates";
import { rrulestr } from "rrule";
import { DateTime } from "luxon";

export interface CalendarItem {
  id: string;
  type: "task" | "block" | "virtual";
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string | null;
  priority: number;
  listId: string | null;
  color: string | null;
  virtual?: boolean;
  taskId?: string | null;
  recurrenceId?: string | null;
}

export const calendarRoutes = new Elysia({ prefix: "/api/v1/calendar" })
  .use(authMacro)
  // GET /api/v1/calendar - retrieve tasks, time blocks, and expanded virtual recurrences
  .get(
    "/",
    async ({ user, query, status }) => {
      const fromStr = query.from;
      const toStr = query.to;

      if (!fromStr || !toStr) {
        return status(422, {
          error: "Invalid date range",
          message: "Both 'from' and 'to' parameters are required",
        });
      }

      const fromDate = new Date(fromStr);
      const toDate = new Date(toStr);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        return status(422, {
          error: "Invalid date format",
          message: "'from' and 'to' must be valid ISO date strings",
        });
      }

      if (toDate < fromDate) {
        return status(422, {
          error: "Invalid date range",
          message: "'to' must be greater than or equal to 'from'",
        });
      }

      // Check max range 62 days
      const diffMs = toDate.getTime() - fromDate.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      if (diffDays > 62) {
        return status(422, {
          error: "Date range too large",
          message: "Date range cannot exceed 62 days",
        });
      }

      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const fromMs = fromDate.getTime();
      const toMs = toDate.getTime();
      const includeDone = query.include_done === "true";

      const items: CalendarItem[] = [];
      const concreteRecurrenceDates = new Set<string>(); // key: `${recurrenceId}:${dateStr}`

      // 1. Concrete Tasks
      const taskParams: any[] = [user.id, fromMs, toMs, fromMs, toMs, fromMs, toMs];
      let taskWhere = `
        WHERE t.user_id = ?
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM lists l2 WHERE l2.id = t.list_id AND l2.archived_at IS NOT NULL)
          AND (
            (t.due_at IS NOT NULL AND t.due_at >= ? AND t.due_at <= ?)
            OR (t.start_at IS NOT NULL AND t.start_at >= ? AND t.start_at <= ?)
            OR (t.start_at IS NOT NULL AND t.due_at IS NOT NULL AND t.start_at <= ? AND t.due_at >= ?)
          )
      `;

      if (!includeDone) {
        taskWhere += ` AND t.status NOT IN ('done', 'cancelled')`;
      }

      if (query.list_id) {
        taskWhere += ` AND t.list_id = ?`;
        taskParams.push(query.list_id);
      }

      const tasksSql = `
        SELECT
          t.id,
          t.title,
          t.start_at AS startAt,
          t.due_at AS dueAt,
          t.all_day AS allDay,
          t.status,
          t.priority,
          t.list_id AS listId,
          t.recurrence_id AS recurrenceId,
          l.color AS listColor
        FROM tasks t
        LEFT JOIN lists l ON l.id = t.list_id
        ${taskWhere}
        ORDER BY COALESCE(t.start_at, t.due_at) ASC
      `;

      const rawTasks = sqlite.query(tasksSql).all(...taskParams) as any[];

      for (const t of rawTasks) {
        const startAt = t.startAt ? new Date(t.startAt) : (t.dueAt ? new Date(t.dueAt) : fromDate);
        const dueAt = t.dueAt ? new Date(t.dueAt) : startAt;

        items.push({
          id: t.id,
          type: "task",
          title: t.title,
          start: startAt.toISOString(),
          end: dueAt.toISOString(),
          allDay: Boolean(t.allDay),
          status: t.status,
          priority: Number(t.priority) || 0,
          listId: t.listId,
          color: t.listColor || null,
          taskId: t.id,
          recurrenceId: t.recurrenceId || null,
        });

        if (t.recurrenceId) {
          const keyDate = Boolean(t.allDay)
            ? dueAt.toISOString().slice(0, 10)
            : dueAt.toISOString();
          concreteRecurrenceDates.add(`${t.recurrenceId}:${keyDate}`);
        }
      }

      // 2. Time Blocks
      const blockParams: any[] = [user.id, toMs, fromMs];
      let blockWhere = `
        WHERE tb.user_id = ?
          AND tb.deleted_at IS NULL
          AND tb.start_at < ?
          AND tb.end_at > ?
          AND (tb.task_id IS NULL OR t2.deleted_at IS NULL)
      `;

      if (query.list_id) {
        blockWhere += ` AND (t2.list_id = ? OR tb.task_id IS NULL)`;
        blockParams.push(query.list_id);
      }

      const blocksSql = `
        SELECT
          tb.id,
          tb.task_id AS taskId,
          tb.title AS blockTitle,
          tb.start_at AS startAt,
          tb.end_at AS endAt,
          tb.color AS blockColor,
          t2.title AS taskTitle,
          t2.status AS taskStatus,
          t2.priority AS taskPriority,
          t2.list_id AS taskListId,
          l2.color AS listColor
        FROM time_blocks tb
        LEFT JOIN tasks t2 ON t2.id = tb.task_id
        LEFT JOIN lists l2 ON l2.id = t2.list_id
        ${blockWhere}
        ORDER BY tb.start_at ASC
      `;

      const rawBlocks = sqlite.query(blocksSql).all(...blockParams) as any[];

      for (const b of rawBlocks) {
        const startAt = new Date(b.startAt);
        const endAt = new Date(b.endAt);

        items.push({
          id: b.id,
          type: "block",
          title: b.blockTitle || b.taskTitle || "Time Block",
          start: startAt.toISOString(),
          end: endAt.toISOString(),
          allDay: false,
          status: b.taskStatus || null,
          priority: Number(b.taskPriority) || 0,
          listId: b.taskListId || null,
          color: b.blockColor || b.listColor || null,
          taskId: b.taskId || null,
        });
      }

      // 3. Virtual Recurrences from Active RRULEs
      const recurrencesSql = `
        SELECT
          r.id,
          r.rrule,
          r.mode,
          r.max_count AS maxCount,
          r.until AS until,
          t.id AS sourceTaskId,
          t.title,
          t.priority,
          t.list_id AS listId,
          t.all_day AS allDay,
          t.start_at AS startAt,
          t.due_at AS dueAt,
          l.color AS listColor
        FROM recurrences r
        JOIN tasks t ON t.recurrence_id = r.id AND t.deleted_at IS NULL
        LEFT JOIN lists l ON l.id = t.list_id
        WHERE r.user_id = ?
          AND r.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM lists l2 WHERE l2.id = t.list_id AND l2.archived_at IS NOT NULL)
      `;

      const rawRecurrences = sqlite.query(recurrencesSql).all(user.id) as any[];

      for (const r of rawRecurrences) {
        try {
          const refDue = r.dueAt ? new Date(r.dueAt) : (r.startAt ? new Date(r.startAt) : new Date());
          const rule = rrulestr(r.rrule, { dtstart: refDue });
          const occurrences = rule.between(fromDate, toDate, true);

          let count = 0;
          for (const occ of occurrences) {
            if (count >= 50) break; // Cap at 50 per series

            const isAllDay = Boolean(r.allDay);
            const isoKey = isAllDay ? occ.toISOString().slice(0, 10) : occ.toISOString();
            const dedupKey = `${r.id}:${isoKey}`;

            // Deduplicate if a concrete task already exists for this recurrence on this date
            if (concreteRecurrenceDates.has(dedupKey)) {
              continue;
            }

            const occStart = isAllDay ? toUtcMidnight(isoKey) : occ;
            const occEnd = isAllDay
              ? new Date(occStart.getTime() + 24 * 60 * 60 * 1000)
              : new Date(occStart.getTime() + (r.dueAt && r.startAt ? r.dueAt - r.startAt : 0));

            items.push({
              id: `${r.id}:${isoKey}`,
              type: "virtual",
              virtual: true,
              title: r.title,
              start: occStart.toISOString(),
              end: occEnd.toISOString(),
              allDay: isAllDay,
              status: "todo",
              priority: Number(r.priority) || 0,
              listId: r.listId,
              color: r.listColor || null,
              recurrenceId: r.id,
            });

            count++;
          }
        } catch (err: any) {
          console.error("VIRTUAL EXPANSION ERROR:", err);
        }
      }

      // Sort combined calendar items by start time
      items.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

      return {
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        items,
        total: items.length,
      };
    },
    {
      auth: true,
      query: t.Object({
        from: t.String(),
        to: t.String(),
        list_id: t.Optional(t.String()),
        include_done: t.Optional(t.String()),
        tz: t.Optional(t.String()),
      }),
    }
  );
