import { Elysia, t } from "elysia";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween } from "../utils/position";
import { decodeCursor, encodeCursor } from "../utils/cursor";
import { resolveTimezone } from "../utils/dates";
import {
  ALLOWED_FIELDS,
  ALLOWED_OPS,
  RELATIVE_DATE_KEYWORDS,
  compileFilterDsl,
  validateFilterDsl,
  type FilterNode,
} from "../utils/filter-dsl";
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

const baseTaskSelect = `
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

export const filterRoutes = new Elysia({ prefix: "/api/v1/filters" })
  .use(authMacro)
  // GET /api/v1/filters/schema - allowed fields, ops, relative dates
  .get("/schema", () => {
    return {
      fields: ALLOWED_FIELDS,
      operators: ALLOWED_OPS,
      relativeDates: RELATIVE_DATE_KEYWORDS,
    };
  })
  // GET /api/v1/filters - list user's saved filters (max 50)
  .get(
    "/",
    async ({ user }) => {
      const filters = await db
        .select()
        .from(schema.savedFilters)
        .where(
          and(
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          )
        )
        .orderBy(desc(schema.savedFilters.pinned), schema.savedFilters.position)
        .limit(50);

      return filters;
    },
    { auth: true }
  )
  // POST /api/v1/filters - create saved filter (cap 50)
  .post(
    "/",
    async ({ user, body, status }) => {
      // Check cap 50
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.savedFilters)
        .where(
          and(
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          )
        );

      if (Number(countResult?.count) >= 50) {
        return status(422, {
          error: "Filter limit reached",
          message: "You can save at most 50 filters",
        });
      }

      // Validate DSL query
      const dslCheck = validateFilterDsl(body.query);
      if (!dslCheck.valid) {
        return status(422, dslCheck.error);
      }

      // Determine fractional position
      const position = await positionBetween({
        table: schema.savedFilters,
        where: and(
          eq(schema.savedFilters.userId, user.id),
          isNull(schema.savedFilters.deletedAt)
        ),
      });

      const [newFilter] = await db
        .insert(schema.savedFilters)
        .values({
          userId: user.id,
          name: body.name.trim(),
          icon: body.icon || null,
          color: body.color || null,
          query: body.query,
          sort: body.sort || null,
          groupBy: body.groupBy || null,
          position,
          pinned: Boolean(body.pinned),
        })
        .returning();

      return status(201, newFilter);
    },
    {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        icon: t.Optional(t.String()),
        color: t.Optional(t.String()),
        query: t.Any(),
        sort: t.Optional(
          t.Array(
            t.Object({
              by: t.String(),
              order: t.Union([t.Literal("asc"), t.Literal("desc")]),
            })
          )
        ),
        groupBy: t.Optional(t.String()),
        pinned: t.Optional(t.Boolean()),
      }),
    }
  )
  // PATCH /api/v1/filters/:id - update saved filter
  .patch(
    "/:id",
    async ({ user, params: { id }, body, status }) => {
      const [filter] = await db
        .select()
        .from(schema.savedFilters)
        .where(
          and(
            eq(schema.savedFilters.id, id),
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          )
        );

      if (!filter) {
        return status(404, { error: "Filter not found" });
      }

      if (body.query !== undefined) {
        const dslCheck = validateFilterDsl(body.query);
        if (!dslCheck.valid) {
          return status(422, dslCheck.error);
        }
      }

      const updates: Record<string, any> = {
        updatedAt: new Date(),
        version: sql`${schema.savedFilters.version} + 1`,
      };

      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.icon !== undefined) updates.icon = body.icon;
      if (body.color !== undefined) updates.color = body.color;
      if (body.query !== undefined) updates.query = body.query;
      if (body.sort !== undefined) updates.sort = body.sort;
      if (body.groupBy !== undefined) updates.groupBy = body.groupBy;
      if (body.pinned !== undefined) updates.pinned = body.pinned;

      const [updated] = await db
        .update(schema.savedFilters)
        .set(updates)
        .where(
          and(
            eq(schema.savedFilters.id, id),
            eq(schema.savedFilters.userId, user.id)
          )
        )
        .returning();

      return updated;
    },
    {
      auth: true,
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        icon: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        query: t.Optional(t.Any()),
        sort: t.Optional(
          t.Nullable(
            t.Array(
              t.Object({
                by: t.String(),
                order: t.Union([t.Literal("asc"), t.Literal("desc")]),
              })
            )
          )
        ),
        groupBy: t.Optional(t.Nullable(t.String())),
        pinned: t.Optional(t.Boolean()),
      }),
    }
  )
  // DELETE /api/v1/filters/:id - delete filter
  .delete(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [filter] = await db
        .select()
        .from(schema.savedFilters)
        .where(
          and(
            eq(schema.savedFilters.id, id),
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          )
        );

      if (!filter) {
        return status(404, { error: "Filter not found" });
      }

      await db
        .update(schema.savedFilters)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.savedFilters.id, id),
            eq(schema.savedFilters.userId, user.id)
          )
        );

      return { success: true };
    },
    { auth: true }
  )
  // POST /api/v1/filters/:id/move - reorder saved filter
  .post(
    "/:id/move",
    async ({ user, params: { id }, body, status }) => {
      const [filter] = await db
        .select()
        .from(schema.savedFilters)
        .where(
          and(
            eq(schema.savedFilters.id, id),
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          )
        );

      if (!filter) {
        return status(404, { error: "Filter not found" });
      }

      const newPosition = await positionBetween(
        {
          table: schema.savedFilters,
          where: and(
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          ),
          excludeId: id,
        },
        body.afterId,
        body.beforeId
      );

      const [updated] = await db
        .update(schema.savedFilters)
        .set({
          position: newPosition,
          updatedAt: new Date(),
          version: sql`${schema.savedFilters.version} + 1`,
        })
        .where(
          and(
            eq(schema.savedFilters.id, id),
            eq(schema.savedFilters.userId, user.id)
          )
        )
        .returning();

      return updated;
    },
    {
      auth: true,
      body: t.Object({
        afterId: t.Optional(t.String()),
        beforeId: t.Optional(t.String()),
      }),
    }
  )
  // POST /api/v1/filters/preview - run unsaved DSL query and return matches
  .post(
    "/preview",
    async ({ user, body, query, status }) => {
      const dslCheck = validateFilterDsl(body.query);
      if (!dslCheck.valid) {
        return status(422, dslCheck.error);
      }

      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

      const { sql: filterSql, params: filterParams } = compileFilterDsl(body.query, tz, "t");

      const whereClause = `
        WHERE t.user_id = ?
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM lists l WHERE l.id = t.list_id AND l.archived_at IS NOT NULL)
          AND ${filterSql}
      `;

      let orderByClause = "ORDER BY t.position ASC, t.id ASC";
      if (body.sort && body.sort.length > 0) {
        const orderParts: string[] = [];
        for (const s of body.sort) {
          const dir = s.order === "desc" ? "DESC" : "ASC";
          if (s.by === "priority") orderParts.push(`t.priority ${dir}`);
          else if (s.by === "due_at") orderParts.push(`COALESCE(t.due_at, 9999999999999) ${dir}`);
          else if (s.by === "created_at") orderParts.push(`t.created_at ${dir}`);
          else if (s.by === "completed_at") orderParts.push(`t.completed_at ${dir}`);
          else if (s.by === "title") orderParts.push(`t.title ${dir}`);
          else if (s.by === "position") orderParts.push(`t.position ${dir}`);
        }
        if (orderParts.length > 0) {
          orderByClause = `ORDER BY ${orderParts.join(", ")}, t.id ASC`;
        }
      }

      const finalSql = `${baseTaskSelect} ${whereClause} ${orderByClause} LIMIT ${limit + 1}`;
      const rawRows = sqlite.query(finalSql).all(user.id, ...filterParams);
      const mapped = rawRows.map(mapRawRow);

      const hasMore = mapped.length > limit;
      const items = hasMore ? mapped.slice(0, limit) : mapped;

      let nextCursor: string | null = null;
      if (hasMore && items.length > 0) {
        const last = items[items.length - 1];
        nextCursor = encodeCursor({
          position: last.position,
          id: last.id,
        });
      }

      return {
        items,
        nextCursor,
        hasMore,
      };
    },
    {
      auth: true,
      body: t.Object({
        query: t.Any(),
        sort: t.Optional(
          t.Array(
            t.Object({
              by: t.String(),
              order: t.Union([t.Literal("asc"), t.Literal("desc")]),
            })
          )
        ),
      }),
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        tz: t.Optional(t.String()),
      }),
    }
  )
  // GET /api/v1/filters/:id/tasks - run saved filter query
  .get(
    "/:id/tasks",
    async ({ user, params: { id }, query, status }) => {
      const [saved] = await db
        .select()
        .from(schema.savedFilters)
        .where(
          and(
            eq(schema.savedFilters.id, id),
            eq(schema.savedFilters.userId, user.id),
            isNull(schema.savedFilters.deletedAt)
          )
        );

      if (!saved) {
        return status(404, { error: "Filter not found" });
      }

      const tz = resolveTimezone(query.tz || (user as any).timezone);
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);

      const { sql: filterSql, params: filterParams } = compileFilterDsl(saved.query as FilterNode, tz, "t");

      const whereClause = `
        WHERE t.user_id = ?
          AND t.deleted_at IS NULL
          AND t.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM lists l WHERE l.id = t.list_id AND l.archived_at IS NOT NULL)
          AND ${filterSql}
      `;

      let orderByClause = "ORDER BY t.position ASC, t.id ASC";
      const sortList = saved.sort as Array<{ by: string; order: "asc" | "desc" }> | null;
      if (sortList && sortList.length > 0) {
        const orderParts: string[] = [];
        for (const s of sortList) {
          const dir = s.order === "desc" ? "DESC" : "ASC";
          if (s.by === "priority") orderParts.push(`t.priority ${dir}`);
          else if (s.by === "due_at") orderParts.push(`COALESCE(t.due_at, 9999999999999) ${dir}`);
          else if (s.by === "created_at") orderParts.push(`t.created_at ${dir}`);
          else if (s.by === "completed_at") orderParts.push(`t.completed_at ${dir}`);
          else if (s.by === "title") orderParts.push(`t.title ${dir}`);
          else if (s.by === "position") orderParts.push(`t.position ${dir}`);
        }
        if (orderParts.length > 0) {
          orderByClause = `ORDER BY ${orderParts.join(", ")}, t.id ASC`;
        }
      }

      const finalSql = `${baseTaskSelect} ${whereClause} ${orderByClause} LIMIT ${limit + 1}`;
      const rawRows = sqlite.query(finalSql).all(user.id, ...filterParams);
      const mapped = rawRows.map(mapRawRow);

      const hasMore = mapped.length > limit;
      const items = hasMore ? mapped.slice(0, limit) : mapped;

      let nextCursor: string | null = null;
      if (hasMore && items.length > 0) {
        const last = items[items.length - 1];
        nextCursor = encodeCursor({
          position: last.position,
          id: last.id,
        });
      }

      return {
        filter: saved,
        items,
        nextCursor,
        hasMore,
      };
    },
    {
      auth: true,
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        tz: t.Optional(t.String()),
      }),
    }
  );
