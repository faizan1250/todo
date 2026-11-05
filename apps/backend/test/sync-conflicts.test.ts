import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";

describe("Sync conflicts history", () => {
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

  async function push(authHeaders: Record<string, string>, mutations: any[], deviceId?: string) {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/sync/push", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(deviceId ? { deviceId, mutations } : { mutations }),
      })
    );
    return res;
  }

  async function getConflicts(authHeaders: Record<string, string>, qs = "") {
    const res = await app.handle(
      new Request(`http://localhost:3001/api/v1/sync/conflicts${qs}`, {
        headers: authHeaders,
      })
    );
    return res;
  }

  it("tasks path: stale field edit is recorded and listed newest-first", async () => {
    const { authHeaders } = await createAuthUser("SyncConfHist");
    const inboxId = await getUserInboxId(authHeaders);
    const now = Date.now();

    const entityId = `task-confhist-${now}-${Math.random().toString(36).slice(2)}`;
    const createRes = await push(authHeaders, [
      {
        id: `m-ch-create-${now}`,
        entity: "tasks",
        op: "create",
        entityId,
        patch: { title: "Original", listId: inboxId },
        editedAt: now,
      },
    ]);
    expect(createRes.status).toBe(200);

    // Winning edit: newer editedAt sets the field timestamp.
    const winRes = await push(
      authHeaders,
      [
        {
          id: `m-ch-win-${now}`,
          entity: "tasks",
          op: "update",
          entityId,
          patch: { title: "Newer Title" },
          editedAt: now + 20_000,
        },
      ],
      "device-a"
    );
    expect(winRes.status).toBe(200);
    expect(((await winRes.json()) as any).results[0].status).toBe("applied");

    // Losing edit: older editedAt arrives second and must not overwrite.
    const loseRes = await push(
      authHeaders,
      [
        {
          id: `m-ch-lose-${now}`,
          entity: "tasks",
          op: "update",
          entityId,
          patch: { title: "Stale Title" },
          editedAt: now + 10_000,
        },
      ],
      "device-b"
    );
    expect(loseRes.status).toBe(200);
    expect(((await loseRes.json()) as any).results[0].status).toBe("applied");

    const confRes = await getConflicts(authHeaders);
    expect(confRes.status).toBe(200);
    const data = (await confRes.json()) as any;
    expect(Array.isArray(data.conflicts)).toBe(true);
    expect(data.hasMore).toBe(false);

    const row = data.conflicts.find(
      (c: any) => c.entityId === entityId && c.field === "title"
    );
    expect(row).toBeDefined();
    expect(row.entity).toBe("tasks");
    expect(row.losingValue).toBe(JSON.stringify("Stale Title"));
    expect(row.winningValue).toBe(JSON.stringify("Newer Title"));
    expect(row.taskTitle).toBe("Newer Title");
    expect(typeof row.at).toBe("number");

    // Stored value must still be the winner.
    const taskRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${entityId}`, {
        headers: authHeaders,
      })
    );
    expect(taskRes.status).toBe(200);
    expect(((await taskRes.json()) as any).title).toBe("Newer Title");
  });

  it("simple-entity path: stale template edit is recorded", async () => {
    const { authHeaders } = await createAuthUser("SyncConfTmpl");
    const now = Date.now();
    const entityId = `tmpl-confhist-${now}-${Math.random().toString(36).slice(2)}`;

    const createRes = await push(authHeaders, [
      {
        id: `m-tmpl-create-${now}`,
        entity: "templates",
        op: "create",
        entityId,
        patch: { name: "Original Name", payload: { title: "Root" } },
        editedAt: now,
      },
    ]);
    expect(createRes.status).toBe(200);
    expect(((await createRes.json()) as any).results[0].status).toBe("applied");

    const winRes = await push(authHeaders, [
      {
        id: `m-tmpl-win-${now}`,
        entity: "templates",
        op: "update",
        entityId,
        patch: { name: "Newer Name" },
        editedAt: now + 20_000,
      },
    ]);
    expect(winRes.status).toBe(200);

    const loseRes = await push(authHeaders, [
      {
        id: `m-tmpl-lose-${now}`,
        entity: "templates",
        op: "update",
        entityId,
        patch: { name: "Stale Name" },
        editedAt: now + 10_000,
      },
    ]);
    expect(loseRes.status).toBe(200);

    const confRes = await getConflicts(authHeaders);
    expect(confRes.status).toBe(200);
    const data = (await confRes.json()) as any;
    const row = data.conflicts.find(
      (c: any) => c.entityId === entityId && c.field === "name"
    );
    expect(row).toBeDefined();
    expect(row.entity).toBe("templates");
    expect(row.losingValue).toBe(JSON.stringify("Stale Name"));
    expect(row.winningValue).toBe(JSON.stringify("Newer Name"));
    expect(row.taskTitle).toBeNull();
  });

  it("isolation: user B sees none of user A's conflicts", async () => {
    const userA = await createAuthUser("SyncConfIsoA");
    const userB = await createAuthUser("SyncConfIsoB");
    const inboxA = await getUserInboxId(userA.authHeaders);
    const now = Date.now();

    const entityId = `task-confiso-${now}-${Math.random().toString(36).slice(2)}`;
    await push(userA.authHeaders, [
      {
        id: `m-iso-create-${now}`,
        entity: "tasks",
        op: "create",
        entityId,
        patch: { title: "Iso Original", listId: inboxA },
        editedAt: now,
      },
    ]);
    await push(userA.authHeaders, [
      {
        id: `m-iso-win-${now}`,
        entity: "tasks",
        op: "update",
        entityId,
        patch: { title: "Iso Winner" },
        editedAt: now + 20_000,
      },
    ]);
    await push(userA.authHeaders, [
      {
        id: `m-iso-lose-${now}`,
        entity: "tasks",
        op: "update",
        entityId,
        patch: { title: "Iso Stale" },
        editedAt: now + 10_000,
      },
    ]);

    const aRes = await getConflicts(userA.authHeaders);
    expect(aRes.status).toBe(200);
    expect(
      ((await aRes.json()) as any).conflicts.some(
        (c: any) => c.entityId === entityId
      )
    ).toBe(true);

    const bRes = await getConflicts(userB.authHeaders);
    expect(bRes.status).toBe(200);
    expect(((await bRes.json()) as any).conflicts).toEqual([]);
  });

  it("pagination: limit and cursor page through conflicts", async () => {
    const { authHeaders } = await createAuthUser("SyncConfPage");
    const inboxId = await getUserInboxId(authHeaders);
    const now = Date.now();

    const entityId = `task-confpage-${now}-${Math.random().toString(36).slice(2)}`;
    await push(authHeaders, [
      {
        id: `m-page-create-${now}`,
        entity: "tasks",
        op: "create",
        entityId,
        patch: { title: "Page Original", listId: inboxId },
        editedAt: now,
      },
    ]);
    await push(authHeaders, [
      {
        id: `m-page-win-${now}`,
        entity: "tasks",
        op: "update",
        entityId,
        patch: { title: "Page Winner" },
        editedAt: now + 20_000,
      },
    ]);
    // Two losing edits on the same field.
    await push(authHeaders, [
      {
        id: `m-page-lose1-${now}`,
        entity: "tasks",
        op: "update",
        entityId,
        patch: { title: "Page Stale 1" },
        editedAt: now + 10_000,
      },
      {
        id: `m-page-lose2-${now}`,
        entity: "tasks",
        op: "update",
        entityId,
        patch: { title: "Page Stale 2" },
        editedAt: now + 15_000,
      },
    ]);

    const first = await getConflicts(authHeaders, "?limit=1");
    expect(first.status).toBe(200);
    const firstData = (await first.json()) as any;
    expect(firstData.conflicts).toHaveLength(1);
    expect(firstData.hasMore).toBe(true);
    expect(typeof firstData.nextCursor).toBe("string");

    const second = await getConflicts(
      authHeaders,
      `?limit=1&cursor=${encodeURIComponent(firstData.nextCursor)}`
    );
    expect(second.status).toBe(200);
    const secondData = (await second.json()) as any;
    expect(secondData.conflicts).toHaveLength(1);
    expect(secondData.conflicts[0].id).not.toBe(firstData.conflicts[0].id);
  });
});
