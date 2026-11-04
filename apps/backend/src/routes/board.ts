import { Elysia, t } from "elysia";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween } from "../utils/position";
import { decodeCursor, encodeCursor } from "../utils/cursor";
import { runCompleteHooks } from "../utils/tasks";
import { firePendingTaskReminders } from "../services/reminders";
import { spawnNextRecurrenceInstance } from "../services/recurrence";
import type { ViewTaskRow } from "./views";

function mapRawRow(r: any): ViewTaskRow {
  return {
    id: r.id,
    userId: r.userId,
    listId: r.listId,
    sectionId: r.sectionId || null,
    parentId: r.parentId || null,
    title: r.title,
    notes: r.notes || null,
    status: r.status,
    priority: Number(r.priority) || 0,
    position: r.position,
    startAt: r.startAt ? new Date(r.startAt) : null,
    dueAt: r.dueAt ? new Date(r.dueAt) : null,
    deadlineAt: r.deadlineAt ? new Date(r.deadlineAt) : null,
    allDay: Boolean(r.allDay),
    estimateMin: r.estimateMin !== null && r.estimateMin !== undefined ? Number(r.estimateMin) : null,
    recurrenceId: r.recurrenceId || null,
    placeId: r.placeId || null,
    locationName: r.locationName || null,
    lat: r.lat !== null && r.lat !== undefined ? Number(r.lat) : null,
    lng: r.lng !== null && r.lng !== undefined ? Number(r.lng) : null,
    radiusM: r.radiusM !== null && r.radiusM !== undefined ? Number(r.radiusM) : null,
    locationTrigger: r.locationTrigger || null,
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
    archivedAt: r.archivedAt ? new Date(r.archivedAt) : null,
    createdAt: new Date(r.createdAt),
    updatedAt: new Date(r.updatedAt),
    version: Number(r.version) || 1,
    deletedAt: r.deletedAt ? new Date(r.deletedAt) : null,

    listName: r.listName || null,
    listColor: r.listColor || null,
    parentTitle: r.parentTitle || null,
    subtaskDone: Number(r.subtaskDone) || 0,
    subtaskTotal: Number(r.subtaskTotal) || 0,
  };
}

export interface BoardColumn {
  key: string;
  title: string;
  sectionId?: string | null;
  count: number;
  tasks: ViewTaskRow[];
  nextCursor?: string | null;
}

