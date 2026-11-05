import { Elysia, t } from "elysia";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween, generateNKeysBetween } from "../utils/position";
import { getTaskAncestors } from "../utils/tasks";

export function getPayloadMaxDepth(payload: schema.TemplatePayload): number {
  if (!payload.subtasks || payload.subtasks.length === 0) {
    return 1;
  }
  return 1 + Math.max(...payload.subtasks.map(getPayloadMaxDepth));
}

export function countPayloadNodes(payload: schema.TemplatePayload): number {
  let count = 1;
  if (payload.subtasks) {
    for (const sub of payload.subtasks) {
      count += countPayloadNodes(sub);
    }
  }
  return count;
}

function collectTagNames(payload: schema.TemplatePayload, tagSet: Set<string>): void {
  if (payload.tags) {
    for (const t of payload.tags) {
      const trimmed = t.trim();
      if (trimmed) tagSet.add(trimmed);
    }
  }
  if (payload.subtasks) {
    for (const sub of payload.subtasks) {
      collectTagNames(sub, tagSet);
    }
  }
}

export function validateTemplatePayload(payload: schema.TemplatePayload): { valid: boolean; error?: string } {
  if (!payload || typeof payload !== "object") {
    return { valid: false, error: "Template payload must be an object" };
  }
  if (!payload.title || typeof payload.title !== "string" || !payload.title.trim()) {
    return { valid: false, error: "Template root task title cannot be empty" };
  }
  const totalNodes = countPayloadNodes(payload);
  if (totalNodes > 100) {
    return { valid: false, error: "Template cannot exceed 100 tasks" };
  }
  const maxDepth = getPayloadMaxDepth(payload);
  if (maxDepth > 3) {
    return { valid: false, error: "Template cannot exceed max depth of 3" };
  }
  return { valid: true };
}

const templatePayloadSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: 255 }),
  notes: t.Optional(t.Union([t.String(), t.Null()])),
  priority: t.Optional(t.Number({ minimum: 0, maximum: 4 })),
  estimateMin: t.Optional(t.Union([t.Number({ minimum: 0 }), t.Null()])),
  tags: t.Optional(t.Array(t.String())),
  checklist: t.Optional(t.Array(t.String())),
  subtasks: t.Optional(t.Array(t.Any())),
});

