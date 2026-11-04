import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { db, tasks, lists, folders, sections } from "../src/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { createAuthUser } from "./helpers";
import { purgeOldSoftDeleted } from "../src/utils/purge";

describe("Phase 2 Part 4 Backend: Soft-Delete Cascade, Trash Endpoints, Exact Stamp Restore, Subtree Archive, and Purge Cron", () => {
  // Helper to retrieve user's default inbox list
  async function getUserInboxId(authHeaders: Record<string, string>): Promise<string> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/lists", {
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(200);
    const userLists = (await res.json()) as Array<{ id: string; isInbox: boolean }>;
    const inbox = userLists.find((l) => l.isInbox);
    expect(inbox).toBeDefined();
    return inbox!.id;
  }

  /* -------------------------------------------------------------
   * 1. SOFT-DELETE CASCADE ON TASK AND LIST
   * ----------------------------------------------------------- */
  describe("1. Soft-Delete Cascade on Task and List", () => {
    it("cascades soft-delete down the task tree with the exact same millisecond timestamp", async () => {
      const { user, authHeaders } = await createAuthUser("TaskCascadeUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create root task
      const rootRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Parent Task",
            listId: inboxId,
          }),
        })
      );
      expect(rootRes.status).toBe(201);
      const rootTask = (await rootRes.json()) as any;

      // Create child subtask
      const childRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Child Task",
            listId: inboxId,
            parentId: rootTask.id,
          }),
        })
      );
      expect(childRes.status).toBe(201);
      const childTask = (await childRes.json()) as any;

      // Create grandchild subtask
      const grandchildRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Grandchild Task",
            listId: inboxId,
            parentId: childTask.id,
          }),
        })
      );
      expect(grandchildRes.status).toBe(201);
      const grandchildTask = (await grandchildRes.json()) as any;

      // Delete root task
      const deleteRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${rootTask.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(deleteRes.status).toBe(200);

      // Verify all 3 tasks are soft-deleted with identical timestamp
      const [rDb] = await db.select().from(tasks).where(eq(tasks.id, rootTask.id));
      const [cDb] = await db.select().from(tasks).where(eq(tasks.id, childTask.id));
      const [gDb] = await db.select().from(tasks).where(eq(tasks.id, grandchildTask.id));

      expect(rDb.deletedAt).not.toBeNull();
      expect(cDb.deletedAt).not.toBeNull();
      expect(gDb.deletedAt).not.toBeNull();

      expect(rDb.deletedAt?.getTime()).toBe(cDb.deletedAt?.getTime());
      expect(rDb.deletedAt?.getTime()).toBe(gDb.deletedAt?.getTime());
      expect(rDb.version).toBe(2);
      expect(cDb.version).toBe(2);
      expect(gDb.version).toBe(2);
    });

    it("cascades soft-delete across list and all tasks in that list with the exact same millisecond timestamp", async () => {
      const { user, authHeaders } = await createAuthUser("ListCascadeUser");

      // Create custom list
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Project Beta",
          }),
        })
      );
      expect(listRes.status).toBe(201);
      const customList = (await listRes.json()) as any;

      // Create 2 tasks in this list
      const t1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Task Beta 1",
            listId: customList.id,
          }),
        })
      );
      const t2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Task Beta 2",
            listId: customList.id,
          }),
        })
      );
      expect(t1Res.status).toBe(201);
      expect(t2Res.status).toBe(201);
      const t1 = (await t1Res.json()) as any;
      const t2 = (await t2Res.json()) as any;

      // Delete custom list
      const delListRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${customList.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delListRes.status).toBe(200);

      // Verify list and tasks share the exact same deletedAt timestamp
      const [listDb] = await db.select().from(lists).where(eq(lists.id, customList.id));
      const [t1Db] = await db.select().from(tasks).where(eq(tasks.id, t1.id));
      const [t2Db] = await db.select().from(tasks).where(eq(tasks.id, t2.id));

      expect(listDb.deletedAt).not.toBeNull();
      expect(t1Db.deletedAt).not.toBeNull();
      expect(t2Db.deletedAt).not.toBeNull();

      expect(listDb.deletedAt?.getTime()).toBe(t1Db.deletedAt?.getTime());
      expect(listDb.deletedAt?.getTime()).toBe(t2Db.deletedAt?.getTime());
    });

    it("rejects soft deleting the default inbox list with 400", async () => {
      const { user, authHeaders } = await createAuthUser("InboxDeleteUser");
      const inboxId = await getUserInboxId(authHeaders);

      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${inboxId}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(400);
      const body = (await delRes.json()) as any;
      expect(body.error).toContain("Inbox");
    });
  });

  /* -------------------------------------------------------------
   * 2. EXACT STAMP RESTORE
   * ----------------------------------------------------------- */
  describe("2. Exact Stamp Restore", () => {
    it("restores only items sharing exact deletedAt stamp; subtasks deleted earlier remain in trash", async () => {
      const { user, authHeaders } = await createAuthUser("ExactStampUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create Parent A
      const aRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Task A",
            listId: inboxId,
          }),
        })
      );
      const taskA = (await aRes.json()) as any;

      // Create Child B
      const bRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Subtask B",
            listId: inboxId,
            parentId: taskA.id,
          }),
        })
      );
      const taskB = (await bRes.json()) as any;

      // Create Child C
      const cRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Subtask C",
            listId: inboxId,
            parentId: taskA.id,
          }),
        })
      );
      const taskC = (await cRes.json()) as any;

      // 1. Delete Child C separately first
      const delCRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskC.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delCRes.status).toBe(200);

      // Brief sleep to ensure distinct timestamp
      await new Promise((r) => setTimeout(r, 20));

      // 2. Delete Parent A (cascades to remaining Child B)
      const delARes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delARes.status).toBe(200);

      // Verify all 3 are currently soft deleted
      const [aDel] = await db.select().from(tasks).where(eq(tasks.id, taskA.id));
      const [bDel] = await db.select().from(tasks).where(eq(tasks.id, taskB.id));
      const [cDel] = await db.select().from(tasks).where(eq(tasks.id, taskC.id));

      expect(aDel.deletedAt).not.toBeNull();
      expect(bDel.deletedAt).not.toBeNull();
      expect(cDel.deletedAt).not.toBeNull();
      expect(aDel.deletedAt?.getTime()).toBe(bDel.deletedAt?.getTime());
      expect(aDel.deletedAt?.getTime()).not.toBe(cDel.deletedAt?.getTime());

      // 3. Restore Task A
      const restoreRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/trash/task/${taskA.id}/restore`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(restoreRes.status).toBe(200);

      // Verify: Task A and Child B are RESTORED
      const [aRestored] = await db.select().from(tasks).where(eq(tasks.id, taskA.id));
      const [bRestored] = await db.select().from(tasks).where(eq(tasks.id, taskB.id));
      const [cRestored] = await db.select().from(tasks).where(eq(tasks.id, taskC.id));

      expect(aRestored.deletedAt).toBeNull();
      expect(bRestored.deletedAt).toBeNull();
      // Child C was deleted earlier with a different timestamp, so it REMAINS IN TRASH
      expect(cRestored.deletedAt).not.toBeNull();
      expect(cRestored.deletedAt?.getTime()).toBe(cDel.deletedAt?.getTime());
    });

    it("restores a list and only tasks that were deleted together with the list", async () => {
      const { user, authHeaders } = await createAuthUser("ListExactStampUser");

      // Create list
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Sprint 42" }),
        })
      );
      const targetList = (await listRes.json()) as any;

      // Task 1 deleted before list deletion
      const t1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Prior Trash Task", listId: targetList.id }),
        })
      );
      const t1 = (await t1Res.json()) as any;

      // Task 2 active when list is deleted
      const t2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Active In List Task", listId: targetList.id }),
        })
      );
      const t2 = (await t2Res.json()) as any;

      // Delete Task 1 first
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${t1.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      await new Promise((r) => setTimeout(r, 20));

      // Delete List (cascades to Task 2)
      await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${targetList.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // Restore List
      const restoreRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/trash/list/${targetList.id}/restore`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(restoreRes.status).toBe(200);

      // Verify list is restored
      const [listRow] = await db.select().from(lists).where(eq(lists.id, targetList.id));
      expect(listRow.deletedAt).toBeNull();

      // Verify Task 2 is restored, but Task 1 remains in trash
      const [t1Row] = await db.select().from(tasks).where(eq(tasks.id, t1.id));
      const [t2Row] = await db.select().from(tasks).where(eq(tasks.id, t2.id));

      expect(t2Row.deletedAt).toBeNull();
      expect(t1Row.deletedAt).not.toBeNull();
    });
  });

  /* -------------------------------------------------------------
   * 3. INBOX LANDING ON RESTORE
   * ----------------------------------------------------------- */
  describe("3. Inbox Landing on Restore", () => {
    it("lands restored task in Inbox and clears section_id and parent_id when list is deleted", async () => {
      const { user, authHeaders } = await createAuthUser("InboxLandingUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create custom list
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Temporary Project" }),
        })
      );
      const tempList = (await listRes.json()) as any;

      // Create section in custom list
      const secRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${tempList.id}/sections`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Phase A" }),
        })
      );
      const section = (await secRes.json()) as any;

      // Create parent task
      const parentRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Parent in Temp List",
            listId: tempList.id,
            sectionId: section.id,
          }),
        })
      );
      const parentTask = (await parentRes.json()) as any;

      // Create child task
      const childRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Child in Temp List",
            listId: tempList.id,
            sectionId: section.id,
            parentId: parentTask.id,
          }),
        })
      );
      const childTask = (await childRes.json()) as any;

      // Delete child task
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${childTask.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // Soft delete list
      await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${tempList.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // Restore child task
      const restoreRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/trash/task/${childTask.id}/restore`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(restoreRes.status).toBe(200);

      // Verify child landed in Inbox with null section and null parent
      const [restoredChild] = await db.select().from(tasks).where(eq(tasks.id, childTask.id));
      expect(restoredChild.deletedAt).toBeNull();
      expect(restoredChild.listId).toBe(inboxId);
      expect(restoredChild.sectionId).toBeNull();
      expect(restoredChild.parentId).toBeNull();
    });
  });

  /* -------------------------------------------------------------
   * 4. TRASH ENDPOINTS (GET, DELETE SINGLE, DELETE EMPTY)
   * ----------------------------------------------------------- */
  describe("4. Trash Endpoints (GET, DELETE single, DELETE empty)", () => {
    it("returns grouped trash items and type-filtered trash items", async () => {
      const { user, authHeaders } = await createAuthUser("TrashEndpointsUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create and delete folder
      const fRes = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Trash Folder" }),
        })
      );
      const folder = (await fRes.json()) as any;
      await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${folder.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // Create and delete list
      const lRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Trash List" }),
        })
      );
      const list = (await lRes.json()) as any;
      await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // Create and delete task
      const tRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Trash Task", listId: inboxId }),
        })
      );
      const task = (await tRes.json()) as any;
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // GET /trash grouped
      const groupedRes = await app.handle(
        new Request("http://localhost:3001/api/v1/trash", {
          headers: authHeaders,
        })
      );
      expect(groupedRes.status).toBe(200);
      const grouped = (await groupedRes.json()) as any;
      expect(grouped.tasks.length).toBeGreaterThanOrEqual(1);
      expect(grouped.lists.length).toBeGreaterThanOrEqual(1);
      expect(grouped.folders.length).toBeGreaterThanOrEqual(1);

      // GET /trash?type=task
      const tasksRes = await app.handle(
        new Request("http://localhost:3001/api/v1/trash?type=task", {
          headers: authHeaders,
        })
      );
      expect(tasksRes.status).toBe(200);
      const taskList = (await tasksRes.json()) as any[];
      expect(taskList.some((t) => t.id === task.id)).toBe(true);

      // GET /trash?type=invalid
      const invalidRes = await app.handle(
        new Request("http://localhost:3001/api/v1/trash?type=invalid", {
          headers: authHeaders,
        })
      );
      expect(invalidRes.status).toBe(400);
    });

    it("permanently hard-deletes single item via DELETE /trash/:type/:id", async () => {
      const { user, authHeaders } = await createAuthUser("HardDeleteSingleUser");
      const inboxId = await getUserInboxId(authHeaders);

      const tRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "To Permanent Purge", listId: inboxId }),
        })
      );
      const task = (await tRes.json()) as any;

      // Soft delete first
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // Hard delete from trash
      const hardDelRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/trash/task/${task.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(hardDelRes.status).toBe(200);

      // Row should be gone completely
      const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      expect(row).toBeUndefined();
    });

    it("empties trash via DELETE /trash without touching active items or Inbox list", async () => {
      const { user, authHeaders } = await createAuthUser("EmptyTrashUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create active task
      const activeRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Keep Active", listId: inboxId }),
        })
      );
      const activeTask = (await activeRes.json()) as any;

      // Create soft-deleted task
      const delTaskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Delete Me", listId: inboxId }),
        })
      );
      const delTask = (await delTaskRes.json()) as any;
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${delTask.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      // Empty trash
      const emptyRes = await app.handle(
        new Request("http://localhost:3001/api/v1/trash", {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(emptyRes.status).toBe(200);

      // Verify trash is empty for this user
      const checkTrashRes = await app.handle(
        new Request("http://localhost:3001/api/v1/trash", {
          headers: authHeaders,
        })
      );
      const trash = (await checkTrashRes.json()) as any;
      expect(trash.tasks.length).toBe(0);

      // Active task remains untouched
      const [activeDb] = await db.select().from(tasks).where(eq(tasks.id, activeTask.id));
      expect(activeDb).toBeDefined();
      expect(activeDb.deletedAt).toBeNull();

      // Inbox list is intact
      const [inboxDb] = await db.select().from(lists).where(eq(lists.id, inboxId));
      expect(inboxDb).toBeDefined();
      expect(inboxDb.deletedAt).toBeNull();
    });
  });

  /* -------------------------------------------------------------
   * 5. ARCHIVE SUBTREE & LIST ARCHIVE TASK HIDING
   * ----------------------------------------------------------- */
  describe("5. Archive Subtree & List Archive Task Hiding", () => {
    it("archives task subtree and unarchives with exact stamp preservation", async () => {
      const { user, authHeaders } = await createAuthUser("ArchiveSubtreeUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create Root X
      const xRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Root X", listId: inboxId }),
        })
      );
      const taskX = (await xRes.json()) as any;

      // Create Child Y
      const yRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Child Y", listId: inboxId, parentId: taskX.id }),
        })
      );
      const taskY = (await yRes.json()) as any;

      // Create Child Z
      const zRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Child Z", listId: inboxId, parentId: taskX.id }),
        })
      );
      const taskZ = (await zRes.json()) as any;

      // 1. Archive Z first separately
      const archZRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskZ.id}/archive`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(archZRes.status).toBe(200);

      await new Promise((r) => setTimeout(r, 20));

      // 2. Archive Root X (should archive X and Y, preserving Z's timestamp)
      const archXRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskX.id}/archive`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(archXRes.status).toBe(200);

      const [xRow] = await db.select().from(tasks).where(eq(tasks.id, taskX.id));
      const [yRow] = await db.select().from(tasks).where(eq(tasks.id, taskY.id));
      const [zRow] = await db.select().from(tasks).where(eq(tasks.id, taskZ.id));

      expect(xRow.archivedAt).not.toBeNull();
      expect(yRow.archivedAt).not.toBeNull();
      expect(zRow.archivedAt).not.toBeNull();

      expect(xRow.archivedAt?.getTime()).toBe(yRow.archivedAt?.getTime());
      expect(xRow.archivedAt?.getTime()).not.toBe(zRow.archivedAt?.getTime());

      // 3. Unarchive Root X (unarchives X and Y, leaves Z archived)
      const unarchXRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskX.id}/unarchive`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(unarchXRes.status).toBe(200);

      const [xUnRow] = await db.select().from(tasks).where(eq(tasks.id, taskX.id));
      const [yUnRow] = await db.select().from(tasks).where(eq(tasks.id, taskY.id));
      const [zUnRow] = await db.select().from(tasks).where(eq(tasks.id, taskZ.id));

      expect(xUnRow.archivedAt).toBeNull();
      expect(yUnRow.archivedAt).toBeNull();
      expect(zUnRow.archivedAt).not.toBeNull();
      expect(zUnRow.archivedAt?.getTime()).toBe(zRow.archivedAt?.getTime());
    });

    it("hides tasks whose list is archived from default GET /tasks, and includes them when ?archived=true", async () => {
      const { user, authHeaders } = await createAuthUser("ListArchiveHidingUser");

      // Create list
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Archivable Project" }),
        })
      );
      const list = (await listRes.json()) as any;

      // Create task in this list
      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "List Hidden Task", listId: list.id }),
        })
      );
      const task = (await taskRes.json()) as any;

      // Default GET /tasks shows the task
      const getActiveRes1 = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          headers: authHeaders,
        })
      );
      const items1 = ((await getActiveRes1.json()) as any).items;
      expect(items1.some((t: any) => t.id === task.id)).toBe(true);

      // Archive the list
      await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}/archive`, {
          method: "POST",
          headers: authHeaders,
        })
      );

      // Default GET /tasks now HIDES the task
      const getActiveRes2 = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          headers: authHeaders,
        })
      );
      const items2 = ((await getActiveRes2.json()) as any).items;
      expect(items2.some((t: any) => t.id === task.id)).toBe(false);

      // GET /tasks?archived=true INCLUDES the task
      const getArchivedRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks?archived=true", {
          headers: authHeaders,
        })
      );
      const archivedItems = ((await getArchivedRes.json()) as any).items;
      expect(archivedItems.some((t: any) => t.id === task.id)).toBe(true);
    });
  });

  /* -------------------------------------------------------------
   * 6. 30-DAY PURGE SERVICE & BATCH TRANSACTION LOOP
   * ----------------------------------------------------------- */
  describe("6. 30-Day Purge Service & Batch Transaction Loop", () => {
    it("purges soft-deleted rows older than cutoff in batches while preserving newer soft-deleted rows", async () => {
      const { user, authHeaders } = await createAuthUser("PurgeTestUser");
      const inboxId = await getUserInboxId(authHeaders);

      const now = Date.now();
      const thirtyFiveDaysAgo = new Date(now - 35 * 24 * 60 * 60 * 1000);
      const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000);

      // Insert 3 old tasks (35 days ago)
      const oldTasks = await Promise.all([
        db.insert(tasks).values({
          userId: user.id,
          listId: inboxId,
          title: "Old Task 1",
          position: "a1",
          deletedAt: thirtyFiveDaysAgo,
        }).returning(),
        db.insert(tasks).values({
          userId: user.id,
          listId: inboxId,
          title: "Old Task 2",
          position: "a2",
          deletedAt: thirtyFiveDaysAgo,
        }).returning(),
        db.insert(tasks).values({
          userId: user.id,
          listId: inboxId,
          title: "Old Task 3",
          position: "a3",
          deletedAt: thirtyFiveDaysAgo,
        }).returning(),
      ]);

      // Insert 1 recent task (5 days ago)
      const [recentTask] = await db.insert(tasks).values({
        userId: user.id,
        listId: inboxId,
        title: "Recent Deleted Task",
        position: "a4",
        deletedAt: fiveDaysAgo,
      }).returning();

      // Insert 1 old folder
      const [oldFolder] = await db.insert(folders).values({
        userId: user.id,
        name: "Old Deleted Folder",
        position: "a1",
        deletedAt: thirtyFiveDaysAgo,
      }).returning();

      // Run purge with batchSize = 2 to exercise multi-batch transaction loop
      const defaultThreshold = new Date(now - 30 * 24 * 60 * 60 * 1000);
      const purgeResult = await purgeOldSoftDeleted(defaultThreshold, 2);

      expect(purgeResult.tasks).toBeGreaterThanOrEqual(3);
      expect(purgeResult.folders).toBeGreaterThanOrEqual(1);
      expect(purgeResult.total).toBeGreaterThanOrEqual(4);

      // Verify old tasks are deleted
      for (const [t] of oldTasks) {
        const [row] = await db.select().from(tasks).where(eq(tasks.id, t.id));
        expect(row).toBeUndefined();
      }

      // Verify old folder is deleted
      const [fRow] = await db.select().from(folders).where(eq(folders.id, oldFolder.id));
      expect(fRow).toBeUndefined();

      // Verify recent deleted task remains intact
      const [recentDb] = await db.select().from(tasks).where(eq(tasks.id, recentTask.id));
      expect(recentDb).toBeDefined();
      expect(recentDb.deletedAt).not.toBeNull();
    });
  });
});
