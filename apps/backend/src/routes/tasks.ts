import { Elysia, t } from "elysia";
import { and, asc, eq, gt, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { positionBetween, generateNKeysBetween } from "../utils/position";
import { decodeCursor, paginateResults } from "../utils/cursor";
import { validateSubtaskHierarchy, getTaskDescendants, runCompleteHooks, getTasksWithIncludes } from "../utils/tasks";
import { toUtcMidnight, validateStartDue, validateEstimateMin, validateLocationCoords } from "../utils/dates";
import { recomputeTaskReminders, firePendingTaskReminders, calculateRelativeRemindAt } from "../services/reminders";
import { spawnNextRecurrenceInstance } from "../services/recurrence";
import { parseNaturalLanguage, type ParsedTaskResult } from "../utils/parser";
import { notifyUserChanged } from "../utils/sync-publisher";

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
 * Batch loads subtasks, checklist items, tags, and computes estimateTotal rollup (root estimate + all descendant estimates)
 */
export const attachTaskIncludes = getTasksWithIncludes;

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
      if (decodedCursor && decodedCursor.position) {
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

      // Validate tagIds if provided
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

      // Dates and floating all-day rule
      const finalAllDay = body.allDay ?? false;
      let finalStartAt = parseDate(body.startAt) ?? null;
      let finalDueAt = parseDate(body.dueAt) ?? null;
      let finalDeadlineAt = parseDate(body.deadlineAt) ?? null;

      if (finalAllDay) {
        if (finalDueAt) finalDueAt = toUtcMidnight(finalDueAt);
        if (finalStartAt) finalStartAt = toUtcMidnight(finalStartAt);
        if (finalDeadlineAt) finalDeadlineAt = toUtcMidnight(finalDeadlineAt);
      }

      const dateValidation = validateStartDue(finalStartAt, finalDueAt);
      if (!dateValidation.valid) {
        return status(400, { error: dateValidation.error });
      }

      if (body.estimateMin !== undefined && body.estimateMin !== null) {
        const estValidation = validateEstimateMin(body.estimateMin);
        if (!estValidation.valid) {
          return status(400, { error: estValidation.error });
        }
      }

      const locValidation = validateLocationCoords(body.lat, body.lng, body.radiusM);
      if (!locValidation.valid) {
        return status(400, { error: locValidation.error });
      }

      let finalPlaceId = body.placeId ?? null;
      if (finalPlaceId) {
        const [place] = await db
          .select()
          .from(schema.places)
          .where(
            and(
              eq(schema.places.id, finalPlaceId),
              eq(schema.places.userId, user.id),
              isNull(schema.places.deletedAt)
            )
          );
        if (!place) {
          return status(404, { error: "Place not found" });
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
            startAt: finalStartAt,
            dueAt: finalDueAt,
            deadlineAt: finalDeadlineAt,
            allDay: finalAllDay,
            estimateMin: body.estimateMin ?? null,
            placeId: finalPlaceId,
            locationName: body.locationName ?? null,
            lat: body.lat ?? null,
            lng: body.lng ?? null,
            radiusM: body.radiusM ?? (body.lat ? 200 : null),
            locationTrigger: body.locationTrigger ?? null,
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
      notifyUserChanged(user.id);
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
        placeId: t.Optional(t.Union([t.String(), t.Null()])),
        locationName: t.Optional(t.Union([t.String(), t.Null()])),
        lat: t.Optional(t.Union([t.Number(), t.Null()])),
        lng: t.Optional(t.Union([t.Number(), t.Null()])),
        radiusM: t.Optional(t.Union([t.Integer(), t.Null()])),
        locationTrigger: t.Optional(
          t.Union([t.Literal("arrive"), t.Literal("leave"), t.Null()])
        ),
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
              await firePendingTaskReminders(task.id, user.id, tx);
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
  // POST /api/v1/tasks/parse - parse task text into structured components
  .post(
    "/parse",
    async ({ user, body, status }) => {
      const userLists = await db
        .select({ id: schema.lists.id, name: schema.lists.name, isInbox: schema.lists.isInbox })
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      const [userInfo] = await db
        .select({ timezone: schema.users.timezone })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      const timezone = body.timezone || userInfo?.timezone || "UTC";

      try {
        const parsed = parseNaturalLanguage(body.text, userLists, timezone);
        return parsed;
      } catch (err: any) {
        if (err.message === "EMPTY_TITLE") {
          return status(422, {
            error: "EMPTY_TITLE",
            message: "Title cannot be empty after parsing",
          });
        }
        return status(400, { error: err.message });
      }
    },
    {
      auth: true,
      body: t.Object({
        text: t.String(),
        timezone: t.Optional(t.String()),
      }),
    }
  )
  // POST /api/v1/tasks/quick - parse and create task with tags, reminders, recurrence in ONE atomic transaction
  .post(
    "/quick",
    async ({ user, body, status }) => {
      const userLists = await db
        .select({ id: schema.lists.id, name: schema.lists.name, isInbox: schema.lists.isInbox })
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      const [userInfo] = await db
        .select({ timezone: schema.users.timezone, preferences: schema.users.preferences })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      const timezone = body.timezone || userInfo?.timezone || "UTC";
      const defaultReminderTime = userInfo?.preferences?.defaultReminderTime || "09:00";

      let parsed: ParsedTaskResult;
      try {
        parsed = parseNaturalLanguage(body.text, userLists, timezone);
      } catch (err: any) {
        if (err.message === "EMPTY_TITLE") {
          return status(422, {
            error: "EMPTY_TITLE",
            message: "Title cannot be empty after parsing",
          });
        }
        return status(400, { error: err.message });
      }

      // Determine listId
      let finalListId = parsed.list?.id;
      if (!finalListId && body.listId) {
        finalListId = body.listId;
      }
      if (!finalListId) {
        const inbox = userLists.find((l) => l.isInbox) || userLists[0];
        if (!inbox) {
          return status(400, { error: "No available list found for task" });
        }
        finalListId = inbox.id;
      }

      // Execute in ONE atomic transaction
      const now = new Date();
      const createdTask = await db.transaction(async (tx) => {
        // Calculate position in list
        const position = await positionBetween(
          {
            table: schema.tasks,
            where: and(
              eq(schema.tasks.userId, user.id),
              eq(schema.tasks.listId, finalListId),
              isNull(schema.tasks.parentId),
              isNull(schema.tasks.deletedAt)
            ),
          },
          null,
          null
        );

        const newTaskId = Bun.randomUUIDv7();

        // Recurrence
        let recId: string | null = null;
        if (parsed.recurrence) {
          recId = Bun.randomUUIDv7();
          await tx.insert(schema.recurrences).values({
            id: recId,
            userId: user.id,
            rrule: parsed.recurrence.rrule,
            mode: parsed.recurrence.mode,
            timezone,
            dtstart: parsed.dueAt || now,
            completedCount: 0,
            active: true,
            version: 1,
            createdAt: now,
            updatedAt: now,
          });
        }

        // Insert task
        const [newTask] = await tx
          .insert(schema.tasks)
          .values({
            id: newTaskId,
            userId: user.id,
            listId: finalListId,
            sectionId: null,
            parentId: null,
            title: parsed.title,
            priority: parsed.priority,
            status: "todo",
            position,
            startAt: null,
            dueAt: parsed.dueAt,
            deadlineAt: null,
            allDay: parsed.allDay,
            estimateMin: parsed.estimateMin,
            recurrenceId: recId,
            version: 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning();

        // Tags: automatically find or create
        if (parsed.tags.length > 0) {
          for (const tagName of parsed.tags) {
            const [existingTag] = await tx
              .select({ id: schema.tags.id })
              .from(schema.tags)
              .where(
                and(
                  eq(schema.tags.userId, user.id),
                  sql`lower(${schema.tags.name}) = lower(${tagName})`,
                  isNull(schema.tags.deletedAt)
                )
              );

            let tagId = existingTag?.id;
            if (!tagId) {
              const [createdTag] = await tx
                .insert(schema.tags)
                .values({
                  userId: user.id,
                  name: tagName,
                  version: 1,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning();
              tagId = createdTag.id;
            }

            await tx
              .insert(schema.taskTags)
              .values({
                taskId: newTaskId,
                tagId,
              })
              .onConflictDoNothing();
          }
        }

        // Reminders
        if (parsed.reminders.length > 0) {
          for (const rem of parsed.reminders) {
            let remindAt: Date;
            let firedAt: Date | null = null;

            if (rem.kind === "absolute") {
              remindAt = rem.remindAt || new Date(now.getTime() + 60 * 60 * 1000);
            } else {
              const relRes = calculateRelativeRemindAt({
                anchorDate: parsed.dueAt,
                offsetMin: rem.offsetMin ?? 0,
                allDay: parsed.allDay,
                userTimezone: timezone,
                defaultReminderTime,
                now,
              });
              remindAt = relRes.remindAt;
              firedAt = relRes.firedAt;
            }

            await tx.insert(schema.reminders).values({
              userId: user.id,
              taskId: newTaskId,
              kind: rem.kind,
              relativeTo: rem.relativeTo ?? "due",
              offsetMin: rem.offsetMin ?? 0,
              remindAt,
              firedAt,
              version: 1,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        return newTask;
      });

      const [withIncludes] = await attachTaskIncludes([createdTask], ["tags", "subtasks", "checklist"], user.id);
      notifyUserChanged(user.id);
      return status(201, withIncludes);
    },
    {
      auth: true,
      body: t.Object({
        text: t.String(),
        listId: t.Optional(t.String()),
        timezone: t.Optional(t.String()),
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

      // Handle dates and floating all-day rule
      const nextAllDay = body.allDay !== undefined ? body.allDay : Boolean(existing.allDay);
      let nextStartAt = body.startAt !== undefined ? (parseDate(body.startAt) ?? null) : existing.startAt;
      let nextDueAt = body.dueAt !== undefined ? (parseDate(body.dueAt) ?? null) : existing.dueAt;
      let nextDeadlineAt = body.deadlineAt !== undefined ? (parseDate(body.deadlineAt) ?? null) : existing.deadlineAt;

      if (nextAllDay) {
        if (body.dueAt !== undefined && body.dueAt !== null) {
          nextDueAt = toUtcMidnight(body.dueAt);
        } else if (nextDueAt && body.allDay === true && !existing.allDay) {
          nextDueAt = toUtcMidnight(nextDueAt);
        }
        if (body.startAt !== undefined && body.startAt !== null) {
          nextStartAt = toUtcMidnight(body.startAt);
        } else if (nextStartAt && body.allDay === true && !existing.allDay) {
          nextStartAt = toUtcMidnight(nextStartAt);
        }
        if (body.deadlineAt !== undefined && body.deadlineAt !== null) {
          nextDeadlineAt = toUtcMidnight(body.deadlineAt);
        } else if (nextDeadlineAt && body.allDay === true && !existing.allDay) {
          nextDeadlineAt = toUtcMidnight(nextDeadlineAt);
        }
      }

      const dateValidation = validateStartDue(nextStartAt, nextDueAt);
      if (!dateValidation.valid) {
        return status(400, { error: dateValidation.error });
      }

      const nextEstimateMin = body.estimateMin !== undefined ? body.estimateMin : existing.estimateMin;
      if (nextEstimateMin !== undefined && nextEstimateMin !== null) {
        const estValidation = validateEstimateMin(nextEstimateMin);
        if (!estValidation.valid) {
          return status(400, { error: estValidation.error });
        }
      }

      const nextLat = body.lat !== undefined ? body.lat : existing.lat;
      const nextLng = body.lng !== undefined ? body.lng : existing.lng;
      const nextRadiusM = body.radiusM !== undefined ? body.radiusM : existing.radiusM;
      const locValidation = validateLocationCoords(nextLat, nextLng, nextRadiusM);
      if (!locValidation.valid) {
        return status(400, { error: locValidation.error });
      }

      let nextPlaceId = existing.placeId;
      if (body.placeId !== undefined) {
        if (body.placeId === null || body.placeId === "") {
          nextPlaceId = null;
        } else {
          const [place] = await db
            .select()
            .from(schema.places)
            .where(
              and(
                eq(schema.places.id, body.placeId),
                eq(schema.places.userId, user.id),
                isNull(schema.places.deletedAt)
              )
            );
          if (!place) {
            return status(404, { error: "Place not found" });
          }
          nextPlaceId = body.placeId;
        }
      }

      const nextLocationName = body.locationName !== undefined ? body.locationName : existing.locationName;
      const nextLocationTrigger = body.locationTrigger !== undefined ? body.locationTrigger : existing.locationTrigger;

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

        const datesChanged =
          (body.dueAt !== undefined && nextDueAt?.getTime() !== existing.dueAt?.getTime()) ||
          (body.startAt !== undefined && nextStartAt?.getTime() !== existing.startAt?.getTime()) ||
          (body.deadlineAt !== undefined && nextDeadlineAt?.getTime() !== existing.deadlineAt?.getTime()) ||
          (body.allDay !== undefined && nextAllDay !== existing.allDay);

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
            startAt: nextStartAt,
            dueAt: nextDueAt,
            deadlineAt: nextDeadlineAt,
            allDay: nextAllDay,
            estimateMin: nextEstimateMin,
            placeId: nextPlaceId,
            locationName: nextLocationName,
            lat: nextLat,
            lng: nextLng,
            radiusM: nextRadiusM,
            locationTrigger: nextLocationTrigger,
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

        if (datesChanged) {
          await recomputeTaskReminders(id, user.id, { task: res, tx });
        }

        return res;
      });

      const [withIncludes] = await attachTaskIncludes([updated], null, user.id);
      notifyUserChanged(user.id);
      return withIncludes;
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
        placeId: t.Optional(t.Union([t.String(), t.Null()])),
        locationName: t.Optional(t.Union([t.String(), t.Null()])),
        lat: t.Optional(t.Union([t.Number(), t.Null()])),
        lng: t.Optional(t.Union([t.Number(), t.Null()])),
        radiusM: t.Optional(t.Union([t.Integer(), t.Null()])),
        locationTrigger: t.Optional(
          t.Union([t.Literal("arrive"), t.Literal("leave"), t.Null()])
        ),
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

      // Deleting open recurring task deactivates series
      if (existing.recurrenceId) {
        await db
          .update(schema.recurrences)
          .set({
            active: false,
            version: sql`${schema.recurrences.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.recurrences.id, existing.recurrenceId),
              eq(schema.recurrences.userId, user.id)
            )
          );
      }

      notifyUserChanged(user.id);
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

      notifyUserChanged(user.id);
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
              eq(schema.tasks.userId, user.id),
              ne(schema.tasks.status, "done")
            )
          )
          .returning();

        if (!updated) {
          // Double-tap safe: already completed, return current state without spawning
          const [alreadyDone] = await tx
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.id, id),
                eq(schema.tasks.userId, user.id)
              )
            );
          return { task: alreadyDone, nextTask: null, alreadyDone: true };
        }

        await firePendingTaskReminders(id, user.id, tx);

        // Spawn next recurrence instance if recurring
        const nextTask = await spawnNextRecurrenceInstance({
          taskId: id,
          userId: user.id,
          isSkip: false,
          tx,
          now: completedAt,
        });

        return { task: updated, nextTask, alreadyDone: false };
      });

      if (!updatedTask.alreadyDone) {
        await runCompleteHooks(updatedTask.task);
      }

      return {
        ...updatedTask.task,
        nextTask: updatedTask.nextTask,
      };
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
  // POST /api/v1/tasks/:id/skip - cancel current task instance and spawn next recurrence instance without incrementing completedCount
  .post(
    "/:id/skip",
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

      if (existing.status === "cancelled" || existing.status === "done") {
        return status(400, { error: "Task is already completed or cancelled" });
      }

      const now = new Date();

      const result = await db.transaction(async (tx) => {
        const [cancelled] = await tx
          .update(schema.tasks)
          .set({
            status: "cancelled",
            version: sql`${schema.tasks.version} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.tasks.id, id),
              eq(schema.tasks.userId, user.id),
              ne(schema.tasks.status, "cancelled"),
              ne(schema.tasks.status, "done")
            )
          )
          .returning();

        if (!cancelled) {
          return null;
        }

        await firePendingTaskReminders(id, user.id, tx);

        // Spawn next instance without incrementing completedCount
        const nextTask = await spawnNextRecurrenceInstance({
          taskId: id,
          userId: user.id,
          isSkip: true,
          tx,
          now,
        });

        return { task: cancelled, nextTask };
      });

      if (!result) {
        return status(400, { error: "Task could not be skipped" });
      }

      return {
        ...result.task,
        nextTask: result.nextTask,
      };
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
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
  )
  // POST /api/v1/tasks/:id/save-as-template - snapshot task tree to template (capped at 100 nodes, depth 3)
  .post(
    "/:id/save-as-template",
    async ({ user, params: { id }, body, status }) => {
      const trimmedName = body.name?.trim();
      if (!trimmedName) {
        return status(400, { error: "Template name cannot be empty" });
      }

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

      // Check hierarchy depth and node cap
      const descendants = getTaskDescendants(task.id, user.id);
      const totalNodes = 1 + descendants.length;
      if (totalNodes > 100) {
        return status(400, { error: "Task tree exceeds maximum template node cap of 100" });
      }

      const maxSubtreeDepth = descendants.length > 0
        ? Math.max(...descendants.map((d) => d.subtreeDepth))
        : 0;

      // Depth: 1 (root) + maxSubtreeDepth
      const totalDepth = 1 + maxSubtreeDepth;
      if (totalDepth > 3) {
        return status(400, { error: "Task hierarchy exceeds maximum template depth of 3" });
      }

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
      }

      const allTaskIds = [task.id, ...descendantIds];

      const allChecklistItems = await db
        .select()
        .from(schema.checklistItems)
        .where(
          and(
            inArray(schema.checklistItems.taskId, allTaskIds),
            eq(schema.checklistItems.userId, user.id),
            isNull(schema.checklistItems.deletedAt)
          )
        )
        .orderBy(asc(schema.checklistItems.position));

      const allTaskTags = await db
        .select({
          taskId: schema.taskTags.taskId,
          tagName: schema.tags.name,
        })
        .from(schema.taskTags)
        .innerJoin(schema.tags, eq(schema.taskTags.tagId, schema.tags.id))
        .where(
          and(
            inArray(schema.taskTags.taskId, allTaskIds),
            eq(schema.tags.userId, user.id),
            isNull(schema.tags.deletedAt)
          )
        )
        .orderBy(asc(schema.tags.name));

      const checklistByTaskId = new Map<string, string[]>();
      for (const item of allChecklistItems) {
        if (!checklistByTaskId.has(item.taskId)) {
          checklistByTaskId.set(item.taskId, []);
        }
        checklistByTaskId.get(item.taskId)!.push(item.text);
      }

      const tagsByTaskId = new Map<string, string[]>();
      for (const tt of allTaskTags) {
        if (!tagsByTaskId.has(tt.taskId)) {
          tagsByTaskId.set(tt.taskId, []);
        }
        tagsByTaskId.get(tt.taskId)!.push(tt.tagName);
      }

      const childrenByParent = new Map<string, Array<typeof schema.tasks.$inferSelect>>();
      for (const dt of descendantTasks) {
        if (dt.parentId) {
          if (!childrenByParent.has(dt.parentId)) {
            childrenByParent.set(dt.parentId, []);
          }
          childrenByParent.get(dt.parentId)!.push(dt);
        }
      }

      function buildTemplatePayload(node: typeof schema.tasks.$inferSelect): schema.TemplatePayload {
        const payload: schema.TemplatePayload = {
          title: node.title,
        };
        if (node.notes) payload.notes = node.notes;
        if (node.priority !== undefined && node.priority !== null && node.priority !== 0) {
          payload.priority = node.priority;
        }
        if (node.estimateMin !== undefined && node.estimateMin !== null) {
          payload.estimateMin = node.estimateMin;
        }
        const nodeTags = tagsByTaskId.get(node.id);
        if (nodeTags && nodeTags.length > 0) {
          payload.tags = nodeTags;
        }
        const nodeChecklist = checklistByTaskId.get(node.id);
        if (nodeChecklist && nodeChecklist.length > 0) {
          payload.checklist = nodeChecklist;
        }
        const children = childrenByParent.get(node.id);
        if (children && children.length > 0) {
          payload.subtasks = children.map(buildTemplatePayload);
        }
        return payload;
      }

      const rootPayload = buildTemplatePayload(task);

      const [createdTemplate] = await db
        .insert(schema.templates)
        .values({
          userId: user.id,
          name: trimmedName,
          payload: rootPayload,
          version: 1,
        })
        .returning();

      return status(201, createdTemplate);
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 255 }),
      }),
    }
  );
