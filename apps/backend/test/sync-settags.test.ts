import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { db, taskTags } from "../src/db";
import { eq } from "drizzle-orm";
import { createAuthUser } from "./helpers";

async function getInboxId(authHeaders: Record<string, string>): Promise<string> {
  const res = await app.handle(
    new Request("http://localhost:3001/api/v1/lists", { headers: authHeaders })
  );
  expect(res.status).toBe(200);
  const lists = (await res.json()) as Array<{ id: string; isInbox: boolean }>;
  return lists.find((l) => l.isInbox)!.id;
}

async function push(authHeaders: Record<string, string>, mutations: any[]) {
  const res = await app.handle(
    new Request("http://localhost:3001/api/v1/sync/push", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ mutations }),
    })
  );
  expect(res.status).toBe(200);
  return (await res.json()) as any;
}

async function createTag(authHeaders: Record<string, string>, name: string) {
  const res = await app.handle(
    new Request("http://localhost:3001/api/v1/tags", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ name }),
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()) as any;
}

async function createTask(authHeaders: Record<string, string>, listId: string, title: string) {
  const res = await app.handle(
    new Request("http://localhost:3001/api/v1/tasks", {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ title, listId }),
    })
  );
  expect(res.status).toBe(201);
  return (await res.json()) as any;
}

describe("Sync push: tasks setTags", () => {
  it("attaches 2 tags, replaces with 1, rejects alien tag and alien task", async () => {
    const userA = await createAuthUser("SetTagsA");
    const userB = await createAuthUser("SetTagsB");
    const inboxA = await getInboxId(userA.authHeaders);
    const inboxB = await getInboxId(userB.authHeaders);

    const tag1 = await createTag(userA.authHeaders, "SetTagOne");
    const tag2 = await createTag(userA.authHeaders, "SetTagTwo");
    const tag3 = await createTag(userA.authHeaders, "SetTagThree");
    const alienTag = await createTag(userB.authHeaders, "AlienTag");
    const task = await createTask(userA.authHeaders, inboxA, "Tagged sync task");

    const now = Date.now();

    // attach 2 tags
    let data = await push(userA.authHeaders, [
      { id: `m-st-1-${now}`, entity: "tasks", op: "setTags", entityId: task.id, patch: { tagIds: [tag1.id, tag2.id] }, editedAt: now },
    ]);
    expect(data.results[0].status).toBe("applied");
    const seqAfterAttach = data.results[0].seq;
    expect(seqAfterAttach).toBeGreaterThan(0);
    let links = db.select().from(taskTags).where(eq(taskTags.taskId, task.id)).all();
    expect(links.map((l) => l.tagId).sort()).toEqual([tag1.id, tag2.id].sort());

    // replace with 1 (last-write-wins whole set)
    data = await push(userA.authHeaders, [
      { id: `m-st-2-${now}`, entity: "tasks", op: "setTags", entityId: task.id, patch: { tagIds: [tag3.id] }, editedAt: now + 1000 },
    ]);
    expect(data.results[0].status).toBe("applied");
    expect(data.results[0].seq).toBeGreaterThan(seqAfterAttach);
    links = db.select().from(taskTags).where(eq(taskTags.taskId, task.id)).all();
    expect(links.map((l) => l.tagId)).toEqual([tag3.id]);

    // replace with empty set clears all
    data = await push(userA.authHeaders, [
      { id: `m-st-3-${now}`, entity: "tasks", op: "setTags", entityId: task.id, patch: { tagIds: [] }, editedAt: now + 2000 },
    ]);
    expect(data.results[0].status).toBe("applied");
    links = db.select().from(taskTags).where(eq(taskTags.taskId, task.id)).all();
    expect(links.length).toBe(0);

    // alien tag rejected
    data = await push(userA.authHeaders, [
      { id: `m-st-4-${now}`, entity: "tasks", op: "setTags", entityId: task.id, patch: { tagIds: [alienTag.id] }, editedAt: now + 3000 },
    ]);
    expect(data.results[0].status).toBe("rejected");

    // alien task rejected (user B tries to retag user A's task)
    data = await push(userB.authHeaders, [
      { id: `m-st-5-${now}`, entity: "tasks", op: "setTags", entityId: task.id, patch: { tagIds: [] }, editedAt: now + 4000 },
    ]);
    expect(data.results[0].status).toBe("rejected");

    // sanity: user B can setTags on their own task
    const taskB = await createTask(userB.authHeaders, inboxB, "B task");
    data = await push(userB.authHeaders, [
      { id: `m-st-6-${now}`, entity: "tasks", op: "setTags", entityId: taskB.id, patch: { tagIds: [alienTag.id] }, editedAt: now + 5000 },
    ]);
    expect(data.results[0].status).toBe("applied");
  });
});
