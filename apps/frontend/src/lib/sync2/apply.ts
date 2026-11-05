// Pull apply layer (Phase 5 Day 2a; remote-notify wired at cutover 6a).
//
// applyPage() writes one pull page into the per-user Dexie DB in a single
// read-write transaction spanning every touched table:
//   row = { ...serverRow, deleted: deletedAt ? 1 : 0, ...pendingFields }
// pendingFields (merged unsent outbox patches for that entityId) win over
// the server row: the server never overwrites unsent local edits (rebase).
// Rows with deleted=1 are kept locally (Trash), never dropped.
//
// Remote-change fan-out: after the transaction commits, notifyRemoteChanged
// fires once per row that already existed locally and differs from the
// server version. New rows (first sync / first sighting) do not notify,
// and ids with unsent local edits (pending map) are skipped so our own
// echoes returning via pull never glow.

import { getDB, type SyncRow } from "../db/schema";
import { notifyRemoteChanged } from "@/components/sync/remote-events";

const KNOWN_TABLES = new Set([
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
]);

// Patch keys that steer server behavior but are not row fields. They live
// in pending outbox patches (move/complete) and must not leak onto rows.
const CONTROL_KEYS = new Set(["afterId", "beforeId", "completeSubtasks"]);

function normalizeRow(row: Record<string, unknown>): SyncRow {
  const out: SyncRow = { ...row };
  for (const [k, v] of Object.entries(out)) {
    if (v instanceof Date) out[k] = v.getTime();
  }
  out.deleted = out.deletedAt != null && out.deletedAt !== 0 ? 1 : 0;
  return out;
}

function rebase(
  row: SyncRow,
  pending: Map<string, Record<string, unknown>>,
  entity: string
): SyncRow {
  const id = row["id"];
  if (typeof id !== "string") return row;
  const patch = pending.get(`${entity}:${id}`);
  if (!patch) return row;
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (!CONTROL_KEYS.has(k)) fields[k] = v;
  }
  return { ...row, ...fields };
}

function comparable(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : value;
}

function rowsEqual(a: SyncRow, b: SyncRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (comparable(a[key]) !== comparable(b[key])) return false;
  }
  return true;
}

export async function applyPage(
  userId: string,
  changes: Record<string, Record<string, unknown>[]>,
  pending: Map<string, Record<string, unknown>>
): Promise<number> {
  const db = getDB(userId);
  const entities = Object.entries(changes).filter(
    ([entity, rows]) =>
      KNOWN_TABLES.has(entity) && Array.isArray(rows) && rows.length > 0
  );
  if (entities.length === 0) return 0;

  const tables = entities.map(([entity]) => db.table(entity));
  let applied = 0;
  // Collected inside the txn, fired after commit (listeners are sync and
  // must never run inside a Dexie transaction).
  const remoteChanged: Array<{ entity: string; id: string }> = [];
  await db.transaction("rw", tables, async () => {
    for (const [entity, rows] of entities) {
      const table = db.table(entity);
      const ids = rows
        .map((row) => row["id"])
        .filter((id): id is string => typeof id === "string");
      const existing = new Map<string, SyncRow>();
      if (ids.length > 0) {
        const current = await table.bulkGet(ids);
        current.forEach((row, i) => {
          if (row) existing.set(ids[i], row);
        });
      }
      const merged = rows.map((row) => {
        const rebased = rebase(normalizeRow(row), pending, entity);
        const id = rebased["id"];
        if (typeof id === "string" && !pending.has(`${entity}:${id}`)) {
          const before = existing.get(id);
          if (before && !rowsEqual(before, rebased)) {
            remoteChanged.push({ entity, id });
          }
        }
        return rebased;
      });
      await table.bulkPut(merged);
      applied += merged.length;
    }
  });
  for (const { entity, id } of remoteChanged) {
    // No device info on pull rows: generic "another device" label.
    notifyRemoteChanged(entity, id);
  }
  return applied;
}
