import { Elysia, t } from "elysia";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";

export const trashRoutes = new Elysia({ prefix: "/api/v1/trash" })
  .use(authMacro)
  // GET /api/v1/trash?type= - list soft-deleted items (grouped or filtered)
  .get(
    "/",
    async ({ user, query, status }) => {
      const type = query.type;

      if (type && !["task", "list", "folder", "section"].includes(type)) {
        return status(400, { error: "Invalid type. Must be task, list, folder, or section" });
      }

      if (type === "task") {
        const tasks = await db
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.userId, user.id), isNotNull(schema.tasks.deletedAt)))
          .orderBy(desc(schema.tasks.deletedAt));
        return tasks;
      }

      if (type === "list") {
        const lists = await db
          .select()
          .from(schema.lists)
          .where(and(eq(schema.lists.userId, user.id), isNotNull(schema.lists.deletedAt)))
          .orderBy(desc(schema.lists.deletedAt));
        return lists;
      }

      if (type === "folder") {
        const folders = await db
          .select()
          .from(schema.folders)
          .where(and(eq(schema.folders.userId, user.id), isNotNull(schema.folders.deletedAt)))
          .orderBy(desc(schema.folders.deletedAt));
        return folders;
      }

      if (type === "section") {
        const sections = await db
          .select()
          .from(schema.sections)
          .where(and(eq(schema.sections.userId, user.id), isNotNull(schema.sections.deletedAt)))
          .orderBy(desc(schema.sections.deletedAt));
        return sections;
      }

      // Grouped when type is omitted
      const [tasks, lists, folders, sections] = await Promise.all([
        db
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.userId, user.id), isNotNull(schema.tasks.deletedAt)))
          .orderBy(desc(schema.tasks.deletedAt)),
        db
          .select()
          .from(schema.lists)
          .where(and(eq(schema.lists.userId, user.id), isNotNull(schema.lists.deletedAt)))
          .orderBy(desc(schema.lists.deletedAt)),
        db
          .select()
          .from(schema.folders)
          .where(and(eq(schema.folders.userId, user.id), isNotNull(schema.folders.deletedAt)))
          .orderBy(desc(schema.folders.deletedAt)),
        db
          .select()
          .from(schema.sections)
          .where(and(eq(schema.sections.userId, user.id), isNotNull(schema.sections.deletedAt)))
          .orderBy(desc(schema.sections.deletedAt)),
      ]);

      return {
        tasks,
        lists,
        folders,
        sections,
      };
    },
    {
      auth: true,
      query: t.Object({
        type: t.Optional(t.String()),
      }),
    }
  )
  // DELETE /api/v1/trash - empty trash (permanently delete all soft-deleted items)
  .delete(
    "/",
    async ({ user }) => {
      await db.transaction(async (tx) => {
        // Hard-delete leaf to root: tasks -> sections -> lists (except inbox) -> folders
        await tx
          .delete(schema.tasks)
          .where(and(eq(schema.tasks.userId, user.id), isNotNull(schema.tasks.deletedAt)));

        await tx
          .delete(schema.sections)
          .where(and(eq(schema.sections.userId, user.id), isNotNull(schema.sections.deletedAt)));

        await tx
          .delete(schema.lists)
          .where(
            and(
              eq(schema.lists.userId, user.id),
              isNotNull(schema.lists.deletedAt),
              eq(schema.lists.isInbox, false)
            )
          );

        await tx
          .delete(schema.folders)
          .where(and(eq(schema.folders.userId, user.id), isNotNull(schema.folders.deletedAt)));
      });

      return { success: true };
    },
    {
      auth: true,
    }
  )
  // POST /api/v1/trash/:type/:id/restore - restore item from trash
  .post(
    "/:type/:id/restore",
    async ({ user, params: { type, id }, status }) => {
      if (!["task", "list", "folder", "section"].includes(type)) {
        return status(400, { error: "Invalid type. Must be task, list, folder, or section" });
      }

      const now = new Date();
      const nowMs = now.getTime();

      switch (type) {
        case "task": {
          const [existing] = await db
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.id, id),
                eq(schema.tasks.userId, user.id),
                isNotNull(schema.tasks.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "Task not found in trash" });
          }

          const targetStamp = existing.deletedAt!.getTime();

          // Check if destination list exists and is active
          let targetListId = existing.listId;
          let targetSectionId = existing.sectionId;
          let targetParentId = existing.parentId;

          const [activeList] = await db
            .select()
            .from(schema.lists)
            .where(
              and(
                eq(schema.lists.id, existing.listId),
                eq(schema.lists.userId, user.id),
                isNull(schema.lists.deletedAt)
              )
            );

          if (!activeList) {
            // Land in user's active Inbox list
            const [inbox] = await db
              .select()
              .from(schema.lists)
              .where(
                and(
                  eq(schema.lists.userId, user.id),
                  eq(schema.lists.isInbox, true),
                  isNull(schema.lists.deletedAt)
                )
              );

            if (!inbox) {
              return status(500, { error: "Inbox list not found" });
            }

            targetListId = inbox.id;
            targetSectionId = null;
            targetParentId = null;
          } else {
            // List is active: verify section if specified
            if (targetSectionId) {
              const [activeSection] = await db
                .select()
                .from(schema.sections)
                .where(
                  and(
                    eq(schema.sections.id, targetSectionId),
                    eq(schema.sections.userId, user.id),
                    isNull(schema.sections.deletedAt)
                  )
                );
              if (!activeSection) {
                targetSectionId = null;
              }
            }

            // Verify parent if specified
            if (targetParentId) {
              const [activeParent] = await db
                .select()
                .from(schema.tasks)
                .where(
                  and(
                    eq(schema.tasks.id, targetParentId),
                    eq(schema.tasks.userId, user.id),
                    isNull(schema.tasks.deletedAt)
                  )
                );
              if (!activeParent) {
                targetParentId = null;
              }
            }
          }

          await db.transaction(async (tx) => {
            // Restore root task
            await tx
              .update(schema.tasks)
              .set({
                deletedAt: null,
                version: sql`${schema.tasks.version} + 1`,
                updatedAt: now,
                listId: targetListId,
                sectionId: targetSectionId,
                parentId: targetParentId,
              })
              .where(
                and(
                  eq(schema.tasks.id, id),
                  eq(schema.tasks.userId, user.id)
                )
              );

            // Restore all descendants sharing the exact same deleted_at timestamp
            sqlite.run(
              `WITH RECURSIVE sub(id) AS (
                SELECT id FROM tasks WHERE parent_id = ?1 AND user_id = ?2
                UNION ALL
                SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ?2
              )
              UPDATE tasks
              SET deleted_at = NULL, updated_at = ?3, version = version + 1, list_id = ?4
              WHERE id IN (SELECT id FROM sub) AND deleted_at = ?5;`,
              [id, user.id, nowMs, targetListId, targetStamp]
            );
          });

          const [restored] = await db
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.id, id),
                eq(schema.tasks.userId, user.id)
              )
            );

          return { success: true, ...restored };
        }

        case "list": {
          const [existing] = await db
            .select()
            .from(schema.lists)
            .where(
              and(
                eq(schema.lists.id, id),
                eq(schema.lists.userId, user.id),
                isNotNull(schema.lists.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "List not found in trash" });
          }

          let targetFolderId = existing.folderId;
          if (targetFolderId) {
            const [folder] = await db
              .select()
              .from(schema.folders)
              .where(
                and(
                  eq(schema.folders.id, targetFolderId),
                  eq(schema.folders.userId, user.id),
                  isNull(schema.folders.deletedAt)
                )
              );
            if (!folder) {
              targetFolderId = null;
            }
          }

          const targetStamp = existing.deletedAt!.getTime();

          await db.transaction(async (tx) => {
            // Restore list
            await tx
              .update(schema.lists)
              .set({
                deletedAt: null,
                version: sql`${schema.lists.version} + 1`,
                updatedAt: now,
                folderId: targetFolderId,
              })
              .where(
                and(
                  eq(schema.lists.id, id),
                  eq(schema.lists.userId, user.id)
                )
              );

            // Restore any tasks in that list deleted with the exact same timestamp
            sqlite.run(
              `UPDATE tasks
              SET deleted_at = NULL, updated_at = ?1, version = version + 1
              WHERE list_id = ?2 AND user_id = ?3 AND deleted_at = ?4;`,
              [nowMs, id, user.id, targetStamp]
            );
          });

          const [restored] = await db
            .select()
            .from(schema.lists)
            .where(
              and(
                eq(schema.lists.id, id),
                eq(schema.lists.userId, user.id)
              )
            );

          return { success: true, ...restored };
        }

        case "folder": {
          const [existing] = await db
            .select()
            .from(schema.folders)
            .where(
              and(
                eq(schema.folders.id, id),
                eq(schema.folders.userId, user.id),
                isNotNull(schema.folders.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "Folder not found in trash" });
          }

          const [restored] = await db
            .update(schema.folders)
            .set({
              deletedAt: null,
              version: sql`${schema.folders.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.folders.id, id),
                eq(schema.folders.userId, user.id)
              )
            )
            .returning();

          return { success: true, ...restored };
        }

        case "section": {
          const [existing] = await db
            .select()
            .from(schema.sections)
            .where(
              and(
                eq(schema.sections.id, id),
                eq(schema.sections.userId, user.id),
                isNotNull(schema.sections.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "Section not found in trash" });
          }

          // Verify list is active
          const [activeList] = await db
            .select()
            .from(schema.lists)
            .where(
              and(
                eq(schema.lists.id, existing.listId),
                eq(schema.lists.userId, user.id),
                isNull(schema.lists.deletedAt)
              )
            );

          if (!activeList) {
            return status(400, { error: "Cannot restore section because its list is deleted or missing" });
          }

          const [restored] = await db
            .update(schema.sections)
            .set({
              deletedAt: null,
              version: sql`${schema.sections.version} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.sections.id, id),
                eq(schema.sections.userId, user.id)
              )
            )
            .returning();

          return { success: true, ...restored };
        }
      }
    },
    {
      auth: true,
      params: t.Object({
        type: t.String(),
        id: t.String(),
      }),
    }
  )
  // DELETE /api/v1/trash/:type/:id - permanent hard delete
  .delete(
    "/:type/:id",
    async ({ user, params: { type, id }, status }) => {
      if (!["task", "list", "folder", "section"].includes(type)) {
        return status(400, { error: "Invalid type. Must be task, list, folder, or section" });
      }

      switch (type) {
        case "task": {
          const [existing] = await db
            .select()
            .from(schema.tasks)
            .where(
              and(
                eq(schema.tasks.id, id),
                eq(schema.tasks.userId, user.id),
                isNotNull(schema.tasks.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "Task not found in trash" });
          }

          await db
            .delete(schema.tasks)
            .where(
              and(
                eq(schema.tasks.id, id),
                eq(schema.tasks.userId, user.id)
              )
            );

          return { success: true };
        }

        case "list": {
          const [existing] = await db
            .select()
            .from(schema.lists)
            .where(
              and(
                eq(schema.lists.id, id),
                eq(schema.lists.userId, user.id),
                isNotNull(schema.lists.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "List not found in trash" });
          }

          if (existing.isInbox) {
            return status(400, { error: "Cannot permanently delete the default Inbox list" });
          }

          await db
            .delete(schema.lists)
            .where(
              and(
                eq(schema.lists.id, id),
                eq(schema.lists.userId, user.id)
              )
            );

          return { success: true };
        }

        case "folder": {
          const [existing] = await db
            .select()
            .from(schema.folders)
            .where(
              and(
                eq(schema.folders.id, id),
                eq(schema.folders.userId, user.id),
                isNotNull(schema.folders.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "Folder not found in trash" });
          }

          await db
            .delete(schema.folders)
            .where(
              and(
                eq(schema.folders.id, id),
                eq(schema.folders.userId, user.id)
              )
            );

          return { success: true };
        }

        case "section": {
          const [existing] = await db
            .select()
            .from(schema.sections)
            .where(
              and(
                eq(schema.sections.id, id),
                eq(schema.sections.userId, user.id),
                isNotNull(schema.sections.deletedAt)
              )
            );

          if (!existing) {
            return status(404, { error: "Section not found in trash" });
          }

          await db
            .delete(schema.sections)
            .where(
              and(
                eq(schema.sections.id, id),
                eq(schema.sections.userId, user.id)
              )
            );

          return { success: true };
        }
      }
    },
    {
      auth: true,
      params: t.Object({
        type: t.String(),
        id: t.String(),
      }),
    }
  );
