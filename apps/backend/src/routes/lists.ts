import { Elysia, t } from "elysia";
import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween } from "../utils/position";

export const listRoutes = new Elysia({ prefix: "/api/v1/lists" })
  .use(authMacro)
  // GET /api/v1/lists - list lists (filter by ?archived=true/false, ?folderId=...)
  .get(
    "/",
    async ({ user, query }) => {
      const conditions = [
        eq(schema.lists.userId, user.id),
        isNull(schema.lists.deletedAt),
      ];

      if (query.archived === "true") {
        conditions.push(isNotNull(schema.lists.archivedAt));
      } else {
        conditions.push(isNull(schema.lists.archivedAt));
      }

      if (query.folderId !== undefined) {
        if (query.folderId === "null" || query.folderId === "") {
          conditions.push(isNull(schema.lists.folderId));
        } else {
          conditions.push(eq(schema.lists.folderId, query.folderId));
        }
      }

      const lists = await db
        .select()
        .from(schema.lists)
        .where(and(...conditions))
        .orderBy(asc(schema.lists.position));

      return lists;
    },
    {
      auth: true,
      query: t.Object({
        archived: t.Optional(t.String()),
        folderId: t.Optional(t.String()),
      }),
    }
  )
  // POST /api/v1/lists - create list
  .post(
    "/",
    async ({ user, body, status }) => {
      if (body.folderId) {
        const [folder] = await db
          .select()
          .from(schema.folders)
          .where(
            and(
              eq(schema.folders.id, body.folderId),
              eq(schema.folders.userId, user.id),
              isNull(schema.folders.deletedAt)
            )
          );

        if (!folder) {
          return status(404, { error: "Folder not found" });
        }
      }

      const position = await positionBetween({
        table: schema.lists,
        where: eq(schema.lists.userId, user.id),
      });

      const [list] = await db
        .insert(schema.lists)
        .values({
          userId: user.id,
          folderId: body.folderId ?? null,
          name: body.name.trim(),
          color: body.color ?? null,
          icon: body.icon ?? null,
          viewType: body.viewType ?? "list",
          isInbox: false,
          position,
        })
        .returning();

      return status(201, list);
    },
    {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        folderId: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        icon: t.Optional(t.Nullable(t.String())),
        viewType: t.Optional(t.Union([t.Literal("list"), t.Literal("board"), t.Literal("calendar")])),
      }),
    }
  )
  // GET /api/v1/lists/:id - get single list
  .get(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [list] = await db
        .select()
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      if (!list) {
        return status(404, { error: "List not found" });
      }

      return list;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // PATCH /api/v1/lists/:id - update list
  .patch(
    "/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "List not found" });
      }

      if (body.folderId) {
        const [folder] = await db
          .select()
          .from(schema.folders)
          .where(
            and(
              eq(schema.folders.id, body.folderId),
              eq(schema.folders.userId, user.id),
              isNull(schema.folders.deletedAt)
            )
          );

        if (!folder) {
          return status(404, { error: "Folder not found" });
        }
      }

      const updates: Partial<{
        name: string;
        folderId: string | null;
        color: string | null;
        icon: string | null;
        viewType: "list" | "board" | "calendar";
        updatedAt: Date;
        version: ReturnType<typeof sql>;
      }> = {
        updatedAt: new Date(),
        version: sql`${schema.lists.version} + 1`,
      };

      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.folderId !== undefined) updates.folderId = body.folderId;
      if (body.color !== undefined) updates.color = body.color;
      if (body.icon !== undefined) updates.icon = body.icon;
      if (body.viewType !== undefined) updates.viewType = body.viewType;

      const [updated] = await db
        .update(schema.lists)
        .set(updates)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id)
          )
        )
        .returning();

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        folderId: t.Optional(t.Nullable(t.String())),
        color: t.Optional(t.Nullable(t.String())),
        icon: t.Optional(t.Nullable(t.String())),
        viewType: t.Optional(t.Union([t.Literal("list"), t.Literal("board"), t.Literal("calendar")])),
      }),
    }
  )
  // DELETE /api/v1/lists/:id - soft delete list
  .delete(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "List not found" });
      }

      if (existing.isInbox) {
        return status(400, { error: "Cannot delete the default Inbox list" });
      }

      const now = new Date();

      await db.transaction(async (tx) => {
        await tx
          .update(schema.lists)
          .set({
            deletedAt: now,
            updatedAt: now,
            version: sql`${schema.lists.version} + 1`,
          })
          .where(
            and(
              eq(schema.lists.id, id),
              eq(schema.lists.userId, user.id)
            )
          );

        await tx
          .update(schema.tasks)
          .set({
            deletedAt: now,
            updatedAt: now,
            version: sql`${schema.tasks.version} + 1`,
          })
          .where(
            and(
              eq(schema.tasks.listId, id),
              eq(schema.tasks.userId, user.id),
              isNull(schema.tasks.deletedAt)
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
  // POST /api/v1/lists/:id/move - move list
  .post(
    "/:id/move",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "List not found" });
      }

      if (body.folderId) {
        const [folder] = await db
          .select()
          .from(schema.folders)
          .where(
            and(
              eq(schema.folders.id, body.folderId),
              eq(schema.folders.userId, user.id),
              isNull(schema.folders.deletedAt)
            )
          );

        if (!folder) {
          return status(404, { error: "Folder not found" });
        }
      }

      const newPosition = await positionBetween(
        {
          table: schema.lists,
          where: eq(schema.lists.userId, user.id),
          excludeId: id,
        },
        body.afterId,
        body.beforeId
      );

      const updates: Record<string, unknown> = {
        position: newPosition,
        updatedAt: new Date(),
        version: sql`${schema.lists.version} + 1`,
      };

      if (body.folderId !== undefined) {
        updates.folderId = body.folderId;
      }

      const [updated] = await db
        .update(schema.lists)
        .set(updates)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id)
          )
        )
        .returning();

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        afterId: t.Optional(t.Nullable(t.String())),
        beforeId: t.Optional(t.Nullable(t.String())),
        folderId: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  // POST /api/v1/lists/:id/archive - archive list
  .post(
    "/:id/archive",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "List not found" });
      }

      if (existing.isInbox) {
        return status(400, { error: "Cannot archive the default Inbox list" });
      }

      const [updated] = await db
        .update(schema.lists)
        .set({
          archivedAt: new Date(),
          updatedAt: new Date(),
          version: sql`${schema.lists.version} + 1`,
        })
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id)
          )
        )
        .returning();

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /api/v1/lists/:id/unarchive - unarchive list
  .post(
    "/:id/unarchive",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "List not found" });
      }

      const [updated] = await db
        .update(schema.lists)
        .set({
          archivedAt: null,
          updatedAt: new Date(),
          version: sql`${schema.lists.version} + 1`,
        })
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id)
          )
        )
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
