// Sync engine, push + pull phases (Phase 5 Day 2a).
//
// pushPhase: oldest-first outbox drain in batches of 100. srcOp is stripped
// per the Day-1b note: create -> create, plain upsert -> update, domain ops
// (complete/move/restore/setTags) -> their op with the stored patch.
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
  RetryableError,
  SyncResyncRequired,
  type PushMutation,
} from "./transport";
import { applyPage } from "./apply";
import { learnOffset } from "./clock";
import { setStatus } from "./status";
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
    case "setTags":
      return "setTags";
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

export interface FlushOutboxResult {
  flushed: number;
  remaining: number;
}

// Sign-out flush path: push the per-user outbox until empty (max 5
// pushPhase rounds), then report counts so the caller can decide whether
// to proceed with sign-out. Never throws: transport/DB failures just stop
// the loop and surface as `remaining`.
export async function flushOutbox(
  userId: string
): Promise<FlushOutboxResult> {
  const db = getDB(userId);
  const deviceRow = await db.meta.get("deviceId").catch(() => undefined);
  const deviceId =
    typeof deviceRow?.value === "string" && deviceRow.value.length > 0
      ? deviceRow.value
      : "";
  let flushed = 0;

  for (let i = 0; i < 5; i++) {
    const pending = await getPending(userId).catch(() => []);
    if (pending.length === 0 || !deviceId) break;
    try {
      const res = await pushPhase(userId, deviceId);
      flushed += res.acked;
      const rest = await getPending(userId).catch(() => []);
      // No drain progress (remaining entries are retry-gated): stop pushing.
      if (rest.length >= pending.length) break;
    } catch {
      break;
    }
  }

  const remaining = await getPending(userId)
    .then((rows) => rows.length)
    .catch(() => 0);
  return { flushed, remaining };
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

// ---- runSync orchestrator (Day 2b) ----
//
// One full cycle: idle -> pushing -> pulling -> idle, with the status
// store updated after each phase (pendingCount) and on completion
// (lastSyncAt). Concurrent calls join the in-flight run. No timers here:
// backoff returns retryDelayMs and the caller (triggers.ts) schedules.

export type RunSyncStatus = "ok" | "offline" | "backoff";

export interface RunSyncOptions {
  // Bypass the concurrent-run guard and start a fresh run.
  force?: boolean;
}

export interface RunSyncResult {
  status: RunSyncStatus;
  // Present when status is "backoff": caller schedules the retry.
  retryDelayMs?: number;
  // Cursor after a successful pull.
  cursor?: string;
}

const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 60000;
const BACKOFF_JITTER_MS = 1000;

let inFlight: Promise<RunSyncResult> | null = null;
let consecutiveFailures = 0;

export function backoffDelayMs(failures: number): number {
  const exp = BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1);
  return Math.min(BACKOFF_MAX_MS, exp) + Math.random() * BACKOFF_JITTER_MS;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readCursor(userId: string): Promise<string> {
  const row = await getDB(userId).meta.get("cursor");
  return typeof row?.value === "string" ? row.value : "";
}

async function refreshPendingCount(userId: string): Promise<void> {
  const pending = await getPending(userId);
  setStatus({ pendingCount: pending.length });
}

async function failTransient(
  userId: string,
  err: unknown
): Promise<RunSyncResult> {
  consecutiveFailures += 1;
  const computed = backoffDelayMs(consecutiveFailures);
  const serverDelay =
    err instanceof RetryableError && err.delayMs > 0 ? err.delayMs : 0;
  const retryDelayMs = Math.max(computed, serverDelay);
  setStatus({ state: "backoff", error: errorMessage(err) });
  await refreshPendingCount(userId).catch(() => {});
  return { status: "backoff", retryDelayMs };
}

function succeed(cursor: string): RunSyncResult {
  consecutiveFailures = 0;
  setStatus({ state: "idle", lastSyncAt: Date.now(), error: null });
  return { status: "ok", cursor };
}

// Full resync: push the outbox first so unsent local edits survive, wipe
// entity tables (never the outbox), then pull from "". A second resync
// demand inside is treated as transient and retried later.
async function doResync(
  userId: string,
  deviceId: string
): Promise<RunSyncResult> {
  setStatus({ state: "resyncing", error: null });
  try {
    await pushPhase(userId, deviceId);
    await refreshPendingCount(userId);
    const db = getDB(userId);
    await clearEntityTables(db);
    await db.meta.put({ key: "cursor", value: "" });
    setStatus({ state: "pulling" });
    const next = await pullPhase(userId, deviceId, "");
    await refreshPendingCount(userId);
    return succeed(next);
  } catch (err) {
    // 426 SyncUpdateRequired flows into backoff: keep syncing, retry later.
    return failTransient(userId, err);
  }
}

async function doRunSync(
  userId: string,
  deviceId: string
): Promise<RunSyncResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setStatus({ state: "offline", error: null });
    return { status: "offline" };
  }
  try {
    setStatus({ state: "pushing", error: null });
    await pushPhase(userId, deviceId);
    await refreshPendingCount(userId);
    setStatus({ state: "pulling" });
    const next = await pullPhase(userId, deviceId, await readCursor(userId));
    await refreshPendingCount(userId);
    return succeed(next);
  } catch (err) {
    // 426 SyncUpdateRequired flows into backoff: keep syncing, retry later.
    if (err instanceof SyncResyncRequired) return doResync(userId, deviceId);
    return failTransient(userId, err);
  }
}

export function runSync(
  userId: string,
  deviceId: string,
  opts?: RunSyncOptions
): Promise<RunSyncResult> {
  if (inFlight && !opts?.force) return inFlight;
  const p = doRunSync(userId, deviceId);
  inFlight = p;
  // doRunSync never rejects (all errors map to results), so this finally
  // handler never produces an unhandled rejection.
  void p.then(() => {
    if (inFlight === p) inFlight = null;
  });
  return p;
}
