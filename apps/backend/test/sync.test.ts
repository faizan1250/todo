import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";

describe("Phase 5 Sync", () => {
  async function getUserInboxId(authHeaders: Record<string, string>): Promise<string> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/lists", { headers: authHeaders })
    );
    expect(res.status).toBe(200);
    const userLists = (await res.json()) as Array<{ id: string; isInbox: boolean }>;
    const inbox = userLists.find((l) => l.isInbox);
    expect(inbox).toBeDefined();
    return inbox!.id;
  }

  async function pull(authHeaders: Record<string, string>, cursor = "") {
    const url = cursor
      ? `http://localhost:3001/api/v1/sync?cursor=${encodeURIComponent(cursor)}`
      : "http://localhost:3001/api/v1/sync";
    const res = await app.handle(new Request(url, { headers: authHeaders }));
    return res;
  }

  async function push(authHeaders: Record<string, string>, mutations: any[]) {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/sync/push", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ mutations }),
      })
    );
    return res;
  }

  it("idempotency: replaying the same mutation returns duplicate", async () => {
    const { authHeaders } = await createAuthUser("SyncIdemp");
    const inboxId = await getUserInboxId(authHeaders);

    const mutationId = `m-${Date.now()}-${Math.random()}`;
    const entityId = `task-${Date.now()}-${Math.random()}`;
    const mutation = {
      id: mutationId,
      entity: "tasks",
      op: "create",
      entityId,
      patch: { title: "Idempotent Task", listId: inboxId },
      editedAt: Date.now(),
    };

    const first = await push(authHeaders, [mutation]);
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as any;
    expect(firstData.results[0].status).toBe("applied");

    const second = await push(authHeaders, [mutation]);
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as any;
    expect(secondData.results[0].status).toBe("duplicate");
  });

  it("pull: returns newly pushed entities when advancing cursor", async () => {
    const { authHeaders } = await createAuthUser("SyncPull");
    const inboxId = await getUserInboxId(authHeaders);

    const initial = await pull(authHeaders);
    expect(initial.status).toBe(200);
    const initialData = (await initial.json()) as any;
    const cursor0 = initialData.cursor;

    const entityId = `task-pull-${Date.now()}-${Math.random()}`;
    const mutation = {
      id: `m-${Date.now()}-${Math.random()}`,
      entity: "tasks",
      op: "create",
      entityId,
      patch: { title: "Pulled Task", listId: inboxId },
      editedAt: Date.now(),
    };
    const pushRes = await push(authHeaders, [mutation]);
    expect(pushRes.status).toBe(200);

    const after = await pull(authHeaders, cursor0);
    expect(after.status).toBe(200);
    const afterData = (await after.json()) as any;
    const tasks = afterData.changes.tasks ?? [];
    expect(tasks.some((t: any) => t.id === entityId)).toBe(true);
  });

  it("resync: invalid cursor triggers 409 with resync flag", async () => {
    const { authHeaders } = await createAuthUser("SyncResync");
    await getUserInboxId(authHeaders);

    const bad = await pull(authHeaders, "not-a-cursor");
    expect(bad.status).toBe(409);
    const badData = (await bad.json()) as any;
    expect(badData.resync).toBe(true);

    // epoch mismatch
    const initial = await pull(authHeaders);
    const initialData = (await initial.json()) as any;
    const epoch = initialData.cursor.split(":")[0];
    const mismatched = await pull(authHeaders, `${epoch}x:0`);
    expect(mismatched.status).toBe(409);
    const mismatchedData = (await mismatched.json()) as any;
    expect(mismatchedData.resync).toBe(true);
  });

  it("isolation: users cannot see each other's synced data", async () => {
    const userA = await createAuthUser("SyncIsoA");
    const userB = await createAuthUser("SyncIsoB");
    const inboxA = await getUserInboxId(userA.authHeaders);

    const entityId = `task-iso-${Date.now()}-${Math.random()}`;
    const mutation = {
      id: `m-${Date.now()}-${Math.random()}`,
      entity: "tasks",
      op: "create",
      entityId,
      patch: { title: "User A Secret Sync Task", listId: inboxA },
      editedAt: Date.now(),
    };
    const pushRes = await push(userA.authHeaders, [mutation]);
    expect(pushRes.status).toBe(200);

    const bSync = await pull(userB.authHeaders);
    expect(bSync.status).toBe(200);
    const bData = (await bSync.json()) as any;
    const bTasks = bData.changes.tasks ?? [];
    expect(bTasks.some((t: any) => t.id === entityId)).toBe(false);
  });

  it("conflicts: older editedAt does not overwrite newer field value (LWW)", async () => {
    const { authHeaders } = await createAuthUser("SyncConflict");
    const inboxId = await getUserInboxId(authHeaders);

    const entityId = `task-conflict-${Date.now()}-${Math.random()}`;
    const now = Date.now();
    const createMutation = {
      id: `m-create-${Date.now()}-${Math.random()}`,
      entity: "tasks",
      op: "create",
      entityId,
      patch: { title: "Original Title", listId: inboxId },
      editedAt: now,
    };
    const createRes = await push(authHeaders, [createMutation]);
    expect(createRes.status).toBe(200);

    // Attempt an update with an older editedAt
    const updateMutation = {
      id: `m-update-${Date.now()}-${Math.random()}`,
      entity: "tasks",
      op: "update",
      entityId,
      patch: { title: "Should Not Win" },
      editedAt: now - 10_000,
    };
    const updateRes = await push(authHeaders, [updateMutation]);
    expect(updateRes.status).toBe(200);

    // Pull and verify title remains original
    const syncRes = await pull(authHeaders);
    expect(syncRes.status).toBe(200);
    const syncData = (await syncRes.json()) as any;
    const tasks = syncData.changes.tasks ?? [];
    const task = tasks.find((t: any) => t.id === entityId);
    // task may or may not appear depending on seq cursor (empty cursor returns all seq>0? Actually empty seq=0 returns all)
    // If not in this pull, fetch via tasks endpoint
    if (task) {
      expect(task.title).toBe("Original Title");
    } else {
      const taskRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${entityId}`, { headers: authHeaders })
      );
      expect(taskRes.status).toBe(200);
      const taskData = (await taskRes.json()) as any;
      expect(taskData.title).toBe("Original Title");
    }
  });
});