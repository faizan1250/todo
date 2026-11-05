import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";

describe("Sync push: containers (folders/lists/sections/checklistItems/tags)", () => {
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
    expect(res.status).toBe(200);
    return (await res.json()) as any;
  }

  async function getOne(authHeaders: Record<string, string>, path: string) {
    const res = await app.handle(
      new Request(`http://localhost:3001${path}`, { headers: authHeaders })
    );
    return res;
  }

  it("lists: push create/update/delete round-trips through REST", async () => {
    const { authHeaders } = await createAuthUser("SyncListPush");
    const now = Date.now();
    const listId = `list-push-${now}`;

    const created = await push(authHeaders, [
      {
        id: `m-lp-create-${now}`,
        entity: "lists",
        op: "create",
        entityId: listId,
        patch: { name: "Pushed List", viewType: "board" },
        editedAt: now,
      },
    ]);
    expect(created.results[0].status).toBe("applied");

    const getRes = await getOne(authHeaders, `/api/v1/lists/${listId}`);
    expect(getRes.status).toBe(200);
    expect(((await getRes.json()) as any).name).toBe("Pushed List");

    const updated = await push(authHeaders, [
      {
        id: `m-lp-update-${now}`,
        entity: "lists",
        op: "update",
        entityId: listId,
        patch: { name: "Renamed List" },
        editedAt: now + 1000,
      },
    ]);
    expect(updated.results[0].status).toBe("applied");

    const getRes2 = await getOne(authHeaders, `/api/v1/lists/${listId}`);
    expect(((await getRes2.json()) as any).name).toBe("Renamed List");

    const deleted = await push(authHeaders, [
      { id: `m-lp-del-${now}`, entity: "lists", op: "delete", entityId: listId, editedAt: now + 2000 },
    ]);
    expect(deleted.results[0].status).toBe("applied");

    const getRes3 = await getOne(authHeaders, `/api/v1/lists/${listId}`);
    expect(getRes3.status).toBe(404);

    // Restore brings it back.
    const restored = await push(authHeaders, [
      { id: `m-lp-restore-${now}`, entity: "lists", op: "restore", entityId: listId, editedAt: now + 3000 },
    ]);
    expect(restored.results[0].status).toBe("applied");
    const getRes4 = await getOne(authHeaders, `/api/v1/lists/${listId}`);
    expect(getRes4.status).toBe(200);
  });

  it("lists: inbox cannot be deleted via push; unknown folder rejected", async () => {
    const { authHeaders } = await createAuthUser("SyncListGuard");
    const inboxId = await getUserInboxId(authHeaders);
    const now = Date.now();

    const delInbox = await push(authHeaders, [
      { id: `m-lg-inbox-${now}`, entity: "lists", op: "delete", entityId: inboxId, editedAt: now },
    ]);
    expect(delInbox.results[0].status).toBe("rejected");
    expect(delInbox.results[0].reason).toBe("inbox_protected");

    const badFolder = await push(authHeaders, [
      {
        id: `m-lg-folder-${now}`,
        entity: "lists",
        op: "create",
        entityId: `list-lg-${now}`,
        patch: { name: "Bad Folder List", folderId: "folder-does-not-exist" },
        editedAt: now,
      },
    ]);
    expect(badFolder.results[0].status).toBe("rejected");
  });

  it("lists: stale field edit is recorded as a conflict (LWW)", async () => {
    const { authHeaders } = await createAuthUser("SyncListConf");
    const now = Date.now();
    const listId = `list-conf-${now}`;

    await push(authHeaders, [
      {
        id: `m-lc-create-${now}`,
        entity: "lists",
        op: "create",
        entityId: listId,
        patch: { name: "Original" },
        editedAt: now,
      },
    ]);
    await push(
      authHeaders,
      [
        {
          id: `m-lc-win-${now}`,
          entity: "lists",
          op: "update",
          entityId: listId,
          patch: { name: "Winner" },
          editedAt: now + 20_000,
        },
      ],
      "device-a"
    );
    const lose = await push(
      authHeaders,
      [
        {
          id: `m-lc-lose-${now}`,
          entity: "lists",
          op: "update",
          entityId: listId,
          patch: { name: "Stale" },
          editedAt: now + 10_000,
        },
      ],
      "device-b"
    );
    expect(lose.results[0].status).toBe("applied");

    const confRes = await getOne(authHeaders, "/api/v1/sync/conflicts");
    expect(confRes.status).toBe(200);
    const data = (await confRes.json()) as any;
    const row = data.conflicts.find((c: any) => c.entityId === listId && c.field === "name");
    expect(row).toBeDefined();
    expect(row.entity).toBe("lists");
    expect(row.losingValue).toBe(JSON.stringify("Stale"));
    expect(row.winningValue).toBe(JSON.stringify("Winner"));

    const getRes = await getOne(authHeaders, `/api/v1/lists/${listId}`);
    expect(((await getRes.json()) as any).name).toBe("Winner");
  });

  it("tags: push create/update/delete with case-insensitive uniqueness", async () => {
    const { authHeaders } = await createAuthUser("SyncTagPush");
    const now = Date.now();
    const tagId = `tag-push-${now}`;

    const created = await push(authHeaders, [
      {
        id: `m-tp-create-${now}`,
        entity: "tags",
        op: "create",
        entityId: tagId,
        patch: { name: "Urgent", color: "red" },
        editedAt: now,
      },
    ]);
    expect(created.results[0].status).toBe("applied");

    // Case-insensitive duplicate rejected.
    const dup = await push(authHeaders, [
      {
        id: `m-tp-dup-${now}`,
        entity: "tags",
        op: "create",
        entityId: `tag-dup-${now}`,
        patch: { name: "urgent" },
        editedAt: now + 1000,
      },
    ]);
    expect(dup.results[0].status).toBe("rejected");
    expect(dup.results[0].reason).toBe("tag_taken");

    const updated = await push(authHeaders, [
      {
        id: `m-tp-update-${now}`,
        entity: "tags",
        op: "update",
        entityId: tagId,
        patch: { name: "Critical" },
        editedAt: now + 2000,
      },
    ]);
    expect(updated.results[0].status).toBe("applied");

    const deleted = await push(authHeaders, [
      { id: `m-tp-del-${now}`, entity: "tags", op: "delete", entityId: tagId, editedAt: now + 3000 },
    ]);
    expect(deleted.results[0].status).toBe("applied");

    const listRes = await getOne(authHeaders, "/api/v1/tags");
    expect(listRes.status).toBe(200);
    expect(((await listRes.json()) as any).some((t: any) => t.id === tagId)).toBe(false);
  });

  it("checklist: push create/update/delete requires owned task", async () => {
    const { authHeaders } = await createAuthUser("SyncChkPush");
    const inboxId = await getUserInboxId(authHeaders);
    const now = Date.now();
    const taskId = `task-chk-${now}`;
    const itemId = `chk-push-${now}`;

    await push(authHeaders, [
      {
        id: `m-cp-task-${now}`,
        entity: "tasks",
        op: "create",
        entityId: taskId,
        patch: { title: "Checklist Parent", listId: inboxId },
        editedAt: now,
      },
    ]);

    const created = await push(authHeaders, [
      {
        id: `m-cp-create-${now}`,
        entity: "checklistItems",
        op: "create",
        entityId: itemId,
        patch: { taskId, text: "First item" },
        editedAt: now,
      },
    ]);
    expect(created.results[0].status).toBe("applied");

    // Missing task rejected.
    const badTask = await push(authHeaders, [
      {
        id: `m-cp-bad-${now}`,
        entity: "checklistItems",
        op: "create",
        entityId: `chk-bad-${now}`,
        patch: { taskId: "task-does-not-exist", text: "Nope" },
        editedAt: now,
      },
    ]);
    expect(badTask.results[0].status).toBe("rejected");

    const updated = await push(authHeaders, [
      {
        id: `m-cp-update-${now}`,
        entity: "checklistItems",
        op: "update",
        entityId: itemId,
        patch: { text: "Updated item", done: true },
        editedAt: now + 1000,
      },
    ]);
    expect(updated.results[0].status).toBe("applied");

    const getRes = await getOne(authHeaders, `/api/v1/tasks/${taskId}/checklist`);
    expect(getRes.status).toBe(200);
    const items = (await getRes.json()) as any[];
    expect(items.some((i) => i.id === itemId && i.done === true)).toBe(true);

    const deleted = await push(authHeaders, [
      { id: `m-cp-del-${now}`, entity: "checklistItems", op: "delete", entityId: itemId, editedAt: now + 2000 },
    ]);
    expect(deleted.results[0].status).toBe("applied");
  });

  it("folders + sections: push create/delete mirrors REST cascades", async () => {
    const { authHeaders } = await createAuthUser("SyncFoldSec");
    const now = Date.now();
    const folderId = `folder-push-${now}`;
    const listId = `list-fs-${now}`;
    const sectionId = `sec-push-${now}`;

    await push(authHeaders, [
      {
        id: `m-fs-folder-${now}`,
        entity: "folders",
        op: "create",
        entityId: folderId,
        patch: { name: "Pushed Folder" },
        editedAt: now,
      },
    ]);
    await push(authHeaders, [
      {
        id: `m-fs-list-${now}`,
        entity: "lists",
        op: "create",
        entityId: listId,
        patch: { name: "Folder Child", folderId },
        editedAt: now + 1000,
      },
    ]);
    const secCreated = await push(authHeaders, [
      {
        id: `m-fs-sec-${now}`,
        entity: "sections",
        op: "create",
        entityId: sectionId,
        patch: { listId, name: "Pushed Section" },
        editedAt: now + 2000,
      },
    ]);
    expect(secCreated.results[0].status).toBe("applied");

    // Deleting the folder moves the child list to root (mirror REST).
    const delFolder = await push(authHeaders, [
      { id: `m-fs-delf-${now}`, entity: "folders", op: "delete", entityId: folderId, editedAt: now + 3000 },
    ]);
    expect(delFolder.results[0].status).toBe("applied");
    const listRes = await getOne(authHeaders, `/api/v1/lists/${listId}`);
    expect(listRes.status).toBe(200);
    expect(((await listRes.json()) as any).folderId).toBeNull();

    // Deleting the section is allowed; restoring works while the list is active.
    const delSec = await push(authHeaders, [
      { id: `m-fs-dels-${now}`, entity: "sections", op: "delete", entityId: sectionId, editedAt: now + 4000 },
    ]);
    expect(delSec.results[0].status).toBe("applied");
    const restoreSec = await push(authHeaders, [
      { id: `m-fs-restore-${now}`, entity: "sections", op: "restore", entityId: sectionId, editedAt: now + 5000 },
    ]);
    expect(restoreSec.results[0].status).toBe("applied");
  });

  it("isolation: user B cannot update or delete user A's containers", async () => {
    const userA = await createAuthUser("SyncContIsoA");
    const userB = await createAuthUser("SyncContIsoB");
    const now = Date.now();
    const listId = `list-iso-${now}`;
    const tagId = `tag-iso-${now}`;

    await push(userA.authHeaders, [
      {
        id: `m-ci-list-${now}`,
        entity: "lists",
        op: "create",
        entityId: listId,
        patch: { name: "A Private List" },
        editedAt: now,
      },
    ]);
    await push(userA.authHeaders, [
      {
        id: `m-ci-tag-${now}`,
        entity: "tags",
        op: "create",
        entityId: tagId,
        patch: { name: "APrivateTag" },
        editedAt: now,
      },
    ]);

    const bUpdate = await push(userB.authHeaders, [
      {
        id: `m-ci-bupd-${now}`,
        entity: "lists",
        op: "update",
        entityId: listId,
        patch: { name: "Hijacked" },
        editedAt: now + 1000,
      },
    ]);
    expect(bUpdate.results[0].status).toBe("rejected");

    const bDelete = await push(userB.authHeaders, [
      { id: `m-ci-bdel-${now}`, entity: "tags", op: "delete", entityId: tagId, editedAt: now + 1000 },
    ]);
    expect(bDelete.results[0].status).toBe("rejected");

    // A's data untouched.
    const getRes = await getOne(userA.authHeaders, `/api/v1/lists/${listId}`);
    expect(((await getRes.json()) as any).name).toBe("A Private List");
  });
});
