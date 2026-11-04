import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween } from "../utils/position";

export const folderRoutes = new Elysia({ prefix: "/api/v1/folders" })
  .use(authMacro)
  // GET /api/v1/folders - list user's folders ordered by position ASC
  .get(
    "/",
    async ({ user }) => {
      const folders = await db
        .select()
        .from(schema.folders)
        .where(
          and(
            eq(schema.folders.userId, user.id),
            isNull(schema.folders.deletedAt)
          )
        )
        .orderBy(asc(schema.folders.position));

      return folders;
    },
    { auth: true }
  )
  // POST /api/v1/folders - create folder
  .post(
    "/",
    async ({ user, body, status }) => {
      const position = await positionBetween({
        table: schema.folders,
        where: eq(schema.folders.userId, user.id),
      });

      const [folder] = await db
        .insert(schema.folders)
        .values({
          userId: user.id,
          name: body.name.trim(),
          color: body.color ?? null,
          icon: body.icon ?? null,
          position,
        })
        .returning();

      return status(201, folder);
    },
    {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        color: t.Optional(t.Nullable(t.String())),
        icon: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  // PATCH /api/v1/folders/:id - update folder
  .patch(
    "/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.folders)
        .where(
          and(
            eq(schema.folders.id, id),
            eq(schema.folders.userId, user.id),
            isNull(schema.folders.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Folder not found" });
      }

      const updates: Partial<{
        name: string;
        color: string | null;
        icon: string | null;
        updatedAt: Date;
        version: ReturnType<typeof sql>;
      }> = {
        updatedAt: new Date(),
        version: sql`${schema.folders.version} + 1`,
      };

      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.color !== undefined) updates.color = body.color;
      if (body.icon !== undefined) updates.icon = body.icon;

      const [updated] = await db
        .update(schema.folders)
        .set(updates)
        .where(
          and(
            eq(schema.folders.id, id),
            eq(schema.folders.userId, user.id)
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
        color: t.Optional(t.Nullable(t.String())),
        icon: t.Optional(t.Nullable(t.String())),
      }),
    }
  )
  // DELETE /api/v1/folders/:id - soft delete folder and move lists to root
  .delete(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.folders)
        .where(
          and(
            eq(schema.folders.id, id),
            eq(schema.folders.userId, user.id),
            isNull(schema.folders.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Folder not found" });
      }

      const now = new Date();

      await db.transaction(async (tx) => {
        // Soft delete folder
        await tx
          .update(schema.folders)
          .set({
            deletedAt: now,
            updatedAt: now,
            version: sql`${schema.folders.version} + 1`,
          })
          .where(
            and(
              eq(schema.folders.id, id),
              eq(schema.folders.userId, user.id)
            )
          );

        // Move its lists to root (folderId = null)
        await tx
          .update(schema.lists)
          .set({
            folderId: null,
            updatedAt: now,
            version: sql`${schema.lists.version} + 1`,
          })
          .where(
            and(
              eq(schema.lists.folderId, id),
              eq(schema.lists.userId, user.id),
              isNull(schema.lists.deletedAt)
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
  // POST /api/v1/folders/:id/move - move folder
  .post(
    "/:id/move",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.folders)
        .where(
          and(
            eq(schema.folders.id, id),
            eq(schema.folders.userId, user.id),
            isNull(schema.folders.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Folder not found" });
      }

      const newPosition = await positionBetween(
        {
          table: schema.folders,
          where: eq(schema.folders.userId, user.id),
          excludeId: id,
        },
        body.afterId,
        body.beforeId
      );

      const [updated] = await db
        .update(schema.folders)
        .set({
          position: newPosition,
          updatedAt: new Date(),
          version: sql`${schema.folders.version} + 1`,
        })
        .where(
          and(
            eq(schema.folders.id, id),
            eq(schema.folders.userId, user.id)
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
      }),
    }
  );
