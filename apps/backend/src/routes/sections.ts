import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween } from "../utils/position";

export const sectionRoutes = new Elysia()
  .use(authMacro)
  // GET /api/v1/lists/:id/sections - get sections for list, ordered by position ASC
  .get(
    "/api/v1/lists/:id/sections",
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

      const sections = await db
        .select()
        .from(schema.sections)
        .where(
          and(
            eq(schema.sections.listId, id),
            eq(schema.sections.userId, user.id),
            isNull(schema.sections.deletedAt)
          )
        )
        .orderBy(asc(schema.sections.position));

      return sections;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /api/v1/lists/:id/sections - create section in list
  .post(
    "/api/v1/lists/:id/sections",
    async ({ user, params: { id }, body, status }) => {
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

      const position = await positionBetween({
        table: schema.sections,
        where: and(
          eq(schema.sections.listId, id),
          eq(schema.sections.userId, user.id)
        ),
      });

      const [section] = await db
        .insert(schema.sections)
        .values({
          userId: user.id,
          listId: id,
          name: body.name.trim(),
          position,
        })
        .returning();

      return status(201, section);
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
      }),
    }
  )
  // GET /api/v1/sections/:id - get single section
  .get(
    "/api/v1/sections/:id",
    async ({ user, params: { id }, status }) => {
      const [section] = await db
        .select()
        .from(schema.sections)
        .where(
          and(
            eq(schema.sections.id, id),
            eq(schema.sections.userId, user.id),
            isNull(schema.sections.deletedAt)
          )
        );

      if (!section) {
        return status(404, { error: "Section not found" });
      }

      return section;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // PATCH /api/v1/sections/:id - update section name
  .patch(
    "/api/v1/sections/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.sections)
        .where(
          and(
            eq(schema.sections.id, id),
            eq(schema.sections.userId, user.id),
            isNull(schema.sections.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Section not found" });
      }

      const [updated] = await db
        .update(schema.sections)
        .set({
          name: body.name.trim(),
          updatedAt: new Date(),
          version: sql`${schema.sections.version} + 1`,
        })
        .where(
          and(
            eq(schema.sections.id, id),
            eq(schema.sections.userId, user.id)
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
        name: t.String({ minLength: 1, maxLength: 100 }),
      }),
    }
  )
  // DELETE /api/v1/sections/:id - soft delete section and nullify tasks section_id
  .delete(
    "/api/v1/sections/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.sections)
        .where(
          and(
            eq(schema.sections.id, id),
            eq(schema.sections.userId, user.id),
            isNull(schema.sections.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Section not found" });
      }

      const now = new Date();

      await db.transaction(async (tx) => {
        // Soft delete section
        await tx
          .update(schema.sections)
          .set({
            deletedAt: now,
            updatedAt: now,
            version: sql`${schema.sections.version} + 1`,
          })
          .where(
            and(
              eq(schema.sections.id, id),
              eq(schema.sections.userId, user.id)
            )
          );

        // Disassociate tasks from this section
        await tx
          .update(schema.tasks)
          .set({
            sectionId: null,
            updatedAt: now,
            version: sql`${schema.tasks.version} + 1`,
          })
          .where(
            and(
              eq(schema.tasks.sectionId, id),
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
  // POST /api/v1/sections/:id/move - move section inside list
  .post(
    "/api/v1/sections/:id/move",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.sections)
        .where(
          and(
            eq(schema.sections.id, id),
            eq(schema.sections.userId, user.id),
            isNull(schema.sections.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Section not found" });
      }

      const newPosition = await positionBetween(
        {
          table: schema.sections,
          where: and(
            eq(schema.sections.listId, existing.listId),
            eq(schema.sections.userId, user.id)
          ),
          excludeId: id,
        },
        body.afterId,
        body.beforeId
      );

      const [updated] = await db
        .update(schema.sections)
        .set({
          position: newPosition,
          updatedAt: new Date(),
          version: sql`${schema.sections.version} + 1`,
        })
        .where(
          and(
            eq(schema.sections.id, id),
            eq(schema.sections.userId, user.id)
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
