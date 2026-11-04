import { Elysia, t } from "elysia";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";

/**
 * Sanitizes user input into a safe FTS5 query string:
 * - Strips dangerous punctuation (*, -, (, ), :, ^, ~)
 * - Quotes individual words (so AND, OR, NOT, NEAR behave as plain search terms)
 * - Preserves explicit double-quoted phrases
 * - Appends * to the final token for prefix/search-as-you-type
 * - Never throws on invalid input or empty strings
 */
export function sanitizeFts5Query(input?: string | null): string {
  if (!input || typeof input !== "string") return "";

  const trimmed = input.trim();
  if (!trimmed) return "";

  // Match quoted phrases "..." or individual whitespace-delimited tokens
  const tokenRegex = /"([^"]*)"|(\S+)/g;
  const terms: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(trimmed)) !== null) {
    if (match[1] !== undefined) {
      // Quoted phrase: strip internal quotes and special control chars
      const phrase = match[1].replace(/["*]/g, " ").trim();
      if (phrase) {
        terms.push(`"${phrase}"`);
      }
    } else if (match[2] !== undefined) {
      // Individual token: strip non-word/illegal chars
      const cleaned = match[2].replace(/[^\p{L}\p{N}_]/gu, "").trim();
      if (cleaned) {
        terms.push(cleaned);
      }
    }
  }

  if (terms.length === 0) return "";

  // For the last term, if it wasn't an explicit phrase, make it a prefix search term
  const lastIndex = terms.length - 1;
  const last = terms[lastIndex];

  if (!last.startsWith('"')) {
    terms[lastIndex] = `"${last}"*`;
  }

  // Quote any intermediate bare tokens
  for (let i = 0; i < lastIndex; i++) {
    if (!terms[i].startsWith('"')) {
      terms[i] = `"${terms[i]}"`;
    }
  }

  return terms.join(" ");
}

export interface SearchTaskResult {
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

  titleHl: string;
  notesHl: string;
  rank: number;
}

export const searchRoutes = new Elysia({ prefix: "/api/v1/search" })
  .use(authMacro)
  // GET /api/v1/search - FTS5 search with BM25 ranking, highlighting, and Cmd+K support
  .get(
    "/",
    async ({ user, query }) => {
      const q = query.q || "";
      const types = query.types ? query.types.split(",").map((s) => s.trim().toLowerCase()) : ["tasks"];
      const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);

      const ftsQuery = sanitizeFts5Query(q);

      let tasks: SearchTaskResult[] = [];
      let lists: any[] = [];
      let tags: any[] = [];
      let filters: any[] = [];

      // 1. Search tasks if requested and query non-empty
      if (types.includes("tasks") && ftsQuery) {
        const sqlParams: any[] = [ftsQuery, user.id];

        let whereClause = `
          WHERE tasks_fts MATCH ?
            AND t.user_id = ?
        `;

        if (query.scope === "trash") {
          whereClause += ` AND t.deleted_at IS NOT NULL`;
        } else {
          whereClause += ` AND t.deleted_at IS NULL`;
          if (query.archived === "true") {
            whereClause += ` AND t.archived_at IS NOT NULL`;
          } else {
            whereClause += ` AND t.archived_at IS NULL`;
            whereClause += ` AND NOT EXISTS (SELECT 1 FROM lists l2 WHERE l2.id = t.list_id AND l2.archived_at IS NOT NULL)`;
          }
        }

        if (query.list_id) {
          whereClause += ` AND t.list_id = ?`;
          sqlParams.push(query.list_id);
        }

        if (query.status) {
          whereClause += ` AND t.status = ?`;
          sqlParams.push(query.status);
        }

        if (query.tag) {
          whereClause += ` AND EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = t.id AND (tg.name = ? OR tg.id = ?) AND tg.deleted_at IS NULL)`;
          sqlParams.push(query.tag, query.tag);
        }

        const taskSearchSql = `
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
            COALESCE(st.total_count, 0) AS subtaskTotal,
            snippet(tasks_fts, 0, char(1), char(2), '…', 8) AS titleHl,
            snippet(tasks_fts, 1, char(1), char(2), '…', 16) AS notesHl,
            bm25(tasks_fts, 10.0, 1.0) AS rank
          FROM tasks_fts
          JOIN tasks t ON t.rowid = tasks_fts.rowid
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
          ${whereClause}
          ORDER BY CASE WHEN t.status = 'done' THEN 1 ELSE 0 END ASC, rank ASC
          LIMIT ${limit}
        `;

        const rawRows = sqlite.query(taskSearchSql).all(...sqlParams) as any[];

        tasks = rawRows.map((r) => ({
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

          titleHl: r.titleHl || r.title,
          notesHl: r.notesHl || "",
          rank: Number(r.rank) || 0,
        }));
      }

      // 2. Cmd+K multi-type matches (lists, tags, filters)
      const prefixPattern = q.trim() ? `%${q.trim()}%` : "%";

      if (types.includes("lists")) {
        lists = await db
          .select({
            id: schema.lists.id,
            name: schema.lists.name,
            color: schema.lists.color,
            isInbox: schema.lists.isInbox,
            position: schema.lists.position,
          })
          .from(schema.lists)
          .where(
            and(
              eq(schema.lists.userId, user.id),
              isNull(schema.lists.deletedAt),
              sql`${schema.lists.name} LIKE ${prefixPattern}`
            )
          )
          .orderBy(schema.lists.position)
          .limit(5);
      }

      if (types.includes("tags")) {
        tags = await db
          .select({
            id: schema.tags.id,
            name: schema.tags.name,
            color: schema.tags.color,
          })
          .from(schema.tags)
          .where(
            and(
              eq(schema.tags.userId, user.id),
              isNull(schema.tags.deletedAt),
              sql`${schema.tags.name} LIKE ${prefixPattern}`
            )
          )
          .orderBy(schema.tags.name)
          .limit(5);
      }

      if (types.includes("filters")) {
        filters = await db
          .select({
            id: schema.savedFilters.id,
            name: schema.savedFilters.name,
            icon: schema.savedFilters.icon,
            color: schema.savedFilters.color,
            position: schema.savedFilters.position,
            pinned: schema.savedFilters.pinned,
          })
          .from(schema.savedFilters)
          .where(
            and(
              eq(schema.savedFilters.userId, user.id),
              isNull(schema.savedFilters.deletedAt),
              sql`${schema.savedFilters.name} LIKE ${prefixPattern}`
            )
          )
          .orderBy(desc(schema.savedFilters.pinned), schema.savedFilters.position)
          .limit(5);
      }

      // If user only asked for tasks or did not specify types, return standard payload
      if (types.length === 1 && types[0] === "tasks") {
        return {
          tasks,
          total: tasks.length,
        };
      }

      return {
        tasks,
        lists,
        tags,
        filters,
      };
    },
    {
      auth: true,
      query: t.Object({
        q: t.Optional(t.String()),
        types: t.Optional(t.String()),
        list_id: t.Optional(t.String()),
        status: t.Optional(t.String()),
        tag: t.Optional(t.String()),
        archived: t.Optional(t.String()),
        scope: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    }
  )
  // POST /api/v1/search/rebuild - executes FTS rebuild and integrity-check
  .post(
    "/rebuild",
    async ({ user }) => {
      sqlite.run("INSERT INTO tasks_fts(tasks_fts) VALUES('rebuild')");
      sqlite.run("INSERT INTO tasks_fts(tasks_fts, rank) VALUES('integrity-check', 1)");

      return {
        success: true,
        message: "FTS5 index rebuilt and integrity verified",
        timestamp: new Date().toISOString(),
      };
    },
    { auth: true }
  );
