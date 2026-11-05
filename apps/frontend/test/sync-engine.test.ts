// Sync engine unit tests (Phase 5 Day 6a).
//
// Covers: mutate.ts outbox coalescing, sync2/apply.ts rebase, sync2/clock.ts
// offset learning + editedAt clamping, engine.ts backoffDelayMs bounds.
//
// Isolation: fake-indexeddb injected into Dexie.dependencies (bun:test does
// not provide IndexedDB; the /auto global shim is unreliable here). Every
// test uses a fresh per-test userId (isolated per-user Dexie DBs) deleted
// in afterEach.
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

// Dexie captures the IndexedDB implementation via its dependencies table;
// the /auto global shim is not reliably picked up under bun:test.
Dexie.dependencies.indexedDB = indexedDB as unknown as IDBFactory;
Dexie.dependencies.IDBKeyRange = IDBKeyRange as unknown as typeof IDBKeyRange;

import { describe, it, expect, afterEach } from "bun:test";
import { getDB } from "../src/lib/db/schema";
import { mutate, type LocalOutboxEntry } from "../src/lib/data/mutate";
import { applyPage } from "../src/lib/sync2/apply";
import {
  getOffset,
  setOffset,
  learnOffset,
} from "../src/lib/sync2/clock";
import { backoffDelayMs } from "../src/lib/sync2/engine";
import { subscribeRemoteChanged } from "../src/components/sync/remote-events";

let n = 0;
const uids: string[] = [];
function freshUid(): string {
  const u = `sync-engine-${Date.now()}-${n++}`;
  uids.push(u);
  return u;
}

afterEach(async () => {
  for (const u of uids.splice(0)) {
    try {
      await getDB(u).delete();
    } catch {
      // Best-effort cleanup; a missing DB is fine.
    }
  }
});

async function outboxOf(uid: string): Promise<LocalOutboxEntry[]> {
  return (await getDB(uid).outbox.toArray()) as LocalOutboxEntry[];
}

async function seedTask(
  uid: string,
  id: string,
  patch: Record<string, unknown> = {}
): Promise<void> {
  await getDB(uid).tasks.put({
    id,
    listId: "l1",
    parentId: null,
    sectionId: null,
    title: `Seed ${id}`,
    status: "todo",
    priority: 0,
    position: "a0",
    allDay: false,
    deleted: 0,
    deletedAt: null,
    updatedAt: 1,
    createdAt: 1,
    ...patch,
  });
}

describe("mutate coalescing", () => {
  it("create+update merges into a single create entry", async () => {
    const uid = freshUid();
    await mutate(uid, {
      entity: "tasks",
      op: "create",
      entityId: "t1",
      patch: { title: "A", listId: "l1" },
    });
    await mutate(uid, {
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { title: "B" },
    });
    const entries = await outboxOf(uid);
    expect(entries.length).toBe(1);
    expect(entries[0].srcOp).toBe("create");
    expect(entries[0].op).toBe("upsert");
    expect(entries[0].patch).toMatchObject({ title: "B", listId: "l1" });
    const row = await getDB(uid).tasks.get("t1");
    expect(row?.["title"]).toBe("B");
  });

  it("create+delete cancels the outbox and removes the row", async () => {
    const uid = freshUid();
    await mutate(uid, {
      entity: "tasks",
      op: "create",
      entityId: "t1",
      patch: { title: "A", listId: "l1" },
    });
    await mutate(uid, { entity: "tasks", op: "delete", entityId: "t1" });
    expect(await outboxOf(uid)).toEqual([]);
    expect(await getDB(uid).tasks.get("t1")).toBeUndefined();
  });

  it("update+update merges newest value per field", async () => {
    const uid = freshUid();
    await seedTask(uid, "t1");
    await mutate(uid, {
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { title: "B", priority: 1 },
    });
    await mutate(uid, {
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { title: "C" },
    });
    const entries = await outboxOf(uid);
    expect(entries.length).toBe(1);
    expect(entries[0].srcOp).toBeUndefined();
    expect(entries[0].patch).toMatchObject({ title: "C", priority: 1 });
  });

  it("complete after update enqueues a separate domain entry", async () => {
    const uid = freshUid();
    await seedTask(uid, "t1");
    await mutate(uid, {
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { priority: 2 },
    });
    await mutate(uid, { entity: "tasks", op: "complete", entityId: "t1" });
    const entries = await outboxOf(uid);
    expect(entries.length).toBe(2);
    expect(entries[1].srcOp).toBe("complete");
    const row = await getDB(uid).tasks.get("t1");
    expect(row?.["status"]).toBe("done");
  });

  it("update after complete does not merge into the domain entry", async () => {
    const uid = freshUid();
    await seedTask(uid, "t1");
    await mutate(uid, { entity: "tasks", op: "complete", entityId: "t1" });
    await mutate(uid, {
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { title: "Edited" },
    });
    const entries = await outboxOf(uid);
    expect(entries.length).toBe(2);
    expect(entries[0].srcOp).toBe("complete");
    expect(entries[1].srcOp).toBeUndefined();
    expect(entries[1].patch).toMatchObject({ title: "Edited" });
  });

  it("update then delete keeps both entries and tombstones the row", async () => {
    const uid = freshUid();
    await seedTask(uid, "t1");
    await mutate(uid, {
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { title: "B" },
    });
    await mutate(uid, { entity: "tasks", op: "delete", entityId: "t1" });
    const entries = await outboxOf(uid);
    expect(entries.length).toBe(2);
    expect(entries[1].op).toBe("delete");
    const row = await getDB(uid).tasks.get("t1");
    expect(row?.["deleted"]).toBe(1);
  });
});

