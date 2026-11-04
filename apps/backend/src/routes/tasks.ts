import { Elysia, t } from "elysia";
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween, generateNKeysBetween } from "../utils/position";
import { decodeCursor, paginateResults } from "../utils/cursor";
import { validateSubtaskHierarchy, getTaskDescendants, runCompleteHooks } from "../utils/tasks";

/**
 * Normalizes notes string:
 * - normalizes \r\n to \n
 * - enforces <= 100KB limit
 */
function normalizeNotes(notes?: string | null): string | null | undefined {
  if (notes === undefined) return undefined;
  if (notes === null) return null;
  const normalized = notes.replace(/\r\n/g, "\n");
  if (Buffer.byteLength(normalized, "utf8") > 100 * 1024) {
    throw new Error("Notes cannot exceed 100KB");
  }
  return normalized;
}

/**
 * Parses date input into a Date object or null
 */
function parseDate(val: any): Date | null | undefined {
  if (val === undefined) return undefined;
  if (val === null || val === "") return null;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Batch loads subtasks, checklist items, and tags in at most 3 queries total.
 * Stitches results in-memory with zero N+1 queries.
 */
export async function attachTaskIncludes<T extends { id: string; userId: string }>(
  taskList: T[],
  includeParam?: string | string[] | null,
  userId?: string
): Promise<Array<T & { subtasks?: any[]; checklist?: any[]; tags?: any[] }>> {
  if (taskList.length === 0 || !includeParam) {
    return taskList;
  }

  const includeParts = (
    Array.isArray(includeParam)
      ? includeParam.join(",")
      : includeParam
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const shouldIncludeSubtasks = includeParts.includes("subtasks");
  const shouldIncludeChecklist = includeParts.includes("checklist");
  const shouldIncludeTags = includeParts.includes("tags");

  if (!shouldIncludeSubtasks && !shouldIncludeChecklist && !shouldIncludeTags) {
    return taskList;
  }

  const taskIds = taskList.map((t) => t.id);
  const effectiveUserId = userId ?? taskList[0].userId;

  const [subtasksRows, checklistRows, tagRows] = await Promise.all([
    shouldIncludeSubtasks
      ? db
          .select()
          .from(schema.tasks)
          .where(
            and(
              inArray(schema.tasks.parentId, taskIds),
              eq(schema.tasks.userId, effectiveUserId),
              isNull(schema.tasks.deletedAt)
            )
          )
          .orderBy(asc(schema.tasks.position), asc(schema.tasks.id))
      : Promise.resolve([]),

    shouldIncludeChecklist
      ? db
          .select()
          .from(schema.checklistItems)
          .where(
            and(
              inArray(schema.checklistItems.taskId, taskIds),
              eq(schema.checklistItems.userId, effectiveUserId),
              isNull(schema.checklistItems.deletedAt)
            )
          )
          .orderBy(asc(schema.checklistItems.position))
      : Promise.resolve([]),

    shouldIncludeTags
      ? db
          .select({
            taskId: schema.taskTags.taskId,
            tag: schema.tags,
          })
          .from(schema.taskTags)
          .innerJoin(schema.tags, eq(schema.taskTags.tagId, schema.tags.id))
          .where(
            and(
              inArray(schema.taskTags.taskId, taskIds),
              eq(schema.tags.userId, effectiveUserId),
              isNull(schema.tags.deletedAt)
            )
          )
          .orderBy(asc(schema.tags.name))
      : Promise.resolve([]),
  ]);

  // Group subtasks by parent task ID
  const subtasksByParent = new Map<string, any[]>();
  for (const st of subtasksRows) {
    if (st.parentId) {
      if (!subtasksByParent.has(st.parentId)) {
        subtasksByParent.set(st.parentId, []);
      }
      subtasksByParent.get(st.parentId)!.push(st);
    }
  }

  // Group checklist items by task ID
  const checklistByTask = new Map<string, any[]>();
  for (const item of checklistRows) {
    if (!checklistByTask.has(item.taskId)) {
      checklistByTask.set(item.taskId, []);
    }
    checklistByTask.get(item.taskId)!.push(item);
  }

  // Group tags by task ID
  const tagsByTask = new Map<string, any[]>();
  for (const row of tagRows) {
    if (!tagsByTask.has(row.taskId)) {
      tagsByTask.set(row.taskId, []);
    }
    tagsByTask.get(row.taskId)!.push(row.tag);
  }

  return taskList.map((task) => ({
    ...task,
    ...(shouldIncludeSubtasks ? { subtasks: subtasksByParent.get(task.id) ?? [] } : {}),
    ...(shouldIncludeChecklist ? { checklist: checklistByTask.get(task.id) ?? [] } : {}),
    ...(shouldIncludeTags ? { tags: tagsByTask.get(task.id) ?? [] } : {}),
  }));
}

export const taskRoutes = new Elysia({ prefix: "/api/v1/tasks" })
  .use(authMacro)
  // GET /api/v1/tasks - list tasks with cursor pagination, filters, and batch includes
  .get(
    "/",
    async ({ user, query, status }) => {
      const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 100);
      const conditions: SQL[] = [
        eq(schema.tasks.userId, user.id),
        isNull(schema.tasks.deletedAt),
      ];

      // Archived filter
      if (query.archived === "true") {
        conditions.push(
          or(
            isNotNull(schema.tasks.archivedAt),
            sql`EXISTS (SELECT 1 FROM lists WHERE lists.id = tasks.list_id AND lists.archived_at IS NOT NULL)`
          )!
        );
      } else {
        conditions.push(isNull(schema.tasks.archivedAt));
        conditions.push(
          sql`NOT EXISTS (SELECT 1 FROM lists WHERE lists.id = tasks.list_id AND lists.archived_at IS NOT NULL)`
        );
      }

      // List filter
      if (query.listId) {
        conditions.push(eq(schema.tasks.listId, query.listId));
      }

      // Section filter
      if (query.sectionId !== undefined) {
        if (query.sectionId === "null" || query.sectionId === "") {
          conditions.push(isNull(schema.tasks.sectionId));
        } else {
          conditions.push(eq(schema.tasks.sectionId, query.sectionId));
        }
      }

      // Parent ID filter (subtasks vs top-level)
      if (query.parentId !== undefined && query.parentId !== "all") {
        if (query.parentId === "null" || query.parentId === "") {
          conditions.push(isNull(schema.tasks.parentId));
        } else {
          conditions.push(eq(schema.tasks.parentId, query.parentId));
        }
      }

      // Status filter
      if (query.status) {
        conditions.push(eq(schema.tasks.status, query.status as any));
      }

      // Tag filter (by tag ID or tag name)
      if (query.tag) {
        const matchingTagTasks = await db
          .select({ taskId: schema.taskTags.taskId })
          .from(schema.taskTags)
          .innerJoin(schema.tags, eq(schema.taskTags.tagId, schema.tags.id))
          .where(
            and(
              eq(schema.tags.userId, user.id),
              isNull(schema.tags.deletedAt),
              or(
                eq(schema.tags.id, query.tag),
                sql`lower(${schema.tags.name}) = lower(${query.tag})`
              )
            )
          );

        const taskIds = matchingTagTasks.map((t) => t.taskId);
        if (taskIds.length === 0) {
          return { items: [], nextCursor: null, hasMore: false };
        }
        conditions.push(inArray(schema.tasks.id, taskIds));
      }

      // Cursor keyset filter on (position, id)
      const decodedCursor = decodeCursor(query.cursor);
      if (decodedCursor) {
        conditions.push(
          or(
            gt(schema.tasks.position, decodedCursor.position),
            and(
              eq(schema.tasks.position, decodedCursor.position),
              gt(schema.tasks.id, decodedCursor.id)
            )
          )!
        );
      }

      // Query limit + 1 items to determine if hasMore is true
      const rawTasks = await db
        .select()
        .from(schema.tasks)
        .where(and(...conditions))
        .orderBy(asc(schema.tasks.position), asc(schema.tasks.id))
        .limit(limit + 1);

      const paginated = paginateResults(rawTasks, limit);

      // Batch load includes if requested
      const itemsWithIncludes = await attachTaskIncludes(
        paginated.items,
        query.include,
        user.id
      );

      return {
        items: itemsWithIncludes,
        nextCursor: paginated.nextCursor,
        hasMore: paginated.hasMore,
      };
    },
    {
      auth: true,
      query: t.Object({
        limit: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        listId: t.Optional(t.String()),
        sectionId: t.Optional(t.String()),
        parentId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        tag: t.Optional(t.String()),
        archived: t.Optional(t.String()),
        include: t.Optional(t.String()),
      }),
    }
  )
  // POST /api/v1/tasks - create task
  .post(
    "/",
    async ({ user, body, status }) => {
      const trimmedTitle = body.title.trim();
      if (!trimmedTitle) {
        return status(400, { error: "Title cannot be empty" });
      }

      let normalizedNotesText: string | null = null;
      try {
        normalizedNotesText = normalizeNotes(body.notes) ?? null;
      } catch (err: any) {
        return status(400, { error: err.message });
      }

      let finalListId = body.listId;
      const finalParentId = body.parentId ?? null;

      // Validate subtask hierarchy & depth <= 3
      if (finalParentId) {
        const validation = validateSubtaskHierarchy(user.id, null, finalParentId);
        if (!validation.valid) {
          return status(validation.statusCode ?? 400, { error: validation.error });
        }
        // Subtask always inherits parent's listId
        finalListId = validation.parent!.listId;
      } else {
        // Top-level task requires listId
        if (!finalListId) {
          return status(400, { error: "listId is required for top-level tasks" });
        }
        // Verify list exists and belongs to user
        const [list] = await db
          .select()
          .from(schema.lists)
          .where(
            and(
              eq(schema.lists.id, finalListId),
              eq(schema.lists.userId, user.id),
              isNull(schema.lists.deletedAt)
            )
          );
        if (!list) {
          return status(404, { error: "List not found" });
        }
      }

      // Verify sectionId if specified
      const finalSectionId = body.sectionId ?? null;
      if (finalSectionId) {
        const [section] = await db
          .select()
          .from(schema.sections)
          .where(
            and(
              eq(schema.sections.id, finalSectionId),
              eq(schema.sections.userId, user.id),
              eq(schema.sections.listId, finalListId),
              isNull(schema.sections.deletedAt)
            )
          );
        if (!section) {
          return status(404, { error: "Section not found or does not belong to list" });
        }
      }

      // Verify tagIds if provided
      if (body.tagIds && body.tagIds.length > 0) {
        const userTags = await db
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(
            and(
              eq(schema.tags.userId, user.id),
              inArray(schema.tags.id, body.tagIds),
              isNull(schema.tags.deletedAt)
            )
          );
        if (userTags.length !== body.tagIds.length) {
          return status(400, { error: "One or more tag IDs are invalid" });
        }
      }

      // Calculate position within scope
      const positionConditions = [
        eq(schema.tasks.userId, user.id),
        eq(schema.tasks.listId, finalListId),
        isNull(schema.tasks.deletedAt),
      ];
      if (finalParentId) {
        positionConditions.push(eq(schema.tasks.parentId, finalParentId));
      } else {
        positionConditions.push(isNull(schema.tasks.parentId));
      }
      if (finalSectionId) {
        positionConditions.push(eq(schema.tasks.sectionId, finalSectionId));
      } else {
        positionConditions.push(isNull(schema.tasks.sectionId));
      }

      let position = body.position;
      if (!position) {
        position = await positionBetween(
          {
            table: schema.tasks,
            where: and(...positionConditions),
          },
          body.afterId,
          body.beforeId
        );
      }

      // Insert task in transaction
      const task = await db.transaction(async (tx) => {
        const [newTask] = await tx
          .insert(schema.tasks)
          .values({
            userId: user.id,
            listId: finalListId,
            sectionId: finalSectionId,
            parentId: finalParentId,
            title: trimmedTitle,
            notes: normalizedNotesText,
            priority: body.priority ?? 0,
            status: body.status ?? "todo",
            position,
            startAt: parseDate(body.startAt) ?? null,
            dueAt: parseDate(body.dueAt) ?? null,
            deadlineAt: parseDate(body.deadlineAt) ?? null,
            allDay: body.allDay ?? false,
            estimateMin: body.estimateMin ?? null,
            completedAt: body.status === "done" ? new Date() : null,
          })
          .returning();

        if (body.tagIds && body.tagIds.length > 0) {
          await tx.insert(schema.taskTags).values(
            body.tagIds.map((tagId) => ({
              taskId: newTask.id,
              tagId,
            }))
          );
        }

        return newTask;
      });

      // Optionally attach includes if tags were linked
      const [result] = await attachTaskIncludes([task], "tags", user.id);
      return status(201, result);
    },
    {
      auth: true,
      body: t.Object({
        title: t.String({ minLength: 1, maxLength: 500 }),
        listId: t.Optional(t.String()),
        sectionId: t.Optional(t.Union([t.String(), t.Null()])),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
        notes: t.Optional(t.Union([t.String(), t.Null()])),
        priority: t.Optional(t.Integer({ minimum: 0, maximum: 4 })),
        status: t.Optional(
          t.Union([
            t.Literal("todo"),
            t.Literal("in_progress"),
            t.Literal("done"),
            t.Literal("cancelled"),
          ])
        ),
        position: t.Optional(t.String()),
        afterId: t.Optional(t.Union([t.String(), t.Null()])),
        beforeId: t.Optional(t.Union([t.String(), t.Null()])),
        startAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        dueAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        deadlineAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        allDay: t.Optional(t.Boolean()),
        estimateMin: t.Optional(t.Union([t.Integer(), t.Null()])),
        tagIds: t.Optional(t.Array(t.String())),
      }),
    }
  )
  // POST /api/v1/tasks/bulk - execute batch transactional operations across tasks
  .post(
    "/bulk",
    async ({ user, body, status }) => {
      const { ids, action, payload } = body;
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) {
        return status(400, { error: "ids must be a non-empty array with at most 200 IDs" });
      }

      const uniqueIds = Array.from(new Set(ids));
      if (uniqueIds.length !== ids.length) {
        return status(400, { error: "ids array contains duplicate IDs" });
      }

      return await db.transaction(async (tx) => {
        // Query all matching tasks
        const existingTasks = await tx
          .select()
          .from(schema.tasks)
          .where(
            and(
              inArray(schema.tasks.id, ids),
              eq(schema.tasks.userId, user.id),
              isNull(schema.tasks.deletedAt)
            )
          );

        const foundMap = new Set(existingTasks.map((t) => t.id));
        const missingIds = ids.filter((id) => !foundMap.has(id));

        if (missingIds.length > 0) {
          return status(404, {
            error: "One or more tasks not found",
            missingIds,
          });
        }

        const taskMap = new Map(existingTasks.map((t) => [t.id, t]));

        switch (action) {
          case "move": {
            let targetParentId: string | null = null;
            let targetListId: string = existingTasks[0].listId;
            let targetSectionId: string | null = null;

            // Handle parentId
            if (payload?.parentId !== undefined && payload.parentId !== null) {
              if (ids.includes(payload.parentId)) {
                return status(400, { error: "A task cannot be moved under one of the moving tasks" });
              }

              const [parentTask] = await tx
                .select()
                .from(schema.tasks)
                .where(
                  and(
                    eq(schema.tasks.id, payload.parentId),
                    eq(schema.tasks.userId, user.id),
                    isNull(schema.tasks.deletedAt)
                  )
                );

              if (!parentTask) {
                return status(404, { error: "Target parent task not found" });
              }

              // Validate hierarchy for each moving task
              for (const taskId of ids) {
                const validation = validateSubtaskHierarchy(user.id, taskId, payload.parentId);
                if (!validation.valid) {
                  return status(validation.statusCode ?? 400, { error: validation.error });
                }
              }

              targetParentId = payload.parentId;
              targetListId = parentTask.listId;
            } else {
              targetParentId = null;
              if (payload?.listId) {
                const [targetList] = await tx
                  .select()
                  .from(schema.lists)
                  .where(
                    and(
                      eq(schema.lists.id, payload.listId),
                      eq(schema.lists.userId, user.id),
                      isNull(schema.lists.deletedAt)
                    )
                  );

                if (!targetList) {
                  return status(404, { error: "Target list not found" });
                }
                targetListId = payload.listId;
              } else {
                targetListId = existingTasks[0].listId;
              }
            }

            // Handle sectionId
            if (payload?.sectionId !== undefined && payload.sectionId !== null && payload.sectionId !== "") {
              const [targetSec] = await tx
                .select()
                .from(schema.sections)
                .where(
                  and(
                    eq(schema.sections.id, payload.sectionId),
                    eq(schema.sections.userId, user.id),
                    eq(schema.sections.listId, targetListId),
                    isNull(schema.sections.deletedAt)
                  )
                );

              if (!targetSec) {
                return status(404, { error: "Section not found or does not belong to target list" });
              }
              targetSectionId = payload.sectionId;
            } else {
              targetSectionId = null;
            }

            // Query existing tasks in target scope to find last position
            const scopeConditions = [
              eq(schema.tasks.userId, user.id),
              eq(schema.tasks.listId, targetListId),
              isNull(schema.tasks.deletedAt),
            ];
            if (targetParentId) {
              scopeConditions.push(eq(schema.tasks.parentId, targetParentId));
            } else {
              scopeConditions.push(isNull(schema.tasks.parentId));
            }
            if (targetSectionId) {
              scopeConditions.push(eq(schema.tasks.sectionId, targetSectionId));
            } else {
              scopeConditions.push(isNull(schema.tasks.sectionId));
            }

            const existingInScope = await tx
              .select({ id: schema.tasks.id, position: schema.tasks.position })
              .from(schema.tasks)
              .where(
                and(
                  ...scopeConditions,
                  notInArray(schema.tasks.id, ids)
                )
              )
              .orderBy(asc(schema.tasks.position));

            const lastPos = existingInScope.length > 0 ? (existingInScope[existingInScope.length - 1].position as string) : null;
            const newPositions = generateNKeysBetween(lastPos, null, ids.length);

            const now = new Date();
            for (let i = 0; i < ids.length; i++) {
              const taskId = ids[i];
              const oldTask = taskMap.get(taskId)!;
              const shouldUpdateDescendants = oldTask.listId !== targetListId;

              if (shouldUpdateDescendants) {
                const descendants = getTaskDescendants(taskId, user.id);
                if (descendants.length > 0) {
                  const descIds = descendants.map((d) => d.id);
                  await tx
                    .update(schema.tasks)
                    .set({
                      listId: targetListId,
                      version: sql`${schema.tasks.version} + 1`,
                      updatedAt: now,
                    })
                    .where(
                      and(
                        inArray(schema.tasks.id, descIds),
                        eq(schema.tasks.userId, user.id)
                      )
                    );
                }
              }

              await tx
                .update(schema.tasks)
                .set({
                  position: newPositions[i],
                  listId: targetListId,
                  sectionId: targetSectionId,
                  parentId: targetParentId,
                  version: sql`${schema.tasks.version} + 1`,
                  updatedAt: now,
                })
                .where(
                  and(
                    eq(schema.tasks.id, taskId),
                    eq(schema.tasks.userId, user.id)
                  )
                );
            }

            return { success: true, count: ids.length, action: "move" };
          }

          case "tag": {
            const tagIdsToAdd: string[] = [];
            if (payload?.tagId) tagIdsToAdd.push(payload.tagId);
            if (Array.isArray(payload?.tagIds)) tagIdsToAdd.push(...payload.tagIds);
            const uniqueTagIds = Array.from(new Set(tagIdsToAdd));
            if (uniqueTagIds.length === 0) {
              return status(400, { error: "tagId or tagIds is required" });
            }

            const matchingTags = await tx
              .select({ id: schema.tags.id })
              .from(schema.tags)
              .where(
                and(
                  inArray(schema.tags.id, uniqueTagIds),
                  eq(schema.tags.userId, user.id),
                  isNull(schema.tags.deletedAt)
                )
              );

            if (matchingTags.length !== uniqueTagIds.length) {
              return status(400, { error: "One or more tag IDs are invalid" });
            }

            const pairs = ids.flatMap((taskId) =>
              uniqueTagIds.map((tagId) => ({ taskId, tagId }))
            );

            if (pairs.length > 0) {
              await tx
                .insert(schema.taskTags)
                .values(pairs)
                .onConflictDoNothing();
            }

            const now = new Date();
            await tx
              .update(schema.tasks)
              .set({
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(schema.tasks.id, ids),
                  eq(schema.tasks.userId, user.id)
                )
              );

            return { success: true, count: ids.length, action: "tag" };
          }

          case "untag": {
            const tagIdsToRemove: string[] = [];
            if (payload?.tagId) tagIdsToRemove.push(payload.tagId);
            if (Array.isArray(payload?.tagIds)) tagIdsToRemove.push(...payload.tagIds);
            const uniqueTagIds = Array.from(new Set(tagIdsToRemove));
            if (uniqueTagIds.length === 0) {
              return status(400, { error: "tagId or tagIds is required" });
            }

            await tx
              .delete(schema.taskTags)
              .where(
                and(
                  inArray(schema.taskTags.taskId, ids),
                  inArray(schema.taskTags.tagId, uniqueTagIds)
                )
              );

            const now = new Date();
            await tx
              .update(schema.tasks)
              .set({
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(schema.tasks.id, ids),
                  eq(schema.tasks.userId, user.id)
                )
              );

            return { success: true, count: ids.length, action: "untag" };
          }

          case "complete": {
            const completeSubtasks = Boolean(payload?.completeSubtasks);
            const now = new Date();
            const targetTaskIds = new Set(ids);

            if (completeSubtasks) {
              for (const taskId of ids) {
                const descendants = getTaskDescendants(taskId, user.id);
                for (const d of descendants) {
                  targetTaskIds.add(d.id);
                }
              }
            }

            const allTaskIdsArray = Array.from(targetTaskIds);

            await tx
              .update(schema.tasks)
              .set({
                status: "done",
                completedAt: now,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(schema.tasks.id, allTaskIdsArray),
                  eq(schema.tasks.userId, user.id)
                )
              );

            const completedTasks = await tx
              .select()
              .from(schema.tasks)
              .where(
                and(
                  inArray(schema.tasks.id, ids),
                  eq(schema.tasks.userId, user.id)
                )
              );

            for (const task of completedTasks) {
              await runCompleteHooks(task);
            }

            return { success: true, count: ids.length, action: "complete" };
          }

          case "reopen": {
            const now = new Date();
            await tx
              .update(schema.tasks)
              .set({
                status: "todo",
                completedAt: null,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(schema.tasks.id, ids),
                  eq(schema.tasks.userId, user.id)
                )
              );

            return { success: true, count: ids.length, action: "reopen" };
          }

          case "archive": {
            const now = new Date();
            const nowMs = now.getTime();
            const placeholders = ids.map(() => "?").join(",");
            sqlite.run(
              `WITH RECURSIVE sub(id) AS (
                SELECT id FROM tasks WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL
                UNION ALL
                SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ? AND t.deleted_at IS NULL AND t.archived_at IS NULL
              )
              UPDATE tasks
              SET archived_at = ?, updated_at = ?, version = version + 1
              WHERE id IN (SELECT id FROM sub) AND (id IN (${placeholders}) OR archived_at IS NULL);`,
              [...ids, user.id, user.id, nowMs, nowMs, ...ids]
            );

            return { success: true, count: ids.length, action: "archive" };
          }

          case "delete": {
            const now = new Date();
            const nowMs = now.getTime();
            const placeholders = ids.map(() => "?").join(",");
            sqlite.run(
              `WITH RECURSIVE sub(id) AS (
                SELECT id FROM tasks WHERE id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL
                UNION ALL
                SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ? AND t.deleted_at IS NULL
              )
              UPDATE tasks
              SET deleted_at = ?, updated_at = ?, version = version + 1
              WHERE id IN (SELECT id FROM sub);`,
              [...ids, user.id, user.id, nowMs, nowMs]
            );

            return { success: true, count: ids.length, action: "delete" };
          }

          case "set_priority": {
            const priority = payload?.priority;
            if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0 || priority > 4) {
              return status(400, { error: "Priority must be an integer between 0 and 4" });
            }

            const now = new Date();
            await tx
              .update(schema.tasks)
              .set({
                priority,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: now,
              })
              .where(
                and(
                  inArray(schema.tasks.id, ids),
                  eq(schema.tasks.userId, user.id)
                )
              );

            return { success: true, count: ids.length, action: "set_priority" };
          }

          default:
            return status(400, { error: "Unsupported bulk action" });
        }
      });
    },
    {
      auth: true,
      body: t.Object({
        ids: t.Array(t.String(), { minItems: 1, maxItems: 200 }),
        action: t.Union([
          t.Literal("move"),
          t.Literal("tag"),
          t.Literal("untag"),
          t.Literal("complete"),
          t.Literal("reopen"),
          t.Literal("archive"),
          t.Literal("delete"),
          t.Literal("set_priority"),
        ]),
        payload: t.Optional(t.Any()),
      }),
    }
  )
  // GET /api/v1/tasks/:id - get single task with optional includes
  .get(
    "/:id",
    async ({ user, params: { id }, query, status }) => {
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

      const [withIncludes] = await attachTaskIncludes([task], query.include, user.id);
      return withIncludes;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        include: t.Optional(t.String()),
      }),
    }
  )
  // PATCH /api/v1/tasks/:id - update task
  .patch(
    "/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      // Title validation
      let nextTitle = existing.title;
      if (body.title !== undefined) {
        const trimmed = body.title.trim();
        if (!trimmed) {
          return status(400, { error: "Title cannot be empty" });
        }
        nextTitle = trimmed;
      }

      // Notes normalization & limit
      let nextNotes = existing.notes;
      if (body.notes !== undefined) {
        try {
          nextNotes = normalizeNotes(body.notes) ?? null;
        } catch (err: any) {
          return status(400, { error: err.message });
        }
      }

      let nextListId = existing.listId;
      let nextParentId = existing.parentId;
      let shouldUpdateDescendantList = false;

      // Handle parentId update (and hierarchy validation)
      if (body.parentId !== undefined) {
        const targetParentId = body.parentId ?? null;
        const validation = validateSubtaskHierarchy(user.id, id, targetParentId);
        if (!validation.valid) {
          return status(validation.statusCode ?? 400, { error: validation.error });
        }

        nextParentId = targetParentId;
        if (targetParentId) {
          nextListId = validation.parent!.listId;
          shouldUpdateDescendantList = nextListId !== existing.listId;
        }
      }

      // Handle listId update when not locked by parent
      if (body.listId !== undefined && body.listId !== existing.listId) {
        if (nextParentId) {
          // If task has a parent, listId must match parent
          return status(400, { error: "Subtasks must belong to the same list as their parent" });
        }
        const [targetList] = await db
          .select()
          .from(schema.lists)
          .where(
            and(
              eq(schema.lists.id, body.listId),
              eq(schema.lists.userId, user.id),
              isNull(schema.lists.deletedAt)
            )
          );
        if (!targetList) {
          return status(404, { error: "Target list not found" });
        }
        nextListId = body.listId;
        shouldUpdateDescendantList = true;
      }

      // Handle sectionId update
      let nextSectionId = existing.sectionId;
      if (body.sectionId !== undefined) {
        if (body.sectionId === null || body.sectionId === "") {
          nextSectionId = null;
        } else {
          const [sec] = await db
            .select()
            .from(schema.sections)
            .where(
              and(
                eq(schema.sections.id, body.sectionId),
                eq(schema.sections.userId, user.id),
                eq(schema.sections.listId, nextListId),
                isNull(schema.sections.deletedAt)
              )
            );
          if (!sec) {
            return status(404, { error: "Section not found or does not belong to task's list" });
          }
          nextSectionId = body.sectionId;
        }
      }

      // Handle status and completedAt
      const nextStatus = body.status !== undefined ? body.status : existing.status;
      let nextCompletedAt = existing.completedAt;
      if (body.completedAt !== undefined) {
        nextCompletedAt = parseDate(body.completedAt) ?? null;
      } else if (body.status !== undefined) {
        if (body.status === "done" && existing.status !== "done") {
          nextCompletedAt = new Date();
        } else if (body.status !== "done" && existing.status === "done") {
          nextCompletedAt = null;
        }
      }

      // Handle archivedAt
      let nextArchivedAt = existing.archivedAt;
      if (body.archivedAt !== undefined) {
        nextArchivedAt = parseDate(body.archivedAt) ?? null;
      }

      // Perform update in transaction
      const updated = await db.transaction(async (tx) => {
        // If listId changed, cascade listId to all descendants
        if (shouldUpdateDescendantList) {
          const descendants = getTaskDescendants(id, user.id);
          if (descendants.length > 0) {
            await tx
              .update(schema.tasks)
              .set({
                listId: nextListId,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  inArray(schema.tasks.id, descendants.map((d) => d.id)),
                  eq(schema.tasks.userId, user.id)
                )
              );
          }
        }

        const [res] = await tx
          .update(schema.tasks)
          .set({
            title: nextTitle,
            notes: nextNotes,
            listId: nextListId,
            sectionId: nextSectionId,
            parentId: nextParentId,
            priority: body.priority !== undefined ? body.priority : existing.priority,
            status: nextStatus,
            position: body.position !== undefined ? body.position : existing.position,
            startAt: body.startAt !== undefined ? (parseDate(body.startAt) ?? null) : existing.startAt,
            dueAt: body.dueAt !== undefined ? (parseDate(body.dueAt) ?? null) : existing.dueAt,
            deadlineAt: body.deadlineAt !== undefined ? (parseDate(body.deadlineAt) ?? null) : existing.deadlineAt,
            allDay: body.allDay !== undefined ? body.allDay : existing.allDay,
            estimateMin: body.estimateMin !== undefined ? body.estimateMin : existing.estimateMin,
            completedAt: nextCompletedAt,
            archivedAt: nextArchivedAt,
            version: sql`${schema.tasks.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tasks.id, id),
              eq(schema.tasks.userId, user.id)
            )
          )
          .returning();

        return res;
      });

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        title: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
        notes: t.Optional(t.Union([t.String(), t.Null()])),
        listId: t.Optional(t.String()),
        sectionId: t.Optional(t.Union([t.String(), t.Null()])),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
        priority: t.Optional(t.Integer({ minimum: 0, maximum: 4 })),
        status: t.Optional(
          t.Union([
            t.Literal("todo"),
            t.Literal("in_progress"),
            t.Literal("done"),
            t.Literal("cancelled"),
          ])
        ),
        position: t.Optional(t.String()),
        startAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        dueAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        deadlineAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        allDay: t.Optional(t.Boolean()),
        estimateMin: t.Optional(t.Union([t.Integer(), t.Null()])),
        completedAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
        archivedAt: t.Optional(t.Union([t.String(), t.Integer(), t.Null()])),
      }),
    }
  )
  // DELETE /api/v1/tasks/:id - soft delete task and its descendants
  .delete(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      const now = new Date();
      const nowMs = now.getTime();

      sqlite.run(
        `WITH RECURSIVE sub(id) AS (
          SELECT id FROM tasks WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
          UNION ALL
          SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ?2 AND t.deleted_at IS NULL
        )
        UPDATE tasks
        SET deleted_at = ?3, updated_at = ?3, version = version + 1
        WHERE id IN (SELECT id FROM sub);`,
        [id, user.id, nowMs]
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
  // POST /api/v1/tasks/:id/move - move task between positions/sections/lists
  .post(
    "/:id/move",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      let nextListId = existing.listId;
      let nextParentId = existing.parentId;
      let nextSectionId = existing.sectionId;
      let shouldUpdateDescendantList = false;

      // Parent ID change check
      if (body.parentId !== undefined) {
        const targetParentId = body.parentId ?? null;
        const validation = validateSubtaskHierarchy(user.id, id, targetParentId);
        if (!validation.valid) {
          return status(validation.statusCode ?? 400, { error: validation.error });
        }
        nextParentId = targetParentId;
        if (targetParentId) {
          nextListId = validation.parent!.listId;
          shouldUpdateDescendantList = nextListId !== existing.listId;
        }
      }

      // List ID change check
      if (body.listId !== undefined && body.listId !== existing.listId) {
        if (nextParentId) {
          return status(400, { error: "Subtasks must belong to the same list as their parent" });
        }
        const [targetList] = await db
          .select()
          .from(schema.lists)
          .where(
            and(
              eq(schema.lists.id, body.listId),
              eq(schema.lists.userId, user.id),
              isNull(schema.lists.deletedAt)
            )
          );
        if (!targetList) {
          return status(404, { error: "Target list not found" });
        }
        nextListId = body.listId;
        shouldUpdateDescendantList = true;
      }

      // If moving to a different listId and sectionId is not explicitly provided, reset sectionId to null
      if (nextListId !== existing.listId && body.sectionId === undefined) {
        nextSectionId = null;
      }

      // Section ID change check
      if (body.sectionId !== undefined) {
        if (body.sectionId === null || body.sectionId === "") {
          nextSectionId = null;
        } else {
          const [sec] = await db
            .select()
            .from(schema.sections)
            .where(
              and(
                eq(schema.sections.id, body.sectionId),
                eq(schema.sections.userId, user.id),
                eq(schema.sections.listId, nextListId),
                isNull(schema.sections.deletedAt)
              )
            );
          if (!sec) {
            return status(404, { error: "Section not found or does not belong to target list" });
          }
          nextSectionId = body.sectionId;
        }
      }

      // Determine scope for new position
      const scopeConditions = [
        eq(schema.tasks.userId, user.id),
        eq(schema.tasks.listId, nextListId),
        isNull(schema.tasks.deletedAt),
      ];
      if (nextParentId) {
        scopeConditions.push(eq(schema.tasks.parentId, nextParentId));
      } else {
        scopeConditions.push(isNull(schema.tasks.parentId));
      }
      if (nextSectionId) {
        scopeConditions.push(eq(schema.tasks.sectionId, nextSectionId));
      } else {
        scopeConditions.push(isNull(schema.tasks.sectionId));
      }

      const newPosition = await positionBetween(
        {
          table: schema.tasks,
          where: and(...scopeConditions),
          excludeId: id,
        },
        body.afterId,
        body.beforeId
      );

      const updated = await db.transaction(async (tx) => {
        if (shouldUpdateDescendantList) {
          const descendants = getTaskDescendants(id, user.id);
          if (descendants.length > 0) {
            await tx
              .update(schema.tasks)
              .set({
                listId: nextListId,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  inArray(schema.tasks.id, descendants.map((d) => d.id)),
                  eq(schema.tasks.userId, user.id)
                )
              );
          }
        }

        const [res] = await tx
          .update(schema.tasks)
          .set({
            position: newPosition,
            listId: nextListId,
            sectionId: nextSectionId,
            parentId: nextParentId,
            version: sql`${schema.tasks.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tasks.id, id),
              eq(schema.tasks.userId, user.id)
            )
          )
          .returning();

        return res;
      });

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
        listId: t.Optional(t.String()),
        sectionId: t.Optional(t.Union([t.String(), t.Null()])),
        parentId: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    }
  )
  // PUT /api/v1/tasks/:id/tags - replace task tags set
  .put(
    "/:id/tags",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      // Verify all tagIds belong to user
      const uniqueTagIds = [...new Set(body.tagIds)];
      if (uniqueTagIds.length > 0) {
        const userTags = await db
          .select({ id: schema.tags.id })
          .from(schema.tags)
          .where(
            and(
              eq(schema.tags.userId, user.id),
              inArray(schema.tags.id, uniqueTagIds),
              isNull(schema.tags.deletedAt)
            )
          );

        if (userTags.length !== uniqueTagIds.length) {
          return status(400, { error: "One or more tag IDs are invalid or belong to another user" });
        }
      }

      // Replace tag associations inside a single transaction
      await db.transaction(async (tx) => {
        // Delete all existing tag mappings for this task
        await tx
          .delete(schema.taskTags)
          .where(eq(schema.taskTags.taskId, id));

        // Insert new mappings
        if (uniqueTagIds.length > 0) {
          await tx.insert(schema.taskTags).values(
            uniqueTagIds.map((tagId) => ({
              taskId: id,
              tagId,
            }))
          );
        }

        // Bump task version
        await tx
          .update(schema.tasks)
          .set({
            version: sql`${schema.tasks.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.tasks.id, id),
              eq(schema.tasks.userId, user.id)
            )
          );
      });

      // Return updated task with tags included
      const [updatedTask] = await db
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, id));

      const [withTags] = await attachTaskIncludes([updatedTask], "tags", user.id);
      return withTags;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        tagIds: t.Array(t.String()),
      }),
    }
  )
  // POST /api/v1/tasks/:id/complete - complete task with optional subtask cascading and onComplete hooks
  .post(
    "/:id/complete",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      const completeSubtasks = Boolean(body?.completeSubtasks);
      const completedAt = new Date();

      const updatedTask = await db.transaction(async (tx) => {
        if (completeSubtasks) {
          const descendants = getTaskDescendants(id, user.id);
          if (descendants.length > 0) {
            const descendantIds = descendants.map((d) => d.id);
            await tx
              .update(schema.tasks)
              .set({
                status: "done",
                completedAt,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: completedAt,
              })
              .where(
                and(
                  inArray(schema.tasks.id, descendantIds),
                  eq(schema.tasks.userId, user.id)
                )
              );
          }
        }

        const [updated] = await tx
          .update(schema.tasks)
          .set({
            status: "done",
            completedAt,
            version: sql`${schema.tasks.version} + 1`,
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(schema.tasks.id, id),
              eq(schema.tasks.userId, user.id)
            )
          )
          .returning();

        return updated;
      });

      await runCompleteHooks(updatedTask);

      return updatedTask;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Optional(
        t.Object({
          completeSubtasks: t.Optional(t.Boolean()),
        })
      ),
    }
  )
  // POST /api/v1/tasks/:id/reopen - reopen completed task (descendants/ancestors unaffected)
  .post(
    "/:id/reopen",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      const updatedAt = new Date();
      const [updated] = await db
        .update(schema.tasks)
        .set({
          status: "todo",
          completedAt: null,
          version: sql`${schema.tasks.version} + 1`,
          updatedAt,
        })
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id)
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
  // POST /api/v1/tasks/:id/archive - archive task and its unarchived descendants
  .post(
    "/:id/archive",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      const now = new Date();
      const nowMs = now.getTime();

      sqlite.run(
        `WITH RECURSIVE sub(id) AS (
          SELECT id FROM tasks WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
          UNION ALL
          SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ?2 AND t.deleted_at IS NULL AND t.archived_at IS NULL
        )
        UPDATE tasks
        SET archived_at = ?3, updated_at = ?3, version = version + 1
        WHERE id IN (SELECT id FROM sub) AND (id = ?1 OR archived_at IS NULL);`,
        [id, user.id, nowMs]
      );

      const [updated] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id)
          )
        );

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /api/v1/tasks/:id/unarchive - unarchive task and descendants with exact same stamp
  .post(
    "/:id/unarchive",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Task not found" });
      }

      if (!existing.archivedAt) {
        return existing;
      }

      const targetStamp = existing.archivedAt.getTime();
      const now = new Date();
      const nowMs = now.getTime();

      sqlite.run(
        `WITH RECURSIVE sub(id) AS (
          SELECT id FROM tasks WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
          UNION ALL
          SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ?2 AND t.deleted_at IS NULL
        )
        UPDATE tasks
        SET archived_at = NULL, updated_at = ?4, version = version + 1
        WHERE id IN (SELECT id FROM sub) AND archived_at = ?3;`,
        [id, user.id, targetStamp, nowMs]
      );

      const [updated] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id)
          )
        );

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  )
  // POST /api/v1/tasks/:id/duplicate - deep duplication with old->new ID map, position right after original
  .post(
    "/:id/duplicate",
    async ({ user, params: { id }, status }) => {
      const [original] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!original) {
        return status(404, { error: "Task not found" });
      }

      // 1. Fetch all descendants
      const descendants = getTaskDescendants(original.id, user.id);
      const descendantIds = descendants.map((d) => d.id);

      let descendantTasks: Array<typeof schema.tasks.$inferSelect> = [];
      if (descendantIds.length > 0) {
        descendantTasks = await db
          .select()
          .from(schema.tasks)
          .where(
            and(
              inArray(schema.tasks.id, descendantIds),
              eq(schema.tasks.userId, user.id),
              isNull(schema.tasks.deletedAt)
            )
          )
          .orderBy(asc(schema.tasks.position));

        const depthMap = new Map(descendants.map((d) => [d.id, d.subtreeDepth]));
        descendantTasks.sort((a, b) => (depthMap.get(a.id) ?? 0) - (depthMap.get(b.id) ?? 0));
      }

      // 2. Prepare old -> new ID map
      const oldToNewId = new Map<string, string>();
      const rootNewId = Bun.randomUUIDv7();
      oldToNewId.set(original.id, rootNewId);

      for (const dt of descendantTasks) {
        oldToNewId.set(dt.id, Bun.randomUUIDv7());
      }

      const allOldTaskIds = [original.id, ...descendantTasks.map((t) => t.id)];

      // 3. Fetch checklist items and tags
      const oldChecklistItems = await db
        .select()
        .from(schema.checklistItems)
        .where(
          and(
            inArray(schema.checklistItems.taskId, allOldTaskIds),
            eq(schema.checklistItems.userId, user.id),
            isNull(schema.checklistItems.deletedAt)
          )
        )
        .orderBy(asc(schema.checklistItems.position));

      const oldTaskTags = await db
        .select({
          taskId: schema.taskTags.taskId,
          tagId: schema.taskTags.tagId,
          tag: schema.tags,
        })
        .from(schema.taskTags)
        .innerJoin(schema.tags, eq(schema.taskTags.tagId, schema.tags.id))
        .where(
          and(
            inArray(schema.taskTags.taskId, allOldTaskIds),
            eq(schema.tags.userId, user.id),
            isNull(schema.tags.deletedAt)
          )
        )
        .orderBy(asc(schema.tags.name));

      // 4. Calculate position right after original in the same container scope
      const scopeConditions: SQL[] = [
        eq(schema.tasks.userId, user.id),
        eq(schema.tasks.listId, original.listId),
        isNull(schema.tasks.deletedAt),
      ];
      if (original.sectionId) {
        scopeConditions.push(eq(schema.tasks.sectionId, original.sectionId));
      } else {
        scopeConditions.push(isNull(schema.tasks.sectionId));
      }
      if (original.parentId) {
        scopeConditions.push(eq(schema.tasks.parentId, original.parentId));
      } else {
        scopeConditions.push(isNull(schema.tasks.parentId));
      }

      const newRootPosition = await positionBetween(
        {
          table: schema.tasks,
          where: and(...scopeConditions),
        },
        original.id,
        null
      );

      const now = new Date();

      // 5. Build entities to insert
      const newRootTask: typeof schema.tasks.$inferInsert = {
        id: rootNewId,
        userId: user.id,
        listId: original.listId,
        sectionId: original.sectionId,
        parentId: original.parentId,
        title: `${original.title} (copy)`,
        notes: original.notes,
        status: "todo",
        priority: original.priority,
        position: newRootPosition,
        startAt: original.startAt,
        dueAt: original.dueAt,
        deadlineAt: original.deadlineAt,
        allDay: original.allDay,
        estimateMin: original.estimateMin,
        recurrenceId: null,
        locationName: original.locationName,
        lat: original.lat,
        lng: original.lng,
        radiusM: original.radiusM,
        locationTrigger: original.locationTrigger,
        completedAt: null,
        archivedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };

      const newDescendantTasks: Array<typeof schema.tasks.$inferInsert> = descendantTasks.map((dt) => ({
        id: oldToNewId.get(dt.id)!,
        userId: user.id,
        listId: dt.listId,
        sectionId: dt.sectionId,
        parentId: dt.parentId ? oldToNewId.get(dt.parentId)! : null,
        title: dt.title,
        notes: dt.notes,
        status: "todo",
        priority: dt.priority,
        position: dt.position,
        startAt: dt.startAt,
        dueAt: dt.dueAt,
        deadlineAt: dt.deadlineAt,
        allDay: dt.allDay,
        estimateMin: dt.estimateMin,
        recurrenceId: null,
        locationName: dt.locationName,
        lat: dt.lat,
        lng: dt.lng,
        radiusM: dt.radiusM,
        locationTrigger: dt.locationTrigger,
        completedAt: null,
        archivedAt: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }));

      const newChecklistItems: Array<typeof schema.checklistItems.$inferInsert> = oldChecklistItems.map((item) => ({
        id: Bun.randomUUIDv7(),
        userId: user.id,
        taskId: oldToNewId.get(item.taskId)!,
        text: item.text,
        done: false,
        position: item.position,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }));

      const newTaskTags = oldTaskTags.map((tt) => ({
        taskId: oldToNewId.get(tt.taskId)!,
        tagId: tt.tagId,
      }));

      // 6. Execute in single transaction
      await db.transaction(async (tx) => {
        await tx.insert(schema.tasks).values(newRootTask);

        if (newDescendantTasks.length > 0) {
          await tx.insert(schema.tasks).values(newDescendantTasks);
        }

        if (newChecklistItems.length > 0) {
          await tx.insert(schema.checklistItems).values(newChecklistItems);
        }

        if (newTaskTags.length > 0) {
          await tx.insert(schema.taskTags).values(newTaskTags);
        }
      });

      // 7. Assemble response tree
      const checklistByNewTaskId = new Map<string, any[]>();
      for (const item of newChecklistItems) {
        if (!checklistByNewTaskId.has(item.taskId)) {
          checklistByNewTaskId.set(item.taskId, []);
        }
        checklistByNewTaskId.get(item.taskId)!.push(item);
      }

      const tagsByNewTaskId = new Map<string, any[]>();
      for (const row of oldTaskTags) {
        const newTaskId = oldToNewId.get(row.taskId)!;
        if (!tagsByNewTaskId.has(newTaskId)) {
          tagsByNewTaskId.set(newTaskId, []);
        }
        tagsByNewTaskId.get(newTaskId)!.push(row.tag);
      }

      const childrenByParent = new Map<string, any[]>();
      for (const dt of newDescendantTasks) {
        if (dt.parentId) {
          if (!childrenByParent.has(dt.parentId)) {
            childrenByParent.set(dt.parentId, []);
          }
          childrenByParent.get(dt.parentId)!.push(dt);
        }
      }

      function buildTree(node: any): any {
        const children = childrenByParent.get(node.id) ?? [];
        return {
          ...node,
          checklist: checklistByNewTaskId.get(node.id) ?? [],
          tags: tagsByNewTaskId.get(node.id) ?? [],
          subtasks: children.map(buildTree),
        };
      }

      const tree = buildTree(newRootTask);
      return status(201, tree);
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  );
