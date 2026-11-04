import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { db, tasks, checklistItems, tags, taskTags } from "../src/db";
import { and, eq, isNull } from "drizzle-orm";
import { createAuthUser } from "./helpers";

describe("Phase 2 Part 5 Backend: Task Deep Duplication", () => {
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

  it("duplicates a task with '(copy)' title, resets status to todo, and copies tags and checklist", async () => {
    const { user, authHeaders } = await createAuthUser("DuplicateUser1");
    const inboxId = await getUserInboxId(authHeaders);

    // 1. Create a tag
    const tagRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tags", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: "DevOps", color: "#ff5722" }),
      })
    );
    expect(tagRes.status).toBe(201);
    const tag = (await tagRes.json()) as any;

    // 2. Create original task
    const taskRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Configure CI Pipeline",
          notes: "GitHub actions and Docker build",
          priority: 3,
          listId: inboxId,
          estimateMin: 45,
          tagIds: [tag.id],
        }),
      })
    );
    expect(taskRes.status).toBe(201);
    const original = (await taskRes.json()) as any;

    // Mark original as done
    await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${original.id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ status: "done" }),
      })
    );

    // Add 2 checklist items to original task
    const ch1Res = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${original.id}/checklist`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ text: "Write workflow YAML" }),
      })
    );
    expect(ch1Res.status).toBe(201);
    const ch1 = (await ch1Res.json()) as any;

    // Mark first checklist item as done
    await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${original.id}/checklist/${ch1.id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ done: true }),
      })
    );

    const ch2Res = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${original.id}/checklist`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ text: "Add Docker credentials" }),
      })
    );
    expect(ch2Res.status).toBe(201);

    // 3. Duplicate task
    const dupRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${original.id}/duplicate`, {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(dupRes.status).toBe(201);
    const duplicated = (await dupRes.json()) as any;

    // Verify root duplicated task properties
    expect(duplicated.id).toBeDefined();
    expect(duplicated.id).not.toBe(original.id);
    expect(duplicated.title).toBe("Configure CI Pipeline (copy)");
    expect(duplicated.notes).toBe("GitHub actions and Docker build");
    expect(duplicated.priority).toBe(3);
    expect(duplicated.status).toBe("todo"); // reset
    expect(duplicated.completedAt).toBeNull();
    expect(duplicated.archivedAt).toBeNull();
    expect(duplicated.position).toBeDefined();
    expect(duplicated.position > original.position).toBe(true);

    // Verify checklist items copied and done reset to false
    expect(duplicated.checklist).toBeDefined();
    expect(duplicated.checklist.length).toBe(2);
    expect(duplicated.checklist[0].id).not.toBe(ch1.id);
    expect(duplicated.checklist[0].taskId).toBe(duplicated.id);
    expect(duplicated.checklist[0].text).toBe("Write workflow YAML");
    expect(duplicated.checklist[0].done).toBe(false); // reset to false!
    expect(duplicated.checklist[1].taskId).toBe(duplicated.id);
    expect(duplicated.checklist[1].text).toBe("Add Docker credentials");
    expect(duplicated.checklist[1].done).toBe(false);

    // Verify tags copied
    expect(duplicated.tags).toBeDefined();
    expect(duplicated.tags.length).toBe(1);
    expect(duplicated.tags[0].id).toBe(tag.id);
    expect(duplicated.tags[0].name).toBe("DevOps");

    // Verify in database directly
    const [dbTask] = await db.select().from(tasks).where(eq(tasks.id, duplicated.id));
    expect(dbTask).toBeDefined();
    expect(dbTask.title).toBe("Configure CI Pipeline (copy)");
    expect(dbTask.status).toBe("todo");

    const dbChecklist = await db.select().from(checklistItems).where(eq(checklistItems.taskId, duplicated.id));
    expect(dbChecklist.length).toBe(2);
    expect(dbChecklist.every((c) => c.done === false)).toBe(true);
  });

  it("deeply duplicates a 3-level subtask tree, remapping parent IDs and keeping subtask titles", async () => {
    const { user, authHeaders } = await createAuthUser("DuplicateHierarchyUser");
    const inboxId = await getUserInboxId(authHeaders);

    // Create Root Task
    const rootRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Root Project",
          listId: inboxId,
        }),
      })
    );
    expect(rootRes.status).toBe(201);
    const rootTask = (await rootRes.json()) as any;

    // Create Subtask (Level 2)
    const subRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Subtask Step 1",
          listId: inboxId,
          parentId: rootTask.id,
        }),
      })
    );
    expect(subRes.status).toBe(201);
    const subTask = (await subRes.json()) as any;

    // Create Grandchild (Level 3)
    const grandRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Grandchild Micro Action",
          listId: inboxId,
          parentId: subTask.id,
        }),
      })
    );
    expect(grandRes.status).toBe(201);
    const grandTask = (await grandRes.json()) as any;

    // Add checklist to Subtask
    await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${subTask.id}/checklist`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ text: "Subtask checklist item" }),
      })
    );

    // Duplicate Root
    const dupRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${rootTask.id}/duplicate`, {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(dupRes.status).toBe(201);
    const duplicatedTree = (await dupRes.json()) as any;

    // Root checks
    expect(duplicatedTree.title).toBe("Root Project (copy)");
    expect(duplicatedTree.id).not.toBe(rootTask.id);
    expect(duplicatedTree.subtasks.length).toBe(1);

    // Level 2 Subtask checks
    const dupSubtask = duplicatedTree.subtasks[0];
    expect(dupSubtask.id).not.toBe(subTask.id);
    expect(dupSubtask.title).toBe("Subtask Step 1"); // retains title
    expect(dupSubtask.parentId).toBe(duplicatedTree.id); // remapped to new root!
    expect(dupSubtask.checklist.length).toBe(1);
    expect(dupSubtask.checklist[0].text).toBe("Subtask checklist item");
    expect(dupSubtask.checklist[0].taskId).toBe(dupSubtask.id);
    expect(dupSubtask.subtasks.length).toBe(1);

    // Level 3 Grandchild checks
    const dupGrandchild = dupSubtask.subtasks[0];
    expect(dupGrandchild.id).not.toBe(grandTask.id);
    expect(dupGrandchild.title).toBe("Grandchild Micro Action"); // retains title
    expect(dupGrandchild.parentId).toBe(dupSubtask.id); // remapped to new subtask!

    // Verify all 3 tasks in DB
    const allDbTasks = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, user.id), isNull(tasks.deletedAt)));
    // 3 original + 3 duplicated = 6 tasks
    expect(allDbTasks.length).toBe(6);
  });

  it("duplicates a subtask within the same parent and positions it right after original", async () => {
    const { user, authHeaders } = await createAuthUser("DuplicateSubtaskUser");
    const inboxId = await getUserInboxId(authHeaders);

    const rootRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ title: "Container Task", listId: inboxId }),
      })
    );
    const rootTask = (await rootRes.json()) as any;

    const sub1Res = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ title: "Subtask 1", listId: inboxId, parentId: rootTask.id }),
      })
    );
    const sub1 = (await sub1Res.json()) as any;

    const sub2Res = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ title: "Subtask 2", listId: inboxId, parentId: rootTask.id }),
      })
    );
    const sub2 = (await sub2Res.json()) as any;

    // Duplicate Subtask 1
    const dupRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${sub1.id}/duplicate`, {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(dupRes.status).toBe(201);
    const dupSub1 = (await dupRes.json()) as any;

    expect(dupSub1.title).toBe("Subtask 1 (copy)");
    expect(dupSub1.parentId).toBe(rootTask.id); // same parent!
    // Position must be after sub1 and before sub2
    expect(dupSub1.position > sub1.position).toBe(true);
    expect(dupSub1.position < sub2.position).toBe(true);
  });

  it("enforces multi-tenant isolation and 404 on invalid IDs", async () => {
    const userA = await createAuthUser("DupTenantA");
    const userB = await createAuthUser("DupTenantB");
    const inboxA = await getUserInboxId(userA.authHeaders);

    const taskARes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: userA.authHeaders,
        body: JSON.stringify({ title: "User A Secret Task", listId: inboxA }),
      })
    );
    const taskA = (await taskARes.json()) as any;

    // User B attempts to duplicate User A's task -> 404
    const alienRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}/duplicate`, {
        method: "POST",
        headers: userB.authHeaders,
      })
    );
    expect(alienRes.status).toBe(404);

    // Non-existent ID -> 404
    const missingRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks/non-existent-id/duplicate", {
        method: "POST",
        headers: userA.authHeaders,
      })
    );
    expect(missingRes.status).toBe(404);
  });
});
