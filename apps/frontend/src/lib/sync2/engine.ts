// Sync engine, push + pull phases (Phase 5 Day 2a).
//
// pushPhase: oldest-first outbox drain in batches of 100. srcOp is stripped
// per the Day-1b note: create -> create, plain upsert -> update, domain ops
// (complete/move/restore) -> their op with the stored patch.
//   applied|duplicate -> entry removed.
//   rejected          -> entry removed AND local row deleted so the next pull
//                        restores server truth; ConflictToast event fires.
//   ignored|unknown   -> attempts++, stays queued.
// pullPhase: page loop (max 20) until !hasMore. Applies each page with a
// rebase over pending patches, saves the cursor per page, learns the clock
// offset per page. A 409 resync clears entity tables once and restarts from
// "" (a second 409 propagates).

import { getDB, type TodoDB } from "../db/schema";
import {
  pullPage,
  pushBatch,
  SyncResyncRequired,
  type PushMutation,
} from "./transport";
import { applyPage } from "./apply";
import { learnOffset } from "./clock";
import {
  getPending,
  pendingPatchesByEntity,
  type LocalOutboxEntry,
} from "./outbox";

export const CONFLICT_EVENT = "todo:sync-conflict";

export interface ConflictDetail {
  entity: string;
  entityId: string;
  reason: string;
}

const PUSH_BATCH = 100;
const PULL_LIMIT = 500;
const MAX_PULL_PAGES = 20;

const ENTITY_TABLES = [
  "tasks",
  "lists",
  "folders",
  "sections",
  "checklistItems",
  "tags",
  "templates",
  "reminders",
  "recurrences",
  "places",
  "timeBlocks",
  "savedFilters",
] as const;

function toPushOp(entry: LocalOutboxEntry): string {
  if (entry.op === "delete") return "delete";
  switch (entry.srcOp) {
    case "create":
      return "create";
    case "complete":
      return "complete";
    case "move":
      return "move";
    case "restore":
      return "restore";
    default:
      return "update";
  }
}

function fireConflict(detail: ConflictDetail): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<ConflictDetail>(CONFLICT_EVENT, { detail }));
  }
}

async function clearEntityTables(db: TodoDB): Promise<void> {
  await Promise.all(ENTITY_TABLES.map((t) => db.table(t).clear()));
}

export interface PushPhaseResult {
  acked: number;
  retried: number;
}

export async function pushPhase(
  userId: string,
  deviceId: string
): Promise<PushPhaseResult> {
  const db = getDB(userId);
  let acked = 0;
  let retried = 0;

  for (;;) {
    const pending = (await getPending(userId)).slice(0, PUSH_BATCH);
    if (pending.length === 0) break;

    const mutations: PushMutation[] = pending.map((e) => ({
      id: e.id,
      entity: e.entity,
      op: toPushOp(e),
      entityId: e.entityId,
      patch: e.patch,
      editedAt: e.editedAt,
      schemaVersion: e.schemaVersion,
    }));
    const results = await pushBatch(mutations, deviceId);
    const byId = new Map(results.map((r) => [r.id, r]));

    const dropIds: string[] = [];
    for (const entry of pending) {
      const r = byId.get(entry.id);
      if (!r || (r.status !== "applied" && r.status !== "duplicate" && r.status !== "rejected")) {
        await db.outbox.update(entry.id, { attempts: entry.attempts + 1 });
        retried += 1;
        continue;
      }
      dropIds.push(entry.id);
      if (r.status === "rejected") {
        try {
          await db.table(entry.entity).delete(entry.entityId);
        } catch {
          // Unknown entity: nothing local to drop.
        }
        fireConflict({
          entity: entry.entity,
          entityId: entry.entityId,
          reason: r.reason ?? "rejected",
        });
      } else {
        acked += 1;
      }
    }
    if (dropIds.length > 0) await db.outbox.bulkDelete(dropIds);
    if (pending.length < PUSH_BATCH) break;
  }

  return { acked, retried };
}

export async function pullPhase(
  userId: string,
  deviceId: string,
  cursor: string
): Promise<string> {
  const db = getDB(userId);
  let cur = cursor;
  let resynced = false;

  for (let page = 0; page < MAX_PULL_PAGES; page++) {
    let res;
    try {
      res = await pullPage(cur, deviceId, PULL_LIMIT);
    } catch (err) {
      if (err instanceof SyncResyncRequired && !resynced) {
        resynced = true;
        await clearEntityTables(db);
        cur = "";
        await db.meta.put({ key: "cursor", value: cur });
        continue;
      }
      throw err;
    }
    const pending = await pendingPatchesByEntity(userId);
    await applyPage(userId, res.changes, pending);
    cur = res.cursor;
    await db.meta.put({ key: "cursor", value: cur });
    await learnOffset(userId, res.serverTime);
    if (!res.hasMore) break;
  }

  return cur;
}