describe("applyPage rebase", () => {
  it("pending patch wins, other fields come from the server row", async () => {
    const uid = freshUid();
    const pending = new Map<string, Record<string, unknown>>([
      ["tasks:t1", { title: "Local" }],
    ]);
    const applied = await applyPage(
      uid,
      {
        tasks: [
          { id: "t1", title: "Server", notes: "keep", updatedAt: 5 },
        ],
      },
      pending
    );
    expect(applied).toBe(1);
    const row = await getDB(uid).tasks.get("t1");
    expect(row?.["title"]).toBe("Local");
    expect(row?.["notes"]).toBe("keep");
  });

  it("server tombstones are kept locally with deleted=1", async () => {
    const uid = freshUid();
    await applyPage(
      uid,
      { tasks: [{ id: "t9", title: "Gone", deletedAt: 123, updatedAt: 6 }] },
      new Map()
    );
    const row = await getDB(uid).tasks.get("t9");
    expect(row).toBeDefined();
    expect(row?.["deleted"]).toBe(1);
  });

  it("control keys in pending patches never leak onto rows", async () => {
    const uid = freshUid();
    const pending = new Map<string, Record<string, unknown>>([
      [
        "tasks:t1",
        { title: "Local", afterId: "x", beforeId: "y", completeSubtasks: true },
      ],
    ]);
    await applyPage(
      uid,
      { tasks: [{ id: "t1", title: "Server", updatedAt: 5 }] },
      pending
    );
    const row = await getDB(uid).tasks.get("t1");
    expect(row?.["title"]).toBe("Local");
    expect(row?.["afterId"]).toBeUndefined();
    expect(row?.["beforeId"]).toBeUndefined();
    expect(row?.["completeSubtasks"]).toBeUndefined();
  });

  it("notifies for new and changed rows, skipping pending echoes", async () => {
    const uid = freshUid();
    await seedTask(uid, "t-old", { title: "Old" });
    const seen: Array<{ entity: string; id: string }> = [];
    const unsub = subscribeRemoteChanged((d) =>
      seen.push({ entity: d.entity, id: d.id })
    );
    try {
      await applyPage(
        uid,
        {
          tasks: [
            { id: "t-old", title: "New", updatedAt: 9 },
            { id: "t-brand-new", title: "First sighting", updatedAt: 9 },
          ],
        },
        new Map([["tasks:t-pending", { title: "Mine" }]])
      );
      // Seed the pending id locally so a second apply can prove the skip.
      await seedTask(uid, "t-pending", { title: "Mine" });
      await applyPage(
        uid,
        { tasks: [{ id: "t-pending", title: "Server", updatedAt: 9 }] },
        new Map([["tasks:t-pending", { title: "Mine" }]])
      );
    } finally {
      unsub();
    }
    expect(seen).toEqual([
      { entity: "tasks", id: "t-old" },
      { entity: "tasks", id: "t-brand-new" },
    ]);
  });
});

describe("sync clock", () => {
  it("learnOffset stores serverTime - now", async () => {
    const uid = freshUid();
    const t0 = Date.now();
    const offset = await learnOffset(uid, t0 + 5000);
    expect(offset).toBeGreaterThanOrEqual(4990);
    expect(offset).toBeLessThanOrEqual(5100);
    const stored = await getOffset(uid);
    expect(stored).toBe(offset);
  });

  it("mutate clamps editedAt to +5min when the offset is large", async () => {
    const uid = freshUid();
    await setOffset(uid, 10 * 60 * 1000);
    const t0 = Date.now();
    await mutate(uid, {
      entity: "tasks",
      op: "create",
      entityId: "t1",
      patch: { title: "A", listId: "l1" },
    });
    const entries = await outboxOf(uid);
    expect(entries.length).toBe(1);
    expect(entries[0].editedAt - t0).toBeLessThanOrEqual(5 * 60 * 1000 + 5000);
  });

  it("mutate applies a small learned offset to editedAt", async () => {
    const uid = freshUid();
    await setOffset(uid, 60_000);
    const t0 = Date.now();
    await mutate(uid, {
      entity: "tasks",
      op: "create",
      entityId: "t1",
      patch: { title: "A", listId: "l1" },
    });
    const entries = await outboxOf(uid);
    const skew = entries[0].editedAt - t0;
    expect(skew).toBeGreaterThanOrEqual(55_000);
    expect(skew).toBeLessThanOrEqual(65_000);
  });
});

describe("backoffDelayMs", () => {
  it("stays within [base, base+jitter] per failure count", async () => {
    const d1 = backoffDelayMs(1);
    expect(d1).toBeGreaterThanOrEqual(2000);
    expect(d1).toBeLessThan(3000);
    const d3 = backoffDelayMs(3);
    expect(d3).toBeGreaterThanOrEqual(8000);
    expect(d3).toBeLessThan(9000);
  });

  it("caps at 60s plus jitter", async () => {
    const d = backoffDelayMs(100);
    expect(d).toBeGreaterThanOrEqual(60000);
    expect(d).toBeLessThan(61000);
  });
});