export const templateRoutes = new Elysia({ prefix: "/api/v1/templates" })
  .use(authMacro)
  // GET /api/v1/templates - list user's active templates ordered by createdAt DESC
  .get(
    "/",
    async ({ user }) => {
      const activeTemplates = await db
        .select()
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.userId, user.id),
            isNull(schema.templates.deletedAt)
          )
        )
        .orderBy(desc(schema.templates.createdAt));

      return activeTemplates;
    },
    {
      auth: true,
    }
  )
  // POST /api/v1/templates - create template
  .post(
    "/",
    async ({ user, body, status }) => {
      const trimmedName = body.name?.trim();
      if (!trimmedName) {
        return status(400, { error: "Template name cannot be empty" });
      }

      const validation = validateTemplatePayload(body.payload as schema.TemplatePayload);
      if (!validation.valid) {
        return status(400, { error: validation.error });
      }

      const [created] = await db
        .insert(schema.templates)
        .values({
          userId: user.id,
          name: trimmedName,
          payload: body.payload as schema.TemplatePayload,
          version: 1,
        })
        .returning();

      return status(201, created);
    },
    {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
        payload: templatePayloadSchema,
      }),
    }
  )
  // GET /api/v1/templates/:id - get single template
  .get(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [template] = await db
        .select()
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.id, id),
            eq(schema.templates.userId, user.id),
            isNull(schema.templates.deletedAt)
          )
        );

      if (!template) {
        return status(404, { error: "Template not found" });
      }

      return template;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // PATCH /api/v1/templates/:id - update name or payload
  .patch(
    "/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.id, id),
            eq(schema.templates.userId, user.id),
            isNull(schema.templates.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Template not found" });
      }

      let nextName = existing.name;
      if (body.name !== undefined) {
        const trimmed = body.name.trim();
        if (!trimmed) {
          return status(400, { error: "Template name cannot be empty" });
        }
        nextName = trimmed;
      }

      let nextPayload = existing.payload;
      if (body.payload !== undefined) {
        const validation = validateTemplatePayload(body.payload as schema.TemplatePayload);
        if (!validation.valid) {
          return status(400, { error: validation.error });
        }
        nextPayload = body.payload as schema.TemplatePayload;
      }

      const [updated] = await db
        .update(schema.templates)
        .set({
          name: nextName,
          payload: nextPayload,
          version: sql`${schema.templates.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.templates.id, id),
            eq(schema.templates.userId, user.id)
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
        name: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
        payload: t.Optional(templatePayloadSchema),
      }),
    }
  )
  // DELETE /api/v1/templates/:id - soft delete template
  .delete(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.id, id),
            eq(schema.templates.userId, user.id),
            isNull(schema.templates.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Template not found" });
      }

      await db
        .update(schema.templates)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
          version: sql`${schema.templates.version} + 1`,
        })
        .where(
          and(
            eq(schema.templates.id, id),
            eq(schema.templates.userId, user.id)
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
  // POST /api/v1/templates/:id/instantiate - instantiate template into task tree
  .post(
    "/:id/instantiate",
    async ({ user, params: { id }, body, status }) => {
      // 1. Validate template exists and belongs to user
      const [template] = await db
        .select()
        .from(schema.templates)
        .where(
          and(
            eq(schema.templates.id, id),
            eq(schema.templates.userId, user.id),
            isNull(schema.templates.deletedAt)
          )
        );

      if (!template) {
        return status(404, { error: "Template not found" });
      }

      // 2. Validate list exists and belongs to user
      const [list] = await db
        .select()
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, body.listId),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      if (!list) {
        return status(404, { error: "List not found" });
      }

      // 3. Validate section if specified
      if (body.sectionId) {
        const [section] = await db
          .select()
          .from(schema.sections)
          .where(
            and(
              eq(schema.sections.id, body.sectionId),
              eq(schema.sections.listId, body.listId),
              eq(schema.sections.userId, user.id),
              isNull(schema.sections.deletedAt)
            )
          );

        if (!section) {
          return status(400, { error: "Section not found or does not belong to the target list" });
        }
      }

      // 4. Validate parent task if specified and check max depth
      let parentDepth = 0;
      if (body.parentId) {
        const [parentTask] = await db
          .select()
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.id, body.parentId),
              eq(schema.tasks.listId, body.listId),
              eq(schema.tasks.userId, user.id),
              isNull(schema.tasks.deletedAt)
            )
          );

        if (!parentTask) {
          return status(404, { error: "Parent task not found or does not belong to the target list" });
        }

        const ancestors = getTaskAncestors(body.parentId, user.id);
        parentDepth = ancestors.length;
        const templateDepth = getPayloadMaxDepth(template.payload);
        if (parentDepth + templateDepth > 3) {
          return status(400, {
            error: `Instantiating template under this parent would exceed max depth of 3 (parent depth: ${parentDepth}, template depth: ${templateDepth})`,
          });
        }
      }

      // 5. Position for root task at the end of the target container
      const scopeConditions: SQL[] = [
        eq(schema.tasks.userId, user.id),
        eq(schema.tasks.listId, body.listId),
        isNull(schema.tasks.deletedAt),
      ];
      if (body.sectionId) {
        scopeConditions.push(eq(schema.tasks.sectionId, body.sectionId));
      } else {
        scopeConditions.push(isNull(schema.tasks.sectionId));
      }
      if (body.parentId) {
        scopeConditions.push(eq(schema.tasks.parentId, body.parentId));
      } else {
        scopeConditions.push(isNull(schema.tasks.parentId));
      }

      const rootPosition = await positionBetween(
        {
          table: schema.tasks,
          where: and(...scopeConditions),
        },
        null,
        null
      );

      const now = new Date();

      // 6. Execute instantiation in a single transaction
      const fullInstantiatedTree = await db.transaction(async (tx) => {
        // Find existing tags and create missing ones case-insensitively
        const existingTags = await tx
          .select()
          .from(schema.tags)
          .where(
            and(
              eq(schema.tags.userId, user.id),
              isNull(schema.tags.deletedAt)
            )
          );

        const tagMap = new Map<string, typeof schema.tags.$inferSelect>();
        for (const tag of existingTags) {
          tagMap.set(tag.name.toLowerCase(), tag);
        }

        const tagNames = new Set<string>();
        collectTagNames(template.payload, tagNames);

        for (const name of tagNames) {
          if (!tagMap.has(name.toLowerCase())) {
            const [newTag] = await tx
              .insert(schema.tags)
              .values({
                userId: user.id,
                name,
              })
              .returning();
            tagMap.set(name.toLowerCase(), newTag);
          }
        }

        // Instantiate root task
        const rootId = Bun.randomUUIDv7();
        const rootRow: typeof schema.tasks.$inferInsert = {
          id: rootId,
          userId: user.id,
          listId: body.listId,
          sectionId: body.sectionId ?? null,
          parentId: body.parentId ?? null,
          title: template.payload.title,
          notes: template.payload.notes ?? null,
          status: "todo",
          priority: template.payload.priority ?? 0,
          position: rootPosition,
          estimateMin: template.payload.estimateMin ?? null,
          completedAt: null,
          archivedAt: null,
          version: 1,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        await tx.insert(schema.tasks).values(rootRow);

        // Root tags
        const rootTagObjects: any[] = [];
        if (template.payload.tags && template.payload.tags.length > 0) {
          for (const t of template.payload.tags) {
            const tagRecord = tagMap.get(t.trim().toLowerCase());
            if (tagRecord) {
              await tx.insert(schema.taskTags).values({ taskId: rootId, tagId: tagRecord.id });
              rootTagObjects.push(tagRecord);
            }
          }
        }

        // Root checklist
        const rootChecklistObjects: any[] = [];
        if (template.payload.checklist && template.payload.checklist.length > 0) {
          const clKeys = generateNKeysBetween(null, null, template.payload.checklist.length);
          for (let c = 0; c < template.payload.checklist.length; c++) {
            const clRow: typeof schema.checklistItems.$inferInsert = {
              id: Bun.randomUUIDv7(),
              userId: user.id,
              taskId: rootId,
              text: template.payload.checklist[c],
              done: false,
              position: clKeys[c],
              version: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            };
            await tx.insert(schema.checklistItems).values(clRow);
            rootChecklistObjects.push(clRow);
          }
        }

        // Recursive subtasks
        async function instantiateSubtasks(
          parentTaskId: string,
          subtasksList: schema.TemplatePayload[],
          currentDepth: number
        ): Promise<any[]> {
          if (!subtasksList || subtasksList.length === 0) return [];
          if (currentDepth > 3) return [];

          const keys = generateNKeysBetween(null, null, subtasksList.length);
          const instantiatedChildren: any[] = [];

          for (let i = 0; i < subtasksList.length; i++) {
            const item = subtasksList[i];
            const childId = Bun.randomUUIDv7();
            const childRow: typeof schema.tasks.$inferInsert = {
              id: childId,
              userId: user.id,
              listId: body.listId,
              sectionId: body.sectionId ?? null,
              parentId: parentTaskId,
              title: item.title,
              notes: item.notes ?? null,
              status: "todo",
              priority: item.priority ?? 0,
              position: keys[i],
              estimateMin: item.estimateMin ?? null,
              completedAt: null,
              archivedAt: null,
              version: 1,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            };
            await tx.insert(schema.tasks).values(childRow);

            // Tags
            const childTags: any[] = [];
            if (item.tags && item.tags.length > 0) {
              for (const t of item.tags) {
                const tagRecord = tagMap.get(t.trim().toLowerCase());
                if (tagRecord) {
                  await tx.insert(schema.taskTags).values({ taskId: childId, tagId: tagRecord.id });
                  childTags.push(tagRecord);
                }
              }
            }

            // Checklist
            const childChecklist: any[] = [];
            if (item.checklist && item.checklist.length > 0) {
              const clKeys = generateNKeysBetween(null, null, item.checklist.length);
              for (let c = 0; c < item.checklist.length; c++) {
                const clRow: typeof schema.checklistItems.$inferInsert = {
                  id: Bun.randomUUIDv7(),
                  userId: user.id,
                  taskId: childId,
                  text: item.checklist[c],
                  done: false,
                  position: clKeys[c],
                  version: 1,
                  createdAt: now,
                  updatedAt: now,
                  deletedAt: null,
                };
                await tx.insert(schema.checklistItems).values(clRow);
                childChecklist.push(clRow);
              }
            }

            const nestedChildren = item.subtasks && item.subtasks.length > 0
              ? await instantiateSubtasks(childId, item.subtasks, currentDepth + 1)
              : [];

            instantiatedChildren.push({
              ...childRow,
              tags: childTags,
              checklist: childChecklist,
              subtasks: nestedChildren,
            });
          }

          return instantiatedChildren;
        }

        const rootSubtasks = template.payload.subtasks && template.payload.subtasks.length > 0
          ? await instantiateSubtasks(rootId, template.payload.subtasks, parentDepth + 2)
          : [];

        return {
          ...rootRow,
          tags: rootTagObjects,
          checklist: rootChecklistObjects,
          subtasks: rootSubtasks,
        };
      });

      return status(201, fullInstantiatedTree);
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        listId: t.String(),
        sectionId: t.Optional(t.Union([t.String(), t.Null()])),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    }
  );
