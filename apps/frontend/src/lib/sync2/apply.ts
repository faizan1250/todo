// Pull apply layer (Phase 5 Day 2a).
//
// applyPage() writes one pull page into the per-user Dexie DB in a single
// read-write transaction spanning every touched table:
//   row = { ...serverRow, deleted: deletedAt ? 1 : 0, ...pendingFields }
// pendingFields (merged unsent outbox patches for that entityId) win over
// the server row: the server never overwrites unsent local edits (rebase).
// Rows with deleted=1 are kept locally (Trash), never dropped.

import { getDB, type SyncRow } from "../db/schema";

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
  await db.transaction("rw", tables, async () => {
    for (const [entity, rows] of entities) {
      const table = db.table(entity);
      const merged = rows.map((row) =>
        rebase(normalizeRow(row), pending, entity)
      );
      await table.bulkPut(merged);
      applied += merged.length;
    }
  });
  return applied;
}
