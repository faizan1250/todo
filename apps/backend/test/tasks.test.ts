import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { db, tasks, lists, tags, taskTags, checklistItems } from "../src/db";
import { and, eq, isNull } from "drizzle-orm";
import { createAuthUser } from "./helpers";

describe("Phase 2 Part 2 Backend: Tasks, Subtask Hierarchy, Checklist, Tags, and Batch Loader", () => {
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
   * 1. TASKS CRUD & VERSION INCREMENTING
   * ----------------------------------------------------------- */
  describe("1. Tasks CRUD & Lifecycle", () => {
    it("creates, reads, updates, and soft deletes a task with version incrementing", async () => {
      const { user, authHeaders } = await createAuthUser("TaskCrudUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create task
      const createRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Build Rocket Engine",
            notes: "Line 1\r\nLine 2\r\nLine 3",
            priority: 2,
            listId: inboxId,
            estimateMin: 120,
          }),
        })
      );

      expect(createRes.status).toBe(201);
      const createdTask = (await createRes.json()) as any;
      expect(createdTask.id).toBeDefined();
      expect(createdTask.title).toBe("Build Rocket Engine");
      expect(createdTask.notes).toBe("Line 1\nLine 2\nLine 3"); // normalized
      expect(createdTask.priority).toBe(2);
      expect(createdTask.status).toBe("todo");
      expect(createdTask.version).toBe(1);
      expect(createdTask.completedAt).toBeNull();

      // Read single task
      const getRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${createdTask.id}`, {
          headers: authHeaders,
        })
      );
      expect(getRes.status).toBe(200);
      const fetchedTask = (await getRes.json()) as any;
      expect(fetchedTask.id).toBe(createdTask.id);

      // Update task to done (sets completedAt automatically, increments version)
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${createdTask.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            status: "done",
            priority: 3,
          }),
        })
      );
      expect(patchRes.status).toBe(200);
      const patchedTask = (await patchRes.json()) as any;
      expect(patchedTask.status).toBe("done");
      expect(patchedTask.priority).toBe(3);
      expect(patchedTask.completedAt).not.toBeNull();
      expect(patchedTask.version).toBe(2);

      // Update task to in_progress (clears completedAt automatically, increments version)
      const uncompleteRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${createdTask.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            status: "in_progress",
          }),
        })
      );
      expect(uncompleteRes.status).toBe(200);
      const inProgressTask = (await uncompleteRes.json()) as any;
      expect(inProgressTask.status).toBe("in_progress");
      expect(inProgressTask.completedAt).toBeNull();
      expect(inProgressTask.version).toBe(3);

      // Soft delete task
      const deleteRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${createdTask.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(deleteRes.status).toBe(200);
      expect(await deleteRes.json()).toEqual({ success: true });

      // Verify cannot be retrieved via GET
      const getAfterDelete = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${createdTask.id}`, {
          headers: authHeaders,
        })
      );
      expect(getAfterDelete.status).toBe(404);

      // Check in DB that deletedAt is set and version was bumped
      const [dbTask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, createdTask.id));
      expect(dbTask.deletedAt).not.toBeNull();
      expect(dbTask.version).toBe(4);
    });

    it("rejects invalid inputs: empty title, notes > 100KB", async () => {
      const { authHeaders } = await createAuthUser("InvalidTaskUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Empty title
      const emptyTitleRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "   ",
            listId: inboxId,
          }),
        })
      );
      expect(emptyTitleRes.status).toBe(400);

      // Notes > 100KB
      const hugeNotes = "a".repeat(1024 * 105);
      const hugeNotesRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Large Task",
            notes: hugeNotes,
            listId: inboxId,
          }),
        })
      );
      expect(hugeNotesRes.status).toBe(400);
      const body = (await hugeNotesRes.json()) as { error: string };
      expect(body.error).toContain("100KB");
    });
  });

  /* -------------------------------------------------------------
   * 2. SUBTASK HIERARCHY, DEPTH (MAX 3), AND CYCLE DETECTION
   * ----------------------------------------------------------- */
  describe("2. Subtask Hierarchy, Max Depth 3, and Cycle Checks", () => {
    it("allows nesting up to 3 levels (root -> subtask -> grandchild) and rejects level 4", async () => {
      const { authHeaders } = await createAuthUser("HierarchyUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Level 1: Root task
      const rootRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Level 1: Root Task",
            listId: inboxId,
          }),
        })
      );
      expect(rootRes.status).toBe(201);
      const root = (await rootRes.json()) as any;
      expect(root.parentId).toBeNull();

      // Level 2: Subtask
      const subtaskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Level 2: Subtask",
            parentId: root.id,
          }),
        })
      );
      expect(subtaskRes.status).toBe(201);
      const subtask = (await subtaskRes.json()) as any;
      expect(subtask.parentId).toBe(root.id);
      expect(subtask.listId).toBe(inboxId); // Inherits parent listId

      // Level 3: Grandchild
      const grandchildRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Level 3: Grandchild Subtask",
            parentId: subtask.id,
          }),
        })
      );
      expect(grandchildRes.status).toBe(201);
      const grandchild = (await grandchildRes.json()) as any;
      expect(grandchild.parentId).toBe(subtask.id);
      expect(grandchild.listId).toBe(inboxId);

      // Level 4: Attempt to nest beyond 3 levels -> Must fail with 400
      const level4Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Level 4: Great-grandchild (Forbidden)",
            parentId: grandchild.id,
          }),
        })
      );
      expect(level4Res.status).toBe(400);
      const err = (await level4Res.json()) as { error: string };
      expect(err.error).toBe("Subtasks can be nested up to 3 levels maximum");
    });

    it("prevents cycles: task cannot be its own parent or have a descendant as its parent", async () => {
      const { authHeaders } = await createAuthUser("CycleUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create root -> child -> grandchild
      const rRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Task A", listId: inboxId }),
        })
      );
      const taskA = (await rRes.json()) as any;

      const bRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Task B", parentId: taskA.id }),
        })
      );
      const taskB = (await bRes.json()) as any;

      const cRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Task C", parentId: taskB.id }),
        })
      );
      const taskC = (await cRes.json()) as any;

      // 1) Self-parent: Task A parentId = Task A
      const selfParentRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ parentId: taskA.id }),
        })
      );
      expect(selfParentRes.status).toBe(400);
      const selfErr = (await selfParentRes.json()) as { error: string };
      expect(selfErr.error).toBe("A task cannot be its own parent");

      // 2) Descendant cycle: Task A parentId = Task B (direct child)
      const cycleBRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ parentId: taskB.id }),
        })
      );
      expect(cycleBRes.status).toBe(400);
      const cycleBErr = (await cycleBRes.json()) as { error: string };
      expect(cycleBErr.error).toBe("A task cannot have one of its descendants as a parent");

      // 3) Descendant cycle: Task A parentId = Task C (grandchild)
      const cycleCRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ parentId: taskC.id }),
        })
      );
      expect(cycleCRes.status).toBe(400);
      const cycleCErr = (await cycleCRes.json()) as { error: string };
      expect(cycleCErr.error).toBe("A task cannot have one of its descendants as a parent");
    });

    it("prevents moving subtrees if resulting depth would exceed 3", async () => {
      const { authHeaders } = await createAuthUser("SubtreeMoveUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Branch 1: Root1 (depth 1) -> Child1 (depth 2)
      const r1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Root1", listId: inboxId }),
        })
      );
      const root1 = (await r1Res.json()) as any;

      const c1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Child1", parentId: root1.id }),
        })
      );
      const child1 = (await c1Res.json()) as any;

      // Branch 2: Root2 (depth 1) -> Child2 (depth 2)
      const r2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Root2", listId: inboxId }),
        })
      );
      const root2 = (await r2Res.json()) as any;

      const c2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Child2", parentId: root2.id }),
        })
      );
      const child2 = (await c2Res.json()) as any;

      // Moving Root2 under Child1 would make: Root1 (1) -> Child1 (2) -> Root2 (3) -> Child2 (4) -> depth 4!
      const moveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root2.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ parentId: child1.id }),
        })
      );
      expect(moveRes.status).toBe(400);
      const moveErr = (await moveRes.json()) as { error: string };
      expect(moveErr.error).toBe("Subtasks can be nested up to 3 levels maximum");
    });

    it("cascades listId updates to all descendants when parent list changes", async () => {
      const { authHeaders } = await createAuthUser("ListCascadeUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create a second list
      const createListRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Work Projects" }),
        })
      );
      const workList = (await createListRes.json()) as any;

      // Create Root -> Child -> Grandchild in Inbox
      const rRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Parent Task", listId: inboxId }),
        })
      );
      const rootTask = (await rRes.json()) as any;

      const cRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Subtask", parentId: rootTask.id }),
        })
      );
      const subtask = (await cRes.json()) as any;

      const gRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Grandchild", parentId: subtask.id }),
        })
      );
      const grandchild = (await gRes.json()) as any;

      // Move rootTask to workList
      const moveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${rootTask.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ listId: workList.id }),
        })
      );
      expect(moveRes.status).toBe(200);

      // Verify subtask and grandchild listId cascaded to workList
      const [dbSubtask] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, subtask.id));
      const [dbGrandchild] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, grandchild.id));

      expect(dbSubtask.listId).toBe(workList.id);
      expect(dbGrandchild.listId).toBe(workList.id);
    });

    it("cascades soft delete down the entire subtask subtree", async () => {
      const { authHeaders } = await createAuthUser("CascadeDeleteUser");
      const inboxId = await getUserInboxId(authHeaders);

      const rRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Root", listId: inboxId }),
        })
      );
      const root = (await rRes.json()) as any;

      const cRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Child", parentId: root.id }),
        })
      );
      const child = (await cRes.json()) as any;

      // Delete root task
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Child should also be soft deleted
      const [dbChild] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, child.id));
      expect(dbChild.deletedAt).not.toBeNull();
    });
  });

  /* -------------------------------------------------------------
   * 3. CHECKLIST ITEMS CRUD, COMPLETION, AND MOVE
   * ----------------------------------------------------------- */
  describe("3. Checklist Items CRUD, Status, and Ordering", () => {
    it("handles checklist item creation, ordering, status update, moving, and deletion", async () => {
      const { authHeaders } = await createAuthUser("ChecklistUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create a task
      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Deployment Checklist Task", listId: inboxId }),
        })
      );
      const task = (await taskRes.json()) as any;

      // Add item 1
      const item1Res = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/checklist`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ text: "Run database migrations" }),
        })
      );
      expect(item1Res.status).toBe(201);
      const item1 = (await item1Res.json()) as any;
      expect(item1.text).toBe("Run database migrations");
      expect(item1.done).toBe(false);
      expect(item1.version).toBe(1);

      // Add item 2
      const item2Res = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/checklist`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ text: "Verify health check" }),
        })
      );
      expect(item2Res.status).toBe(201);
      const item2 = (await item2Res.json()) as any;

      // Get checklist items
      const listRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/checklist`, {
          headers: authHeaders,
        })
      );
      expect(listRes.status).toBe(200);
      const items = (await listRes.json()) as any[];
      expect(items.length).toBe(2);
      expect(items[0].id).toBe(item1.id);
      expect(items[1].id).toBe(item2.id);

      // Toggle done on item 1 (bumping version)
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/checklist/${item1.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ done: true }),
        })
      );
      expect(patchRes.status).toBe(200);
      const patchedItem1 = (await patchRes.json()) as any;
      expect(patchedItem1.done).toBe(true);
      expect(patchedItem1.version).toBe(2);

      // Move item 2 before item 1
      const moveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/checklist/${item2.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ beforeId: item1.id }),
        })
      );
      expect(moveRes.status).toBe(200);

      // Re-fetch items and verify item 2 is now first
      const reorderedRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/checklist`, {
          headers: authHeaders,
        })
      );
      const reorderedItems = (await reorderedRes.json()) as any[];
      expect(reorderedItems[0].id).toBe(item2.id);
      expect(reorderedItems[1].id).toBe(item1.id);

      // Delete item 1
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/checklist/${item1.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);
      expect(await delRes.json()).toEqual({ success: true });

      // Verify item 1 is excluded from active checklist
      const finalItemsRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/checklist`, {
          headers: authHeaders,
        })
      );
      const finalItems = (await finalItemsRes.json()) as any[];
      expect(finalItems.length).toBe(1);
      expect(finalItems[0].id).toBe(item2.id);
    });
  });

  /* -------------------------------------------------------------
   * 4. TAGS CRUD, CASE-INSENSITIVE COLLISION, AND PUT /tasks/:id/tags
   * ----------------------------------------------------------- */
  describe("4. Tags CRUD & Task Tag Set Replacement", () => {
    it("creates, updates, and soft deletes tags with case-insensitive uniqueness check", async () => {
      const { authHeaders } = await createAuthUser("TagUser");

      // Create tag "Frontend"
      const t1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Frontend", color: "#3b82f6" }),
        })
      );
      expect(t1Res.status).toBe(201);
      const tag1 = (await t1Res.json()) as any;
      expect(tag1.name).toBe("Frontend");
      expect(tag1.color).toBe("#3b82f6");
      expect(tag1.version).toBe(1);

      // Attempt to create "frontend" (NOCASE duplicate) -> 409 Conflict
      const duplicateRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "frontend" }),
        })
      );
      expect(duplicateRes.status).toBe(409);
      const dupErr = (await duplicateRes.json()) as { error: string };
      expect(dupErr.error).toContain("already exists");

      // List tags
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          headers: authHeaders,
        })
      );
      expect(listRes.status).toBe(200);
      const allTags = (await listRes.json()) as any[];
      expect(allTags.length).toBe(1);
      expect(allTags[0].name).toBe("Frontend");

      // Update tag color and name
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tags/${tag1.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ name: "UI Engineering", color: "#10b981" }),
        })
      );
      expect(patchRes.status).toBe(200);
      const updatedTag = (await patchRes.json()) as any;
      expect(updatedTag.name).toBe("UI Engineering");
      expect(updatedTag.color).toBe("#10b981");
      expect(updatedTag.version).toBe(2);

      // Soft delete tag
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tags/${tag1.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Tag list should now be empty
      const emptyRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          headers: authHeaders,
        })
      );
      expect(((await emptyRes.json()) as any[]).length).toBe(0);
    });

    it("replaces task tag sets via PUT /tasks/:id/tags in a single transaction", async () => {
      const { authHeaders } = await createAuthUser("TagReplacer");
      const inboxId = await getUserInboxId(authHeaders);

      // Create tags A, B, C
      const tagA = await (
        await app.handle(
          new Request("http://localhost:3001/api/v1/tags", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name: "TagA" }),
          })
        )
      ).json() as any;

      const tagB = await (
        await app.handle(
          new Request("http://localhost:3001/api/v1/tags", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name: "TagB" }),
          })
        )
      ).json() as any;

      const tagC = await (
        await app.handle(
          new Request("http://localhost:3001/api/v1/tags", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name: "TagC" }),
          })
        )
      ).json() as any;

      // Create task with initial TagA and TagB
      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Task with tags",
            listId: inboxId,
            tagIds: [tagA.id, tagB.id],
          }),
        })
      );
      expect(taskRes.status).toBe(201);
      const task = (await taskRes.json()) as any;
      expect(task.tags.length).toBe(2);

      // Replace tags with [TagB, TagC]
      const putRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/tags`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({ tagIds: [tagB.id, tagC.id] }),
        })
      );
      expect(putRes.status).toBe(200);
      const replacedTask = (await putRes.json()) as any;
      const tagIds = replacedTask.tags.map((t: any) => t.id).sort();
      expect(tagIds).toEqual([tagB.id, tagC.id].sort());

      // Replace with empty array (removes all tags)
      const clearRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/tags`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({ tagIds: [] }),
        })
      );
      expect(clearRes.status).toBe(200);
      const clearedTask = (await clearRes.json()) as any;
      expect(clearedTask.tags.length).toBe(0);
    });
  });

  /* -------------------------------------------------------------
   * 5. CURSOR PAGINATION ON (POSITION, ID)
   * ----------------------------------------------------------- */
  describe("5. Cursor Pagination on (position, id)", () => {
    it("paginates items deterministically without skipping or duplicating", async () => {
      const { authHeaders } = await createAuthUser("CursorUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create 5 tasks
      const createdIds: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const res = await app.handle(
          new Request("http://localhost:3001/api/v1/tasks", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              title: `Task #${i}`,
              listId: inboxId,
            }),
          })
        );
        const t = (await res.json()) as any;
        createdIds.push(t.id);
      }

      // Page 1: limit 2
      const page1Res = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks?listId=${inboxId}&limit=2`, {
          headers: authHeaders,
        })
      );
      expect(page1Res.status).toBe(200);
      const page1 = (await page1Res.json()) as any;
      expect(page1.items.length).toBe(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.nextCursor).not.toBeNull();
      expect(page1.items[0].id).toBe(createdIds[0]);
      expect(page1.items[1].id).toBe(createdIds[1]);

      // Page 2: limit 2 with cursor from Page 1
      const page2Res = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks?listId=${inboxId}&limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`, {
          headers: authHeaders,
        })
      );
      expect(page2Res.status).toBe(200);
      const page2 = (await page2Res.json()) as any;
      expect(page2.items.length).toBe(2);
      expect(page2.hasMore).toBe(true);
      expect(page2.nextCursor).not.toBeNull();
      expect(page2.items[0].id).toBe(createdIds[2]);
      expect(page2.items[1].id).toBe(createdIds[3]);

      // Page 3: limit 2 with cursor from Page 2 -> returns final item
      const page3Res = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks?listId=${inboxId}&limit=2&cursor=${encodeURIComponent(page2.nextCursor)}`, {
          headers: authHeaders,
        })
      );
      expect(page3Res.status).toBe(200);
      const page3 = (await page3Res.json()) as any;
      expect(page3.items.length).toBe(1);
      expect(page3.hasMore).toBe(false);
      expect(page3.nextCursor).toBeNull();
      expect(page3.items[0].id).toBe(createdIds[4]);
    });
  });

  /* -------------------------------------------------------------
   * 6. BATCH INCLUDE LOADER (subtasks, checklist, tags)
   * ----------------------------------------------------------- */
  describe("6. Batch Include Loader (include=subtasks,checklist,tags)", () => {
    it("stitches subtasks, checklist, and tags in at most 3 batch queries with zero N+1", async () => {
      const { authHeaders } = await createAuthUser("BatchIncludeUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create tag
      const tag = await (
        await app.handle(
          new Request("http://localhost:3001/api/v1/tags", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name: "BatchTag" }),
          })
        )
      ).json() as any;

      // Create Parent Task 1 with Tag
      const t1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Task 1 with all features",
            listId: inboxId,
            tagIds: [tag.id],
          }),
        })
      );
      const task1 = (await t1Res.json()) as any;

      // Add Subtask to Task 1
      await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Subtask 1A",
            parentId: task1.id,
          }),
        })
      );

      // Add Checklist Item to Task 1
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task1.id}/checklist`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ text: "Check item 1" }),
        })
      );

      // Query GET /api/v1/tasks with include=subtasks,checklist,tags
      const batchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks?listId=${inboxId}&parentId=null&include=subtasks,checklist,tags`, {
          headers: authHeaders,
        })
      );
      expect(batchRes.status).toBe(200);
      const batchData = (await batchRes.json()) as any;
      expect(batchData.items.length).toBe(1);

      const returnedTask = batchData.items[0];
      expect(returnedTask.id).toBe(task1.id);
      expect(returnedTask.subtasks).toBeDefined();
      expect(returnedTask.subtasks.length).toBe(1);
      expect(returnedTask.subtasks[0].title).toBe("Subtask 1A");

      expect(returnedTask.checklist).toBeDefined();
      expect(returnedTask.checklist.length).toBe(1);
      expect(returnedTask.checklist[0].text).toBe("Check item 1");

      expect(returnedTask.tags).toBeDefined();
      expect(returnedTask.tags.length).toBe(1);
      expect(returnedTask.tags[0].name).toBe("BatchTag");

      // Verify single task endpoint with includes
      const singleRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task1.id}?include=subtasks,checklist,tags`, {
          headers: authHeaders,
        })
      );
      expect(singleRes.status).toBe(200);
      const singleTask = (await singleRes.json()) as any;
      expect(singleTask.subtasks.length).toBe(1);
      expect(singleTask.checklist.length).toBe(1);
      expect(singleTask.tags.length).toBe(1);
    });
  });

  /* -------------------------------------------------------------
   * 7. MULTI-TENANT ISOLATION & OBJECT-LEVEL AUTHORIZATION
   * ----------------------------------------------------------- */
  describe("7. Multi-Tenant Isolation & Object-Level Authorization", () => {
    it("strictly isolates User A's tasks, tags, and checklist from User B", async () => {
      const userA = await createAuthUser("TenantA");
      const userB = await createAuthUser("TenantB");

      const inboxA = await getUserInboxId(userA.authHeaders);
      const inboxB = await getUserInboxId(userB.authHeaders);

      // User A creates task, tag, checklist item
      const taskARes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({ title: "User A Secret Task", listId: inboxA }),
        })
      );
      const taskA = (await taskARes.json()) as any;

      const tagARes = await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({ name: "SecretTagA" }),
        })
      );
      const tagA = (await tagARes.json()) as any;

      const checkARes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}/checklist`, {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({ text: "User A Item" }),
        })
      );
      const checkA = (await checkARes.json()) as any;

      // 1. User B cannot read User A's task -> 404
      const readRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}`, {
          headers: userB.authHeaders,
        })
      );
      expect(readRes.status).toBe(404);

      // 2. User B cannot update User A's task -> 404
      const updateRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}`, {
          method: "PATCH",
          headers: userB.authHeaders,
          body: JSON.stringify({ title: "Hacked title" }),
        })
      );
      expect(updateRes.status).toBe(404);

      // 3. User B cannot delete User A's task -> 404
      const delTaskRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}`, {
          method: "DELETE",
          headers: userB.authHeaders,
        })
      );
      expect(delTaskRes.status).toBe(404);

      // 4. User B cannot access User A's task checklist -> 404
      const getCheckRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}/checklist`, {
          headers: userB.authHeaders,
        })
      );
      expect(getCheckRes.status).toBe(404);

      // 5. User B cannot update or delete User A's checklist item -> 404
      const patchCheckRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/checklist/${checkA.id}`, {
          method: "PATCH",
          headers: userB.authHeaders,
          body: JSON.stringify({ text: "Hacked item" }),
        })
      );
      expect(patchCheckRes.status).toBe(404);

      // 6. User B cannot update or delete User A's tag -> 404
      const patchTagRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tags/${tagA.id}`, {
          method: "PATCH",
          headers: userB.authHeaders,
          body: JSON.stringify({ name: "Hacked Tag" }),
        })
      );
      expect(patchTagRes.status).toBe(404);

      // 7. User B cannot use User A's task as a parent -> 404
      const subtaskBRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: userB.authHeaders,
          body: JSON.stringify({ title: "Subtask on A", parentId: taskA.id }),
        })
      );
      expect(subtaskBRes.status).toBe(404);

      // 8. User B cannot attach User A's tag -> 400
      const tagAttachRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: userB.authHeaders,
          body: JSON.stringify({
            title: "Task with stolen tag",
            listId: inboxB,
            tagIds: [tagA.id],
          }),
        })
      );
      expect(tagAttachRes.status).toBe(400);

      // 9. Unauthenticated requests are rejected with 401
      const unauthRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "GET",
        })
      );
      expect(unauthRes.status).toBe(401);
    });
  });
});
