import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";

export const tagRoutes = new Elysia({ prefix: "/api/v1/tags" })
  .use(authMacro)
  // GET /api/v1/tags - list user's active tags ordered by name ASC
  .get(
    "/",
    async ({ user }) => {
      const tags = await db
        .select()
        .from(schema.tags)
        .where(
          and(
            eq(schema.tags.userId, user.id),
            isNull(schema.tags.deletedAt)
          )
        )
        .orderBy(asc(schema.tags.name));

      return tags;
    },
    {
      auth: true,
    }
  )
  // POST /api/v1/tags - create tag (case-insensitive duplicate check)
  .post(
    "/",
    async ({ user, body, status }) => {
      const trimmedName = body.name.trim();
      if (!trimmedName) {
        return status(400, { error: "Tag name cannot be empty" });
      }

      // Check case-insensitive duplicate per user among active tags
      const [existing] = await db
        .select()
        .from(schema.tags)
        .where(
          and(
            eq(schema.tags.userId, user.id),
            sql`lower(${schema.tags.name}) = lower(${trimmedName})`,
            isNull(schema.tags.deletedAt)
          )
        );

      if (existing) {
        return status(409, { error: "Tag with this name already exists" });
      }

      const [tag] = await db
        .insert(schema.tags)
        .values({
          userId: user.id,
          name: trimmedName,
          color: body.color ?? null,
        })
        .returning();

      return status(201, tag);
    },
    {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        color: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
      }),
    }
  )
  // PATCH /api/v1/tags/:id - update tag
  .patch(
    "/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tags)
        .where(
          and(
            eq(schema.tags.id, id),
            eq(schema.tags.userId, user.id),
            isNull(schema.tags.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Tag not found" });
      }

      let nextName = existing.name;
      if (body.name !== undefined) {
        const trimmed = body.name.trim();
        if (!trimmed) {
          return status(400, { error: "Tag name cannot be empty" });
        }
        nextName = trimmed;

        // Check duplicate if name has changed
        const [conflict] = await db
          .select()
          .from(schema.tags)
          .where(
            and(
              eq(schema.tags.userId, user.id),
              ne(schema.tags.id, id),
              sql`lower(${schema.tags.name}) = lower(${trimmed})`,
              isNull(schema.tags.deletedAt)
            )
          );

        if (conflict) {
          return status(409, { error: "Tag with this name already exists" });
        }
      }

      const [updated] = await db
        .update(schema.tags)
        .set({
          name: nextName,
          color: body.color !== undefined ? body.color : existing.color,
          version: sql`${schema.tags.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.tags.id, id),
            eq(schema.tags.userId, user.id)
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
        color: t.Optional(t.Union([t.String({ maxLength: 50 }), t.Null()])),
      }),
    }
  )
  // DELETE /api/v1/tags/:id - soft delete tag
  .delete(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tags)
        .where(
          and(
            eq(schema.tags.id, id),
            eq(schema.tags.userId, user.id),
            isNull(schema.tags.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Tag not found" });
      }

      await db
        .update(schema.tags)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: sql`${schema.tags.version} + 1`,
        })
        .where(
          and(
            eq(schema.tags.id, id),
            eq(schema.tags.userId, user.id)
          )
        );

      return { success: true };
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  );
