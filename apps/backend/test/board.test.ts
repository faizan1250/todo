import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { eq } from "drizzle-orm";

describe("Phase 4 Kanban Board & Column Grouping", () => {
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

  async function createTask(
    authHeaders: Record<string, string>,
    payload: Record<string, any>
  ): Promise<any> {
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

  it("groups tasks by section, status, and priority", async () => {
    const { authHeaders, user } = await createAuthUser("BoardGroupUser");
    const inboxId = await getUserInboxId(authHeaders);

    // 1. Create a section
    const secRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/lists/${inboxId}/sections`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          name: "In Review",
        }),
      })
    );
    expect(secRes.status).toBe(201);
    const section = (await secRes.json()) as any;

    // 2. Create tasks
    // Task 1: unsectioned, priority 4, status todo
    const t1 = await createTask(authHeaders, {
      title: "Unsectioned Task",
      listId: inboxId,
      priority: 4,
      status: "todo",
    });

    // Task 2: in section, priority 2, status in_progress
    const t2 = await createTask(authHeaders, {
      title: "Sectioned Task",
      listId: inboxId,
      sectionId: section.id,
      priority: 2,
      status: "in_progress",
    });

    // Task 3: done task
    const t3 = await createTask(authHeaders, {
      title: "Done Task",
      listId: inboxId,
      priority: 1,
      status: "done",
    });

    // 3. Test GET /api/v1/board?group_by=section
    const secBoardRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/board?list_id=${inboxId}&group_by=section`, {
        headers: authHeaders,
      })
    );
    expect(secBoardRes.status).toBe(200);
    const secBoard = (await secBoardRes.json()) as any;
    expect(secBoard.columns.length).toBe(2); // No Section + In Review
    expect(secBoard.columns[0].key).toBe("no_section");
    expect(secBoard.columns[0].tasks.some((t: any) => t.id === t1.id)).toBe(true);
    expect(secBoard.columns[1].key).toBe(section.id);
    expect(secBoard.columns[1].tasks.some((t: any) => t.id === t2.id)).toBe(true);

    // 4. Test GET /api/v1/board?group_by=status
    const statusBoardRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/board?list_id=${inboxId}&group_by=status`, {
        headers: authHeaders,
      })
    );
    expect(statusBoardRes.status).toBe(200);
    const statusBoard = (await statusBoardRes.json()) as any;
    expect(statusBoard.columns.length).toBe(3); // todo, in_progress, done
    const todoCol = statusBoard.columns.find((c: any) => c.key === "todo");
    const inProgCol = statusBoard.columns.find((c: any) => c.key === "in_progress");
    const doneCol = statusBoard.columns.find((c: any) => c.key === "done");
    expect(todoCol.tasks.some((t: any) => t.id === t1.id)).toBe(true);
    expect(inProgCol.tasks.some((t: any) => t.id === t2.id)).toBe(true);
    expect(doneCol.tasks.some((t: any) => t.id === t3.id)).toBe(true);

    // 5. Test GET /api/v1/board?group_by=priority
    const prioBoardRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/board?list_id=${inboxId}&group_by=priority`, {
        headers: authHeaders,
      })
    );
    expect(prioBoardRes.status).toBe(200);
    const prioBoard = (await prioBoardRes.json()) as any;
    expect(prioBoard.columns.length).toBe(5); // 4, 3, 2, 1, 0
    const p4Col = prioBoard.columns.find((c: any) => c.key === "4");
    const p2Col = prioBoard.columns.find((c: any) => c.key === "2");
    expect(p4Col.tasks.some((t: any) => t.id === t1.id)).toBe(true);
    expect(p2Col.tasks.some((t: any) => t.id === t2.id)).toBe(true);
  });

  it("moves task between columns, updates positions, and triggers recurrence hook when moving to done", async () => {
    const { authHeaders, user } = await createAuthUser("BoardMoveUser");
    const inboxId = await getUserInboxId(authHeaders);

    // Create recurring task
    const recurring = await createTask(authHeaders, {
      title: "Recurring Board Task",
      listId: inboxId,
      dueAt: new Date().toISOString(),
      priority: 3,
    });

    // Attach recurrence rule
    const recRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${recurring.id}/recurrence`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          rrule: "FREQ=DAILY;INTERVAL=1",
          mode: "fixed",
        }),
      })
    );
    expect(recRes.status).toBe(200);

    // Move task to 'done' column via POST /api/v1/board/move
    const moveRes = await app.handle(
      new Request("http://localhost:3001/api/v1/board/move", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          taskId: recurring.id,
          column: "done",
        }),
      })
    );

    expect(moveRes.status).toBe(200);
    const moveData = (await moveRes.json()) as any;
    expect(moveData.task.status).toBe("done");
    expect(moveData.task.completedAt).toBeDefined();

    // Verify next recurring instance was spawned!
    expect(moveData.nextTask).toBeDefined();
    expect(moveData.nextTask.id).not.toBe(recurring.id);
    expect(moveData.nextTask.status).toBe("todo");
    expect(moveData.nextTask.title).toBe("Recurring Board Task");

    // Also check task in db
    const [dbTask] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, recurring.id));
    expect(dbTask.status).toBe("done");
  });
});
