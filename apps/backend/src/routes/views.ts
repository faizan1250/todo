import { Elysia, t } from "elysia";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { decodeCursor, encodeCursor } from "../utils/cursor";
import { dayBounds, resolveTimezone, toUtcMidnight } from "../utils/dates";
import { DateTime } from "luxon";

export interface ViewTaskRow {
  id: string;
  userId: string;
  listId: string;
  sectionId: string | null;
  parentId: string | null;
  title: string;
  notes: string | null;
  status: "todo" | "in_progress" | "done" | "cancelled";
  priority: number;
  position: string;
  startAt: Date | null;
  dueAt: Date | null;
  deadlineAt: Date | null;
  allDay: boolean;
  estimateMin: number | null;
  recurrenceId: string | null;
  placeId: string | null;
  locationName: string | null;
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
  locationTrigger: "arrive" | "leave" | null;
  completedAt: Date | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  deletedAt: Date | null;

  listName: string | null;
  listColor: string | null;
  parentTitle: string | null;
  subtaskDone: number;
  subtaskTotal: number;
}

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

export const viewRoutes = new Elysia({ prefix: "/api/v1/views" })
  .use(authMacro)
  // GET /api/v1/views - list built-in views plus user's saved filters
  .get(
    "/",
    async ({ user }) => {
      const builtIns = [
        { key: "today", name: "Today", icon: "sun" },
        { key: "upcoming", name: "Upcoming", icon: "calendar" },
        { key: "overdue", name: "Overdue", icon: "alert-circle" },
        { key: "priority", name: "Priority", icon: "star" },
        { key: "no-date", name: "No Date", icon: "inbox" },
        { key: "completed", name: "Completed", icon: "check-circle-2" },
        { key: "all", name: "All Tasks", icon: "layers" },
      ];

      const saved = await db
        .select()
        .from(schema.savedFilters)
        .where(
          and(
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          )
        )
        .orderBy(schema.savedFilters.position);

      return {
        builtIns,
        savedFilters: saved,
      };
    },
    { auth: true }
  )
  // GET /api/v1/views/counts - single fast query with conditional aggregates for badges
  .get(
    "/counts",
    async ({ user, query }) => {
      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const now = new Date();
      const nowMs = now.getTime();
      const todayBounds = dayBounds(now, tz);
      const todayStartUtcMs = todayBounds.startUtc.getTime();
      const todayEndUtcMs = todayBounds.endUtc.getTime();
      const todayFloatStartMs = todayBounds.floatStart.getTime();
      const todayFloatEndMs = todayBounds.floatEnd.getTime();

      const daysCount = Math.min(Math.max(Number(query.days) || 7, 1), 90);
      const tomorrowDateTime = DateTime.fromJSDate(todayBounds.startUtc, { zone: tz }).plus({ days: 1 });
      const tomorrowBounds = dayBounds(tomorrowDateTime, tz);
      const tomorrowStartUtcMs = tomorrowBounds.startUtc.getTime();
      const tomorrowFloatStartMs = tomorrowBounds.floatStart.getTime();

      const upcomingEndDateTime = DateTime.fromJSDate(todayBounds.startUtc, { zone: tz }).plus({ days: daysCount + 1 });
      const upcomingEndBounds = dayBounds(upcomingEndDateTime, tz);
      const upcomingEndUtcMs = upcomingEndBounds.startUtc.getTime();
      const upcomingFloatEndMs = upcomingEndBounds.floatStart.getTime();

      const completedDays = Math.min(Math.max(Number(query.completed_days) || 30, 1), 365);
      const completedSinceMs = nowMs - completedDays * 24 * 60 * 60 * 1000;

      const countsSql = `
        SELECT
          COUNT(CASE WHEN t.status IN ('todo', 'in_progress') AND (
            (t.due_at IS NOT NULL AND ((t.all_day = 0 AND t.due_at < ?1) OR (t.all_day = 1 AND t.due_at < ?2)))
          ) THEN 1 END) AS overdue,

          COUNT(CASE WHEN t.status IN ('todo', 'in_progress') AND (
            (t.due_at IS NOT NULL AND ((t.all_day = 0 AND t.due_at < ?3) OR (t.all_day = 1 AND t.due_at < ?4)))
            OR (t.due_at IS NULL AND t.start_at IS NOT NULL AND ((t.all_day = 0 AND t.start_at >= ?5 AND t.start_at < ?3) OR (t.all_day = 1 AND t.start_at >= ?2 AND t.start_at < ?4)))
          ) THEN 1 END) AS today,

          COUNT(CASE WHEN t.status IN ('todo', 'in_progress') AND (
            (t.due_at IS NOT NULL AND ((t.all_day = 0 AND t.due_at >= ?6 AND t.due_at < ?7) OR (t.all_day = 1 AND t.due_at >= ?8 AND t.due_at < ?9)))
            OR (t.due_at IS NULL AND t.start_at IS NOT NULL AND ((t.all_day = 0 AND t.start_at >= ?6 AND t.start_at < ?7) OR (t.all_day = 1 AND t.start_at >= ?8 AND t.start_at < ?9)))
          ) THEN 1 END) AS upcoming,

          COUNT(CASE WHEN t.status IN ('todo', 'in_progress') AND t.priority >= 3 THEN 1 END) AS priority,

          COUNT(CASE WHEN t.status IN ('todo', 'in_progress') AND t.parent_id IS NULL AND t.due_at IS NULL AND t.start_at IS NULL THEN 1 END) AS no_date,

          COUNT(CASE WHEN t.status IN ('todo', 'in_progress') THEN 1 END) AS all_count,

          (SELECT COUNT(*) FROM tasks c
           WHERE c.user_id = ?10 AND c.deleted_at IS NULL AND c.status = 'done' AND c.completed_at >= ?11
             AND NOT EXISTS (SELECT 1 FROM lists cl WHERE cl.id = c.list_id AND cl.archived_at IS NOT NULL)
          ) AS completed
        FROM tasks t
        WHERE t.user_id = ?10 AND t.deleted_at IS NULL AND t.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM lists l WHERE l.id = t.list_id AND l.archived_at IS NOT NULL)
      `;

      const res = sqlite.query<
        {
          overdue: number;
          today: number;
          upcoming: number;
          priority: number;
          no_date: number;
          all_count: number;
          completed: number;
        },
        [
          number, // 1: nowMs
          number, // 2: todayFloatStartMs
          number, // 3: todayEndUtcMs
          number, // 4: todayFloatEndMs
          number, // 5: todayStartUtcMs
          number, // 6: tomorrowStartUtcMs
          number, // 7: upcomingEndUtcMs
          number, // 8: tomorrowFloatStartMs
          number, // 9: upcomingFloatEndMs
          string, // 10: user.id
          number  // 11: completedSinceMs
        ]
      >(countsSql).get(
        nowMs,
        todayFloatStartMs,
        todayEndUtcMs,
        todayFloatEndMs,
        todayStartUtcMs,
        tomorrowStartUtcMs,
        upcomingEndUtcMs,
        tomorrowFloatStartMs,
        upcomingFloatEndMs,
        user.id,
        completedSinceMs
      );

      const counts = {
        overdue: Number(res?.overdue) || 0,
        today: Number(res?.today) || 0,
        upcoming: Number(res?.upcoming) || 0,
        priority: Number(res?.priority) || 0,
        "no-date": Number(res?.no_date) || 0,
        completed: Number(res?.completed) || 0,
        all: Number(res?.all_count) || 0,
      };

      // Optional filters counts (?filters=true)
      let filtersCounts: Record<string, number> | undefined;
      if (query.filters === "true") {
        filtersCounts = {};
        const saved = await db
          .select()
          .from(schema.savedFilters)
          .where(
            and(
              eq(schema.savedFilters.userId, user.id),
              isNull(schema.savedFilters.deletedAt)
            )
          )
          .orderBy(desc(schema.savedFilters.pinned), schema.savedFilters.position)
          .limit(20);

        for (const f of saved) {
          // Count will be filled via filter compiler or default 0
          filtersCounts[f.id] = 0;
        }
      }

      return {
        counts,
        ...(filtersCounts !== undefined ? { filters: filtersCounts } : {}),
      };
    },
    { auth: true }
  )
  // GET /api/v1/views/:key - retrieve items for a view key
  .get(
    "/:key",
    async ({ user, params, query, status }) => {
      const key = params.key;
      const validKeys = ["today", "upcoming", "overdue", "priority", "no-date", "completed", "all"];
      if (!validKeys.includes(key)) {
        return status(404, { error: `View '${key}' not found` });
      }

      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const now = new Date();
      const nowMs = now.getTime();
      const todayBounds = dayBounds(now, tz);
      const todayStartUtcMs = todayBounds.startUtc.getTime();
      const todayEndUtcMs = todayBounds.endUtc.getTime();
      const todayFloatStartMs = todayBounds.floatStart.getTime();
      const todayFloatEndMs = todayBounds.floatEnd.getTime();

      const decodedCursor = decodeCursor(query.cursor);

      // Base SELECT query with metadata enrichment
      const baseSelect = `
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

      let whereClause = `
        WHERE t.user_id = ?
          AND t.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM lists l2 WHERE l2.id = t.list_id AND l2.archived_at IS NOT NULL)
      `;
      const sqlParams: any[] = [user.id];

      let orderByClause = "";

      switch (key) {
        case "today": {
          whereClause += `
            AND t.archived_at IS NULL
            AND t.status IN ('todo', 'in_progress')
            AND (
              (t.due_at IS NOT NULL AND ((t.all_day = 0 AND t.due_at < ?) OR (t.all_day = 1 AND t.due_at < ?)))
              OR (t.due_at IS NULL AND t.start_at IS NOT NULL AND ((t.all_day = 0 AND t.start_at >= ? AND t.start_at < ?) OR (t.all_day = 1 AND t.start_at >= ? AND t.start_at < ?)))
            )
          `;
          sqlParams.push(
            todayEndUtcMs,
            todayFloatEndMs,
            todayStartUtcMs,
            todayEndUtcMs,
            todayFloatStartMs,
            todayFloatEndMs
          );

          if (decodedCursor?.sortTuple && decodedCursor.sortTuple.length >= 2) {
            const [cursorTime, cursorPosition] = decodedCursor.sortTuple;
            whereClause += `
              AND (
                COALESCE(t.due_at, t.start_at) > ?
                OR (
                  COALESCE(t.due_at, t.start_at) = ?
                  AND (
                    t.position > ?
                    OR (t.position = ? AND t.id > ?)
                  )
                )
              )
            `;
            sqlParams.push(cursorTime, cursorTime, cursorPosition, cursorPosition, decodedCursor.id);
          }

          orderByClause = `ORDER BY COALESCE(t.due_at, t.start_at) ASC, t.position ASC, t.id ASC`;
          break;
        }

        case "overdue": {
          whereClause += `
            AND t.archived_at IS NULL
            AND t.status IN ('todo', 'in_progress')
            AND t.due_at IS NOT NULL
            AND ((t.all_day = 0 AND t.due_at < ?) OR (t.all_day = 1 AND t.due_at < ?))
          `;
          sqlParams.push(nowMs, todayFloatStartMs);

          if (decodedCursor?.sortTuple && decodedCursor.sortTuple.length >= 1) {
            const [cursorDue] = decodedCursor.sortTuple;
            whereClause += `
              AND (t.due_at > ? OR (t.due_at = ? AND t.id > ?))
            `;
            sqlParams.push(cursorDue, cursorDue, decodedCursor.id);
          }

          orderByClause = `ORDER BY t.due_at ASC, t.id ASC`;
          break;
        }

        case "upcoming": {
          const daysCount = Math.min(Math.max(Number(query.days) || 7, 1), 90);
          const tomorrowDateTime = DateTime.fromJSDate(todayBounds.startUtc, { zone: tz }).plus({ days: 1 });
          const tomorrowBounds = dayBounds(tomorrowDateTime, tz);
          const tomorrowStartUtcMs = tomorrowBounds.startUtc.getTime();
          const tomorrowFloatStartMs = tomorrowBounds.floatStart.getTime();

          const upcomingEndDateTime = DateTime.fromJSDate(todayBounds.startUtc, { zone: tz }).plus({ days: daysCount + 1 });
          const upcomingEndBounds = dayBounds(upcomingEndDateTime, tz);
          const upcomingEndUtcMs = upcomingEndBounds.startUtc.getTime();
          const upcomingFloatEndMs = upcomingEndBounds.floatStart.getTime();

          whereClause += `
            AND t.archived_at IS NULL
            AND t.status IN ('todo', 'in_progress')
            AND (
              (t.due_at IS NOT NULL AND ((t.all_day = 0 AND t.due_at >= ? AND t.due_at < ?) OR (t.all_day = 1 AND t.due_at >= ? AND t.due_at < ?)))
              OR (t.due_at IS NULL AND t.start_at IS NOT NULL AND ((t.all_day = 0 AND t.start_at >= ? AND t.start_at < ?) OR (t.all_day = 1 AND t.start_at >= ? AND t.start_at < ?)))
            )
          `;
          sqlParams.push(
            tomorrowStartUtcMs,
            upcomingEndUtcMs,
            tomorrowFloatStartMs,
            upcomingFloatEndMs,
            tomorrowStartUtcMs,
            upcomingEndUtcMs,
            tomorrowFloatStartMs,
            upcomingFloatEndMs
          );

          if (decodedCursor?.sortTuple && decodedCursor.sortTuple.length >= 2) {
            const [cursorTime, cursorPosition] = decodedCursor.sortTuple;
            whereClause += `
              AND (
                COALESCE(t.due_at, t.start_at) > ?
                OR (
                  COALESCE(t.due_at, t.start_at) = ?
                  AND (
                    t.position > ?
                    OR (t.position = ? AND t.id > ?)
                  )
                )
              )
            `;
            sqlParams.push(cursorTime, cursorTime, cursorPosition, cursorPosition, decodedCursor.id);
          }

          orderByClause = `ORDER BY COALESCE(t.due_at, t.start_at) ASC, t.position ASC, t.id ASC`;
          break;
        }

        case "priority": {
          whereClause += `
            AND t.archived_at IS NULL
            AND t.status IN ('todo', 'in_progress')
            AND t.priority >= 3
          `;

          if (decodedCursor?.sortTuple && decodedCursor.sortTuple.length >= 2) {
            const [cursorPriority, cursorDue] = decodedCursor.sortTuple;
            whereClause += `
              AND (
                t.priority < ?
                OR (
                  t.priority = ?
                  AND (
                    COALESCE(t.due_at, 9999999999999) > ?
                    OR (COALESCE(t.due_at, 9999999999999) = ? AND t.id > ?)
                  )
                )
              )
            `;
            sqlParams.push(cursorPriority, cursorPriority, cursorDue, cursorDue, decodedCursor.id);
          }

          orderByClause = `ORDER BY t.priority DESC, COALESCE(t.due_at, 9999999999999) ASC, t.id ASC`;
          break;
        }

        case "no-date": {
          whereClause += `
            AND t.archived_at IS NULL
            AND t.status IN ('todo', 'in_progress')
            AND t.parent_id IS NULL
            AND t.due_at IS NULL
            AND t.start_at IS NULL
          `;

          if (decodedCursor?.position) {
            whereClause += `
              AND (t.position > ? OR (t.position = ? AND t.id > ?))
            `;
            sqlParams.push(decodedCursor.position, decodedCursor.position, decodedCursor.id);
          }

          orderByClause = `ORDER BY t.position ASC, t.id ASC`;
          break;
        }

        case "completed": {
          const daysCount = Math.min(Math.max(Number(query.days) || 30, 1), 365);
          const completedSinceMs = nowMs - daysCount * 24 * 60 * 60 * 1000;

          whereClause += `
            AND t.status = 'done'
            AND t.completed_at >= ?
          `;
          sqlParams.push(completedSinceMs);

          if (decodedCursor?.sortTuple && decodedCursor.sortTuple.length >= 1) {
            const [cursorCompleted] = decodedCursor.sortTuple;
            whereClause += `
              AND (t.completed_at < ? OR (t.completed_at = ? AND t.id < ?))
            `;
            sqlParams.push(cursorCompleted, cursorCompleted, decodedCursor.id);
          }

          orderByClause = `ORDER BY t.completed_at DESC, t.id DESC`;
          break;
        }

        case "all": {
          whereClause += `
            AND t.archived_at IS NULL
            AND t.status IN ('todo', 'in_progress')
          `;

          if (decodedCursor?.position) {
            whereClause += `
              AND (t.position > ? OR (t.position = ? AND t.id > ?))
            `;
            sqlParams.push(decodedCursor.position, decodedCursor.position, decodedCursor.id);
          }

          orderByClause = `ORDER BY t.position ASC, t.id ASC`;
          break;
        }
      }

      // Query limit + 1 items
      const finalSql = `${baseSelect} ${whereClause} ${orderByClause} LIMIT ${limit + 1}`;
      const rawRows = sqlite.query(finalSql).all(...sqlParams);

      const mappedItems = rawRows.map(mapRawRow);

      // Handle recurrence deduplication for upcoming view
      let itemsToProcess = mappedItems;
      if (key === "upcoming") {
        const seenRecurrences = new Set<string>();
        itemsToProcess = mappedItems.filter((item) => {
          if (!item.recurrenceId) return true;
          if (seenRecurrences.has(item.recurrenceId)) return false;
          seenRecurrences.add(item.recurrenceId);
          return true;
        });
      }

      const hasMore = itemsToProcess.length > limit;
      const slicedItems = hasMore ? itemsToProcess.slice(0, limit) : itemsToProcess;

      let nextCursor: string | null = null;
      if (hasMore && slicedItems.length > 0) {
        const last = slicedItems[slicedItems.length - 1];
        let sortTuple: any[] = [];

        switch (key) {
          case "today":
          case "upcoming": {
            const timeVal = (last.dueAt || last.startAt)?.getTime() || 0;
            sortTuple = [timeVal, last.position];
            break;
          }
          case "overdue": {
            sortTuple = [last.dueAt?.getTime() || 0];
            break;
          }
          case "priority": {
            sortTuple = [last.priority, last.dueAt?.getTime() || 9999999999999];
            break;
          }
          case "completed": {
            sortTuple = [last.completedAt?.getTime() || 0];
            break;
          }
          case "no-date":
          case "all": {
            sortTuple = [last.position];
            break;
          }
        }

        nextCursor = encodeCursor({
          position: last.position,
          id: last.id,
          sortTuple,
        });
      }

      // If upcoming, also produce grouped by local date
      if (key === "upcoming") {
        const groupsMap = new Map<string, ViewTaskRow[]>();

        for (const item of slicedItems) {
          const dateVal = item.dueAt || item.startAt;
          let dateStr = "No Date";
          if (dateVal) {
            if (item.allDay) {
              dateStr = dateVal.toISOString().slice(0, 10);
            } else {
              dateStr = DateTime.fromJSDate(dateVal, { zone: tz }).toISODate() || "No Date";
            }
          }
          if (!groupsMap.has(dateStr)) {
            groupsMap.set(dateStr, []);
          }
          groupsMap.get(dateStr)!.push(item);
        }

        const groups = Array.from(groupsMap.entries()).map(([date, tasks]) => ({
          date,
          tasks,
        }));

        return {
          key,
          items: slicedItems,
          groups,
          nextCursor,
          hasMore,
        };
      }

      return {
        key,
        items: slicedItems,
        nextCursor,
        hasMore,
      };
    },
    { auth: true }
  );
