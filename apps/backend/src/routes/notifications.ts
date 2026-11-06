import { Elysia, t } from "elysia";
import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { decodeCursor, encodeCursor } from "../utils/cursor";

type NotificationRow = typeof schema.notifications.$inferSelect;

function toDTO(n: NotificationRow) {
  return {
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    url: n.url,
    entityType: n.entityType,
    entityId: n.entityId,
    payload: n.payload ?? null,
    priority: n.priority,
    groupKey: n.groupKey,
    read: n.read,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const notificationRoutes = new Elysia({ name: "routes-notifications" })
  .use(authMacro)
  // GET /api/v1/notifications?cursor=&limit=&unread= — keyset inbox, newest first
  .get(
    "/api/v1/notifications",
    async ({ user, query }) => {
      const limit = Math.min(Math.max(Number(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const unreadOnly = query.unread === "1" || query.unread === "true";
      const cursor = decodeCursor(query.cursor ?? null);
      const cursorMs = cursor?.sortTuple?.[0];
      const cursorId = cursor?.id;

      const conditions = [
        eq(schema.notifications.userId, user.id),
        isNull(schema.notifications.deletedAt),
        ...(unreadOnly ? [isNull(schema.notifications.readAt)] : []),
        ...(typeof cursorMs === "number" && cursorId
          ? [
              or(
                lt(schema.notifications.createdAt, new Date(cursorMs)),
                and(eq(schema.notifications.createdAt, new Date(cursorMs)), lt(schema.notifications.id, cursorId))
              )!,
            ]
          : []),
      ];

      const rows = await db
        .select()
        .from(schema.notifications)
        .where(and(...conditions))
        .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(toDTO);
      const last = hasMore ? rows[limit - 1] : null;
      return {
        items,
        hasMore,
        nextCursor:
          hasMore && last ? encodeCursor({ id: last.id, sortTuple: [last.createdAt.getTime()] }) : null,
      };
    },
    {
      auth: true,
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Union([t.String(), t.Number()])),
        unread: t.Optional(t.String()),
      }),
    }
  )
  // GET /api/v1/notifications/unread-count
  .get("/api/v1/notifications/unread-count", async ({ user }) => {
    const [row] = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          isNull(schema.notifications.deletedAt),
          isNull(schema.notifications.readAt)
        )
      );
    return { count: row?.count ?? 0 };
  }, { auth: true })
  // POST /api/v1/notifications/:id/read — idempotent
  .post(
    "/api/v1/notifications/:id/read",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.id, id),
            eq(schema.notifications.userId, user.id),
            isNull(schema.notifications.deletedAt)
          )
        );
      if (!existing) {
        return status(404, { error: "Notification not found" });
      }
      if (!existing.readAt) {
        const at = new Date();
        await db
          .update(schema.notifications)
          .set({ read: true, readAt: at, updatedAt: at })
          .where(eq(schema.notifications.id, id));
        return toDTO({ ...existing, read: true, readAt: at, updatedAt: at });
      }
      return toDTO(existing);
    },
    { auth: true, params: t.Object({ id: t.String() }) }
  )
  // POST /api/v1/notifications/read-all
  .post("/api/v1/notifications/read-all", async ({ user }) => {
    const at = new Date();
    const unread = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          isNull(schema.notifications.deletedAt),
          isNull(schema.notifications.readAt)
        )
      );
    if (unread.length > 0) {
      await db
        .update(schema.notifications)
        .set({ read: true, readAt: at, updatedAt: at })
        .where(
          and(
            eq(schema.notifications.userId, user.id),
            isNull(schema.notifications.deletedAt),
            isNull(schema.notifications.readAt)
          )
        );
    }
    return { success: true, updated: unread.length };
  }, { auth: true })
  // DELETE /api/v1/notifications/:id — soft delete
  .delete(
    "/api/v1/notifications/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select({ id: schema.notifications.id })
        .from(schema.notifications)
        .where(
          and(
            eq(schema.notifications.id, id),
            eq(schema.notifications.userId, user.id),
            isNull(schema.notifications.deletedAt)
          )
        );
      if (!existing) {
        return status(404, { error: "Notification not found" });
      }
      const at = new Date();
      await db
        .update(schema.notifications)
        .set({ deletedAt: at, updatedAt: at })
        .where(eq(schema.notifications.id, id));
      return { success: true };
    },
    { auth: true, params: t.Object({ id: t.String() }) }
  );
