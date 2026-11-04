import { describe, expect, it, beforeEach } from "bun:test";
import { app } from "../src/index";
import { db, tasks, lists, sections, tags, taskTags } from "../src/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { createAuthUser } from "./helpers";
import { registerCompleteHook, clearCompleteHooks } from "../src/utils/tasks";

describe("Phase 2 Part 3 Backend: Task Move/Reorder, Complete/Reopen, and Transactional Bulk Operations", () => {
  beforeEach(() => {
    clearCompleteHooks();
  });

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

  async function createList(name: string, authHeaders: Record<string, string>): Promise<string> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/lists", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    return body.id;
  }

  async function createSection(name: string, listId: string, authHeaders: Record<string, string>): Promise<string> {
    const res = await app.handle(
      new Request(`http://localhost:3001/api/v1/lists/${listId}/sections`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    return body.id;
  }

  async function createTag(name: string, authHeaders: Record<string, string>): Promise<string> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/tags", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name }),
      })
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    return body.id;
  }

  async function createTask(payload: Record<string, any>, authHeaders: Record<string, string>): Promise<any> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      })
    );
    expect(res.status).toBe(201);
    return await res.json();
  }

  /* -------------------------------------------------------------
   * 1. COMPLETE & REOPEN ENDPOINTS WITH HOOKS & SUBTASK CASCADING
   * ----------------------------------------------------------- */
  describe("1. Complete & Reopen Endpoints", () => {
    it("completes single task, runs onComplete hooks, and reopens properly", async () => {
      const { authHeaders } = await createAuthUser("CompleteUser1");
      const inboxId = await getUserInboxId(authHeaders);

      const task = await createTask({ title: "Solo Task", listId: inboxId }, authHeaders);

      // Register hook spy
      const completedTaskIds: string[] = [];
      registerCompleteHook((completedTask) => {
        completedTaskIds.push(completedTask.id);
      });

      // POST /tasks/:id/complete
      const completeRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/complete`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(completeRes.status).toBe(200);
      const completed = (await completeRes.json()) as any;
      expect(completed.id).toBe(task.id);
      expect(completed.status).toBe("done");
      expect(completed.completedAt).not.toBeNull();
      expect(completed.version).toBe(task.version + 1);

      // Verify hook ran
      expect(completedTaskIds).toContain(task.id);

      // POST /tasks/:id/reopen
      const reopenRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reopen`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(reopenRes.status).toBe(200);
      const reopened = (await reopenRes.json()) as any;
      expect(reopened.id).toBe(task.id);
      expect(reopened.status).toBe("todo");
      expect(reopened.completedAt).toBeNull();
      expect(reopened.version).toBe(completed.version + 1);
    });

    it("cascades status done to subtasks when completeSubtasks: true, and reopen only affects target", async () => {
      const { authHeaders } = await createAuthUser("CompleteCascadingUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create Root -> Subtask -> Grandchild
      const root = await createTask({ title: "Root Milestone", listId: inboxId }, authHeaders);
      const subtask = await createTask({ title: "Subtask Item", listId: inboxId, parentId: root.id }, authHeaders);
      const grandchild = await createTask({ title: "Grandchild Item", listId: inboxId, parentId: subtask.id }, authHeaders);

      // Complete root without completeSubtasks: true -> subtask remains todo
      const partialCompleteRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root.id}/complete`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ completeSubtasks: false }),
        })
      );
      expect(partialCompleteRes.status).toBe(200);

      // Check subtask still todo
      const getSubtask1 = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${subtask.id}`, { headers: authHeaders })
      );
      expect(((await getSubtask1.json()) as any).status).toBe("todo");

      // Reopen root
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root.id}/reopen`, {
          method: "POST",
          headers: authHeaders,
        })
      );

      // Now complete root with completeSubtasks: true
      const fullCompleteRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root.id}/complete`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ completeSubtasks: true }),
        })
      );
      expect(fullCompleteRes.status).toBe(200);

      // Subtask & Grandchild must now be done
      const getSubtask2 = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${subtask.id}`, { headers: authHeaders })
      );
      const subtaskData = (await getSubtask2.json()) as any;
      expect(subtaskData.status).toBe("done");
      expect(subtaskData.completedAt).not.toBeNull();

      const getGrandchild = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${grandchild.id}`, { headers: authHeaders })
      );
      const grandchildData = (await getGrandchild.json()) as any;
      expect(grandchildData.status).toBe("done");
      expect(grandchildData.completedAt).not.toBeNull();

      // Reopening root leaves subtask and grandchild intact (still done)
      const reopenRootRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root.id}/reopen`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(reopenRootRes.status).toBe(200);
      expect(((await reopenRootRes.json()) as any).status).toBe("todo");

      const checkSubtaskAfterReopen = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${subtask.id}`, { headers: authHeaders })
      );
      expect(((await checkSubtaskAfterReopen.json()) as any).status).toBe("done");
    });
  });

  /* -------------------------------------------------------------
   * 2. ENHANCED MOVE ENDPOINT & CROSS-LIST SECTION ISOLATION
   * ----------------------------------------------------------- */
  describe("2. Enhanced Move Endpoint with Cross-List Section Isolation", () => {
    it("resets sectionId to null when moving across lists without sectionId", async () => {
      const { authHeaders } = await createAuthUser("MoveCrossListUser");
      const listA = await createList("List Alpha", authHeaders);
      const listB = await createList("List Beta", authHeaders);
      const sectionA = await createSection("Section Alpha 1", listA, authHeaders);

      const parent = await createTask({ title: "Parent in Section", listId: listA, sectionId: sectionA }, authHeaders);
      expect(parent.sectionId).toBe(sectionA);
      expect(parent.listId).toBe(listA);

      const subtask = await createTask({ title: "Child Task", listId: listA, parentId: parent.id }, authHeaders);
      expect(subtask.listId).toBe(listA);

      // Move parent to listB without providing sectionId in request body
      const moveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${parent.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ listId: listB }),
        })
      );
      expect(moveRes.status).toBe(200);
      const movedParent = (await moveRes.json()) as any;
      expect(movedParent.listId).toBe(listB);
      expect(movedParent.sectionId).toBeNull(); // Cleaned up! Alien section not preserved

      // Descendant subtask must also have listId updated to listB
      const getChild = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${subtask.id}`, { headers: authHeaders })
      );
      const childData = (await getChild.json()) as any;
      expect(childData.listId).toBe(listB);
    });

    it("rejects move when alien section from another list is specified", async () => {
      const { authHeaders } = await createAuthUser("AlienSectionUser");
      const listA = await createList("List A", authHeaders);
      const listB = await createList("List B", authHeaders);
      const sectionA = await createSection("Section in A", listA, authHeaders);

      const taskInB = await createTask({ title: "Task in B", listId: listB }, authHeaders);

      // Attempt moving taskInB within listB, but targeting sectionA (belongs to listA)
      const invalidMoveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskInB.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ sectionId: sectionA }),
        })
      );
      expect(invalidMoveRes.status).toBe(404);
      const errorBody = (await invalidMoveRes.json()) as any;
      expect(errorBody.error).toMatch(/section/i);
    });
  });

  /* -------------------------------------------------------------
   * 3. TRANSACTIONAL POST /tasks/bulk: ALL-OR-NOTHING INVARIANT
   * ----------------------------------------------------------- */
  describe("3. Transactional Bulk Operations & 404 Rollback Invariant", () => {
    it("aborts transaction and returns 404 with missingIds when any ID is missing or unauthorized", async () => {
      const { authHeaders: authUserA } = await createAuthUser("BulkUserA");
      const { authHeaders: authUserB } = await createAuthUser("BulkUserB");
      const inboxA = await getUserInboxId(authUserA);
      const inboxB = await getUserInboxId(authUserB);

      const taskA1 = await createTask({ title: "Task A1", listId: inboxA, priority: 1 }, authUserA);
      const taskA2 = await createTask({ title: "Task A2", listId: inboxA, priority: 1 }, authUserA);
      const taskB1 = await createTask({ title: "Task B1", listId: inboxB, priority: 1 }, authUserB);

      // User A tries bulk update with [taskA1.id, taskA2.id, taskB1.id, "nonexistent-id"]
      const bulkRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authUserA,
          body: JSON.stringify({
            ids: [taskA1.id, taskA2.id, taskB1.id, "nonexistent-id"],
            action: "set_priority",
            payload: { priority: 4 },
          }),
        })
      );

      expect(bulkRes.status).toBe(404);
      const body = (await bulkRes.json()) as any;
      expect(body.error).toBe("One or more tasks not found");
      expect(body.missingIds).toBeArray();
      expect(body.missingIds).toContain(taskB1.id);
      expect(body.missingIds).toContain("nonexistent-id");

      // Verify ZERO rows were changed (taskA1 and taskA2 are still priority 1, version unchanged)
      const [freshA1] = await db.select().from(tasks).where(eq(tasks.id, taskA1.id));
      const [freshA2] = await db.select().from(tasks).where(eq(tasks.id, taskA2.id));
      expect(freshA1.priority).toBe(1);
      expect(freshA1.version).toBe(taskA1.version);
      expect(freshA2.priority).toBe(1);
      expect(freshA2.version).toBe(taskA2.version);
    });

    it("rejects empty ids or ids exceeding 200", async () => {
      const { authHeaders } = await createAuthUser("BulkLimitUser");

      const emptyRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [],
            action: "archive",
          }),
        })
      );
      expect([400, 422]).toContain(emptyRes.status);

      const tooManyIds = Array.from({ length: 201 }, (_, i) => `fake-id-${i}`);
      const limitRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: tooManyIds,
            action: "archive",
          }),
        })
      );
      expect([400, 422]).toContain(limitRes.status);
    });
  });

  /* -------------------------------------------------------------
   * 4. THE 8 BULK ACTIONS EXECUTION & INTEGRATION
   * ----------------------------------------------------------- */
  describe("4. The 8 Bulk Actions Execution", () => {
    it("action: move appends tasks in order with fractional keys and cascades listId to descendants", async () => {
      const { authHeaders } = await createAuthUser("BulkMoveUser");
      const list1 = await createList("Source List", authHeaders);
      const list2 = await createList("Target List", authHeaders);
      const targetSection = await createSection("Target Section", list2, authHeaders);

      // Pre-seed an item in target section
      const existingInTarget = await createTask(
        { title: "Existing Target Task", listId: list2, sectionId: targetSection },
        authHeaders
      );

      // Create 3 tasks in list1
      const t1 = await createTask({ title: "Task 1", listId: list1 }, authHeaders);
      const t2 = await createTask({ title: "Task 2", listId: list1 }, authHeaders);
      const t3 = await createTask({ title: "Task 3", listId: list1 }, authHeaders);

      // Create a subtask under t1
      const subtaskOfT1 = await createTask({ title: "Subtask of T1", listId: list1, parentId: t1.id }, authHeaders);

      // Execute bulk move in order [t1, t2, t3] into list2 and targetSection
      const moveRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [t1.id, t2.id, t3.id],
            action: "move",
            payload: {
              listId: list2,
              sectionId: targetSection,
            },
          }),
        })
      );
      expect(moveRes.status).toBe(200);

      // Fetch fresh positions
      const movedTasks = await db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, [t1.id, t2.id, t3.id]));

      const movedMap = new Map(movedTasks.map((t) => [t.id, t]));
      const t1Fresh = movedMap.get(t1.id)!;
      const t2Fresh = movedMap.get(t2.id)!;
      const t3Fresh = movedMap.get(t3.id)!;

      // Verify listId and sectionId
      expect(t1Fresh.listId).toBe(list2);
      expect(t1Fresh.sectionId).toBe(targetSection);
      expect(t2Fresh.listId).toBe(list2);
      expect(t3Fresh.listId).toBe(list2);

      // Verify ordering: existingInTarget < t1 < t2 < t3
      expect(t1Fresh.position > existingInTarget.position).toBe(true);
      expect(t2Fresh.position > t1Fresh.position).toBe(true);
      expect(t3Fresh.position > t2Fresh.position).toBe(true);

      // Verify subtask had its listId cascaded
      const [subtaskFresh] = await db.select().from(tasks).where(eq(tasks.id, subtaskOfT1.id));
      expect(subtaskFresh.listId).toBe(list2);
    });

    it("action: tag and untag links and unlinks tags idempotently", async () => {
      const { authHeaders } = await createAuthUser("BulkTagUser");
      const inboxId = await getUserInboxId(authHeaders);

      const tag1 = await createTag("Urgent", authHeaders);
      const tag2 = await createTag("Feature", authHeaders);

      const t1 = await createTask({ title: "Tag Task 1", listId: inboxId }, authHeaders);
      const t2 = await createTask({ title: "Tag Task 2", listId: inboxId }, authHeaders);

      // Bulk Tag
      const tagRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [t1.id, t2.id],
            action: "tag",
            payload: { tagIds: [tag1, tag2] },
          }),
        })
      );
      expect(tagRes.status).toBe(200);

      // Verify mappings in db
      const mappings = await db
        .select()
        .from(taskTags)
        .where(inArray(taskTags.taskId, [t1.id, t2.id]));
      expect(mappings.length).toBe(4);

      // Calling tag again is idempotent
      const retagRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [t1.id, t2.id],
            action: "tag",
            payload: { tagId: tag1 },
          }),
        })
      );
      expect(retagRes.status).toBe(200);

      // Bulk Untag tag1
      const untagRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [t1.id, t2.id],
            action: "untag",
            payload: { tagId: tag1 },
          }),
        })
      );
      expect(untagRes.status).toBe(200);

      const remainingMappings = await db
        .select()
        .from(taskTags)
        .where(inArray(taskTags.taskId, [t1.id, t2.id]));
      expect(remainingMappings.length).toBe(2);
      expect(remainingMappings.every((m) => m.tagId === tag2)).toBe(true);
    });

    it("action: complete and reopen with hooks and subtask cascade", async () => {
      const { authHeaders } = await createAuthUser("BulkCompleteUser");
      const inboxId = await getUserInboxId(authHeaders);

      const parent = await createTask({ title: "Parent Task", listId: inboxId }, authHeaders);
      const subtask = await createTask({ title: "Sub Task", listId: inboxId, parentId: parent.id }, authHeaders);
      const standalone = await createTask({ title: "Standalone Task", listId: inboxId }, authHeaders);

      const completedIds: string[] = [];
      registerCompleteHook((t) => {
        completedIds.push(t.id);
      });

      // Bulk Complete with completeSubtasks: true
      const completeRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [parent.id, standalone.id],
            action: "complete",
            payload: { completeSubtasks: true },
          }),
        })
      );
      expect(completeRes.status).toBe(200);

      const allTasks = await db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, [parent.id, subtask.id, standalone.id]));

      expect(allTasks.every((t) => t.status === "done" && t.completedAt !== null)).toBe(true);
      expect(completedIds).toContain(parent.id);
      expect(completedIds).toContain(standalone.id);

      // Bulk Reopen parent & standalone
      const reopenRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [parent.id, standalone.id],
            action: "reopen",
          }),
        })
      );
      expect(reopenRes.status).toBe(200);

      const [freshParent] = await db.select().from(tasks).where(eq(tasks.id, parent.id));
      const [freshSubtask] = await db.select().from(tasks).where(eq(tasks.id, subtask.id));
      expect(freshParent.status).toBe("todo");
      expect(freshParent.completedAt).toBeNull();
      // Reopen does not affect subtasks
      expect(freshSubtask.status).toBe("done");
    });

    it("action: set_priority updates priority and validates 0-4 range", async () => {
      const { authHeaders } = await createAuthUser("BulkPriorityUser");
      const inboxId = await getUserInboxId(authHeaders);

      const t1 = await createTask({ title: "P1 Task", listId: inboxId, priority: 0 }, authHeaders);
      const t2 = await createTask({ title: "P2 Task", listId: inboxId, priority: 0 }, authHeaders);

      // Invalid priority 5
      const invalidRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [t1.id, t2.id],
            action: "set_priority",
            payload: { priority: 5 },
          }),
        })
      );
      expect(invalidRes.status).toBe(400);

      // Valid priority 3
      const validRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [t1.id, t2.id],
            action: "set_priority",
            payload: { priority: 3 },
          }),
        })
      );
      expect(validRes.status).toBe(200);

      const updated = await db.select().from(tasks).where(inArray(tasks.id, [t1.id, t2.id]));
      expect(updated.every((t) => t.priority === 3)).toBe(true);
    });

    it("action: archive sets archivedAt", async () => {
      const { authHeaders } = await createAuthUser("BulkArchiveUser");
      const inboxId = await getUserInboxId(authHeaders);

      const t1 = await createTask({ title: "Archive Me 1", listId: inboxId }, authHeaders);
      const t2 = await createTask({ title: "Archive Me 2", listId: inboxId }, authHeaders);

      const archiveRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [t1.id, t2.id],
            action: "archive",
          }),
        })
      );
      expect(archiveRes.status).toBe(200);

      const archived = await db.select().from(tasks).where(inArray(tasks.id, [t1.id, t2.id]));
      expect(archived.every((t) => t.archivedAt !== null)).toBe(true);
    });

    it("action: delete soft deletes tasks and cascades down subtree", async () => {
      const { authHeaders } = await createAuthUser("BulkDeleteUser");
      const inboxId = await getUserInboxId(authHeaders);

      const parent = await createTask({ title: "Parent to Delete", listId: inboxId }, authHeaders);
      const subtask = await createTask({ title: "Sub to Delete", listId: inboxId, parentId: parent.id }, authHeaders);
      const standalone = await createTask({ title: "Standalone Delete", listId: inboxId }, authHeaders);

      const deleteRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/bulk", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            ids: [parent.id, standalone.id],
            action: "delete",
          }),
        })
      );
      expect(deleteRes.status).toBe(200);

      const all = await db
        .select()
        .from(tasks)
        .where(inArray(tasks.id, [parent.id, subtask.id, standalone.id]));

      expect(all.every((t) => t.deletedAt !== null)).toBe(true);
    });
  });
});