export const boardRoutes = new Elysia({ prefix: "/api/v1/board" })
  .use(authMacro)
  // GET /api/v1/board - Kanban board columns grouped by section, status, or priority
  .get(
    "/",
    async ({ user, query, status }) => {
      let listId = query.list_id;

      // If no list_id, default to user's inbox list
      if (!listId) {
        const [inbox] = await db
          .select({ id: schema.lists.id })
          .from(schema.lists)
          .where(
            and(
              eq(schema.lists.userId, user.id),
              eq(schema.lists.isInbox, true),
              isNull(schema.lists.deletedAt)
            )
          );
        if (!inbox) {
          return status(404, { error: "Inbox list not found" });
        }
        listId = inbox.id;
      }

      const groupBy = query.group_by || "section";
      const limit = 50;
      const nowMs = Date.now();
      const doneSinceMs = nowMs - 30 * 24 * 60 * 60 * 1000; // last 30 days

      const baseTaskSql = `
        SELECT
          t.id,
          t.user_id AS userId,
          t.list_id AS listId,
          t.section_id AS sectionId,
          t.parent_id AS parentId,
          t.title,
          t.notes,
          t.status,
          t.priority,
          t.position,
          t.start_at AS startAt,
          t.due_at AS dueAt,
          t.deadline_at AS deadlineAt,
          t.all_day AS allDay,
          t.estimate_min AS estimateMin,
          t.recurrence_id AS recurrenceId,
          t.place_id AS placeId,
          t.location_name AS locationName,
          t.lat,
          t.lng,
          t.radius_m AS radiusM,
          t.location_trigger AS locationTrigger,
          t.completed_at AS completedAt,
          t.archived_at AS archivedAt,
          t.created_at AS createdAt,
          t.updated_at AS updatedAt,
          t.version,
          t.deleted_at AS deletedAt,
          l.name AS listName,
          l.color AS listColor,
          p.title AS parentTitle,
          COALESCE(st.done_count, 0) AS subtaskDone,
          COALESCE(st.total_count, 0) AS subtaskTotal
        FROM tasks t
        LEFT JOIN lists l ON l.id = t.list_id
        LEFT JOIN tasks p ON p.id = t.parent_id
        LEFT JOIN (
          SELECT
            parent_id,
            COUNT(CASE WHEN status = 'done' THEN 1 END) AS done_count,
            COUNT(*) AS total_count
          FROM tasks
          WHERE deleted_at IS NULL AND parent_id IS NOT NULL
          GROUP BY parent_id
        ) st ON st.parent_id = t.id
      `;

      function buildColumn(
        key: string,
        title: string,
        extraWhere: string,
        params: any[],
        sectionId?: string | null
      ): BoardColumn {
        const countSql = `
          SELECT COUNT(*) AS total
          FROM tasks t
          WHERE t.user_id = ? AND t.list_id = ? AND t.parent_id IS NULL AND t.deleted_at IS NULL
            AND ${extraWhere}
        `;
        const countRes = sqlite.query<{ total: number }, any[]>(countSql).get(user.id, listId, ...params);
        const count = Number(countRes?.total) || 0;

        const tasksQuery = `
          ${baseTaskSql}
          WHERE t.user_id = ? AND t.list_id = ? AND t.parent_id IS NULL AND t.deleted_at IS NULL
            AND ${extraWhere}
          ORDER BY t.position ASC, t.id ASC
          LIMIT ${limit + 1}
        `;

        const rawRows = sqlite.query(tasksQuery).all(user.id, listId, ...params) as any[];
        const mapped = rawRows.map(mapRawRow);

        const hasMore = mapped.length > limit;
        const columnTasks = hasMore ? mapped.slice(0, limit) : mapped;

        let nextCursor: string | null = null;
        if (hasMore && columnTasks.length > 0) {
          const last = columnTasks[columnTasks.length - 1];
          nextCursor = encodeCursor({
            position: last.position,
            id: last.id,
          });
        }

        return {
          key,
          title,
          ...(sectionId !== undefined ? { sectionId } : {}),
          count,
          tasks: columnTasks,
          nextCursor,
        };
      }

      const columns: BoardColumn[] = [];

      if (groupBy === "status") {
        columns.push(
          buildColumn("todo", "To Do", "t.archived_at IS NULL AND t.status = 'todo'", []),
          buildColumn("in_progress", "In Progress", "t.archived_at IS NULL AND t.status = 'in_progress'", []),
          buildColumn("done", "Done", `t.status = 'done' AND t.completed_at >= ?`, [doneSinceMs])
        );
      } else if (groupBy === "priority") {
        columns.push(
          buildColumn("4", "Urgent (P4)", "t.archived_at IS NULL AND t.status != 'done' AND t.priority = 4", []),
          buildColumn("3", "High (P3)", "t.archived_at IS NULL AND t.status != 'done' AND t.priority = 3", []),
          buildColumn("2", "Medium (P2)", "t.archived_at IS NULL AND t.status != 'done' AND t.priority = 2", []),
          buildColumn("1", "Low (P1)", "t.archived_at IS NULL AND t.status != 'done' AND t.priority = 1", []),
          buildColumn("0", "None (P0)", "t.archived_at IS NULL AND t.status != 'done' AND t.priority = 0", [])
        );
      } else {
        // Default: group by section
        // 1. Unsectioned
        columns.push(
          buildColumn(
            "no_section",
            "No Section",
            "t.archived_at IS NULL AND t.status != 'done' AND t.section_id IS NULL",
            [],
            null
          )
        );

        // 2. Sections in list
        const listSections = await db
          .select()
          .from(schema.sections)
          .where(
            and(
              eq(schema.sections.listId, listId),
              eq(schema.sections.userId, user.id),
              isNull(schema.sections.deletedAt)
            )
          )
          .orderBy(asc(schema.sections.position));

        for (const sec of listSections) {
          columns.push(
            buildColumn(
              sec.id,
              sec.name,
              "t.archived_at IS NULL AND t.status != 'done' AND t.section_id = ?",
              [sec.id],
              sec.id
            )
          );
        }
      }

      return {
        listId,
        groupBy,
        columns,
      };
    },
    {
      auth: true,
      query: t.Object({
        list_id: t.Optional(t.String()),
        group_by: t.Optional(t.String()),
      }),
    }
  )
  // POST /api/v1/board/move - move task between columns and reorder in one transaction
  .post(
    "/move",
    async ({ user, body, status }) => {
      const taskId = body.taskId;
      const targetColumn = body.column;

      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, taskId),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!task) {
        return status(404, { error: "Task not found" });
      }

      // Determine changes
      let newSectionId: string | null | undefined = undefined;
      let newStatus: "todo" | "in_progress" | "done" | "cancelled" | undefined = undefined;
      let newPriority: number | undefined = undefined;

      let positionScopeCondition = and(
        eq(schema.tasks.userId, user.id),
        eq(schema.tasks.listId, task.listId),
        isNull(schema.tasks.parentId),
        isNull(schema.tasks.deletedAt)
      );

      if (targetColumn === "no_section") {
        newSectionId = null;
        positionScopeCondition = and(
          positionScopeCondition,
          isNull(schema.tasks.sectionId),
          isNull(schema.tasks.archivedAt)
        );
      } else if (["todo", "in_progress", "done", "cancelled"].includes(targetColumn)) {
        const statusVal = targetColumn as "todo" | "in_progress" | "done" | "cancelled";
        newStatus = statusVal;
        positionScopeCondition = and(
          positionScopeCondition,
          eq(schema.tasks.status, statusVal)
        );
      } else if (["0", "1", "2", "3", "4"].includes(targetColumn)) {
        newPriority = Number(targetColumn);
        positionScopeCondition = and(
          positionScopeCondition,
          eq(schema.tasks.priority, newPriority),
          isNull(schema.tasks.archivedAt)
        );
      } else {
        // Assume section ID
        const [sec] = await db
          .select()
          .from(schema.sections)
          .where(
            and(
              eq(schema.sections.id, targetColumn),
              eq(schema.sections.listId, task.listId),
              eq(schema.sections.userId, user.id),
              isNull(schema.sections.deletedAt)
            )
          );

        if (!sec) {
          return status(404, { error: `Invalid column or section '${targetColumn}'` });
        }

        newSectionId = sec.id;
        positionScopeCondition = and(
          positionScopeCondition,
          eq(schema.tasks.sectionId, sec.id),
          isNull(schema.tasks.archivedAt)
        );
      }

      // Execute move in transaction
      const result = await db.transaction(async (tx) => {
        const newPosition = await positionBetween(
          {
            table: schema.tasks,
            where: positionScopeCondition,
            excludeId: taskId,
          },
          body.afterId,
          body.beforeId
        );

        const updates: Record<string, any> = {
          position: newPosition,
          updatedAt: new Date(),
          version: sql`${schema.tasks.version} + 1`,
        };

        if (newSectionId !== undefined) updates.sectionId = newSectionId;
        if (newPriority !== undefined) updates.priority = newPriority;

        let isMarkingDone = false;
        if (newStatus !== undefined) {
          updates.status = newStatus;
          if (newStatus === "done" && task.status !== "done") {
            updates.completedAt = new Date();
            isMarkingDone = true;
          } else if (newStatus !== "done" && task.status === "done") {
            updates.completedAt = null;
          }
        }

        const [updated] = await tx
          .update(schema.tasks)
          .set(updates)
          .where(
            and(
              eq(schema.tasks.id, taskId),
              eq(schema.tasks.userId, user.id)
            )
          )
          .returning();

        let nextTask: any = null;
        if (isMarkingDone) {
          await firePendingTaskReminders(taskId, user.id, tx);
          nextTask = await spawnNextRecurrenceInstance({
            taskId,
            userId: user.id,
            isSkip: false,
            tx,
            now: updates.completedAt,
          });
        }

        return { task: updated, nextTask, isMarkingDone };
      });

      if (result.isMarkingDone) {
        await runCompleteHooks(result.task);
      }

      return {
        task: result.task,
        nextTask: result.nextTask,
      };
    },
    {
      auth: true,
      body: t.Object({
        taskId: t.String(),
        column: t.String(),
        afterId: t.Optional(t.String()),
        beforeId: t.Optional(t.String()),
      }),
    }
  );
