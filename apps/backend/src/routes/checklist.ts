import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween } from "../utils/position";

export const checklistRoutes = new Elysia()
  .use(authMacro)
  // GET /api/v1/tasks/:id/checklist - get checklist items for task, ordered by position ASC
  .get(
    "/api/v1/tasks/:id/checklist",
    async ({ user, params: { id }, status }) => {
      // Verify task exists and belongs to user
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!task) {
        return status(404, { error: "Task not found" });
      }

      const items = await db
        .select()
        .from(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.taskId, id),
            eq(schema.checklistItems.userId, user.id),
            isNull(schema.checklistItems.deletedAt)
          )
        )
        .orderBy(asc(schema.checklistItems.position));

      return items;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /api/v1/tasks/:id/checklist - create checklist item
  .post(
    "/api/v1/tasks/:id/checklist",
    async ({ user, params: { id }, body, status }) => {
      // Verify task exists and belongs to user
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!task) {
        return status(404, { error: "Task not found" });
      }

      const trimmedText = body.text.trim();
      if (!trimmedText) {
        return status(400, { error: "Checklist item text cannot be empty" });
      }

      let position = body.position;
      if (!position) {
        position = await positionBetween(
          {
            table: schema.checklistItems,
            where: and(
              eq(schema.checklistItems.taskId, id),
              eq(schema.checklistItems.userId, user.id)
            ),
          },
          body.afterId,
          body.beforeId
        );
      }

      const [item] = await db
        .insert(schema.checklistItems)
        .values({
          userId: user.id,
          taskId: id,
          text: trimmedText,
          position,
          done: false,
        })
        .returning();

      return status(201, item);
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        text: t.String({ minLength: 1, maxLength: 500 }),
        position: t.Optional(t.String()),
        afterId: t.Optional(t.Union([t.String(), t.Null()])),
        beforeId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    }
  )
  // PATCH /api/v1/checklist/:id - update checklist item text / done status
  .patch(
    "/api/v1/checklist/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.id, id),
            eq(schema.checklistItems.userId, user.id),
            isNull(schema.checklistItems.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Checklist item not found" });
      }

      let nextText = existing.text;
      if (body.text !== undefined) {
        const trimmed = body.text.trim();
        if (!trimmed) {
          return status(400, { error: "Checklist item text cannot be empty" });
        }
        nextText = trimmed;
      }

      const nextDone = body.done !== undefined ? body.done : existing.done;

      const [updated] = await db
        .update(schema.checklistItems)
        .set({
          text: nextText,
          done: nextDone,
          version: sql`${schema.checklistItems.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.checklistItems.id, id),
            eq(schema.checklistItems.userId, user.id)
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
        text: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
        done: t.Optional(t.Boolean()),
      }),
    }
  )
  // DELETE /api/v1/checklist/:id - soft delete checklist item
  .delete(
    "/api/v1/checklist/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.id, id),
            eq(schema.checklistItems.userId, user.id),
            isNull(schema.checklistItems.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Checklist item not found" });
      }

      await db
        .update(schema.checklistItems)
        .set({
          deletedAt: new Date(),
          version: sql`${schema.checklistItems.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.checklistItems.id, id),
            eq(schema.checklistItems.userId, user.id)
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
  )
  // POST /api/v1/checklist/:id/move - move checklist item within task
  .post(
    "/api/v1/checklist/:id/move",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.checklistItems)
        .where(
          and(
            eq(schema.checklistItems.id, id),
            eq(schema.checklistItems.userId, user.id),
            isNull(schema.checklistItems.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Checklist item not found" });
      }

      const newPosition = await positionBetween(
        {
          table: schema.checklistItems,
          where: and(
            eq(schema.checklistItems.taskId, existing.taskId),
            eq(schema.checklistItems.userId, user.id)
          ),
          excludeId: id,
        },
        body.afterId,
        body.beforeId
      );

      const [updated] = await db
        .update(schema.checklistItems)
        .set({
          position: newPosition,
          version: sql`${schema.checklistItems.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.checklistItems.id, id),
            eq(schema.checklistItems.userId, user.id)
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
        afterId: t.Optional(t.Union([t.String(), t.Null()])),
        beforeId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    }
  );
