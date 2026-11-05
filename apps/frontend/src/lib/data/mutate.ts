// Local-first mutation engine (Phase 5 Day 1b).
//
// Single-Dexie-tx optimistic write on db[entity] + db[outbox]:
//   create/update -> local put (merged)              + outbox "upsert"
//   delete        -> local tombstone                 + outbox "delete"
//   complete      -> local status/completedAt        + outbox "upsert" (domain)
//   move          -> local parent/list/section/pos   + outbox "upsert" (domain)
//   restore       -> local tombstone clear           + outbox "upsert" (domain)
//
// Coalescing (preserves push order; merge only into the LATEST pending entry,
// and only when it is a plain upsert):
//   - consecutive updates to same (entity, entityId): newest value per field.
//   - create+update: single create entry (merge patch into it, keep marker).
//   - create+delete: nothing was ever synced -> drop outbox entries, delete
//     the local row entirely, enqueue nothing.
//   - domain ops (complete/move/restore) always enqueue separately, never
//     coalesced (the Day-3 push layer sends them as operations, not patches).
//
// Local row convention: camelCase keys, timestamps as UTC ms numbers,
// `deleted` 0|1 derived flag alongside `deletedAt`.
//
// Local validation (fail fast, plain Errors): title/name/text non-empty +
// max length, subtask depth <= 3, parent-cycle check on parent moves.

import { v7 as uuidv7 } from "uuid";
import type { Table } from "dexie";
import { generateKeyBetween } from "fractional-indexing";
import { getDB, type OutboxEntry, type SyncRow } from "../db/schema";

// Backend rejects mutations dated more than 5 minutes in the future.
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

// Schema version stamped on every outbox entry for the push layer.
export const SCHEMA = 1;

export const LOCAL_WRITE_EVENT = "todo:local-write";

export type MutateOp =
  | "create"
  | "update"
  | "delete"
  | "complete"
  | "move"
  | "restore";

type DomainOp = "create" | "complete" | "move" | "restore";

export interface MutateInput {
  entity: string;
  op: MutateOp;
  entityId: string;
  patch?: Record<string, unknown>;
}

// Extra runtime prop persisted on outbox rows next to OutboxEntry (Dexie
// stores it; lib/db stays untouched). Day-3 push uses it to pick the server
// op: entries without srcOp are plain field upserts (create iff the row was
// locally created), domain entries are sent as their op.
export interface LocalOutboxEntry extends OutboxEntry {
  srcOp?: DomainOp;
}

const DATA_TABLES = new Set([
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

const OPS = new Set<string>([
  "create",
  "update",
  "delete",
  "complete",
  "move",
  "restore",
]);

const TITLE_MAX: Record<string, number> = { tasks: 500, templates: 255 };
const NAME_TABLES = new Set([
  "lists",
  "folders",
  "sections",
  "tags",
  "places",
  "savedFilters",
]);
// Patch keys that steer server behavior but are not row fields.
const CONTROL_KEYS = new Set(["afterId", "beforeId", "completeSubtasks"]);

function singular(entity: string): string {
  if (entity === "tasks") return "Task";
  if (entity === "checklistItems") return "Checklist item";
  return entity;
}

function norm(v: unknown): unknown {
  return v === undefined ? null : v;
}

// ---------------------------------------------------------------------------
// Local text validation (mirrors backend REST limits: title <= 500,
// name <= 100, checklist text <= 500; backend trims before validating).
// ---------------------------------------------------------------------------

function checkText(
  patch: Record<string, unknown>,
  op: MutateOp,
  key: string,
  max: number,
  label: string
): void {
  const v = patch[key];
  if (v === undefined) {
    if (op === "create") throw new Error(`${label} is required`);
    return;
  }
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${label} is required`);
  }
  if (v.trim().length > max) {
    throw new Error(`${label} must be ${max} characters or fewer`);
  }
  patch[key] = v.trim();
}

function assertTextFields(
  entity: string,
  op: MutateOp,
  patch: Record<string, unknown>
): void {
  const titleMax = TITLE_MAX[entity];
  if (titleMax !== undefined) checkText(patch, op, "title", titleMax, "Title");
  if (NAME_TABLES.has(entity)) checkText(patch, op, "name", 100, "Name");
  if (entity === "checklistItems") checkText(patch, op, "text", 500, "Text");
}

// ---------------------------------------------------------------------------
// Hierarchy: local ancestor walk + descendant BFS (mirrors backend
// validateSubtaskHierarchy: root = depth 1, max 3 levels, no cycles).
// ---------------------------------------------------------------------------

async function localDescendants(
  table: Table<SyncRow, string>,
  rootId: string,
  includeDeleted = false
): Promise<{ ids: Set<string>; maxDepth: number }> {
  const ids = new Set<string>();
  let frontier = [rootId];
  let depth = 0;
  let maxDepth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const pid of frontier) {
      const kids = await table.where("parentId").equals(pid).toArray();
      for (const k of kids) {
        const id = k["id"] as string;
        if (typeof id !== "string" || ids.has(id)) continue;
        if (!includeDeleted && (k["deleted"] === 1 || k["deletedAt"] != null)) {
          continue;
        }
        ids.add(id);
        next.push(id);
      }
    }
    if (next.length > 0) maxDepth = depth;
    frontier = next;
    if (depth > 32) break;
  }
  return { ids, maxDepth };
}

async function assertValidParent(
  table: Table<SyncRow, string>,
  taskId: string,
  newParentId: unknown
): Promise<SyncRow | null> {
  if (newParentId == null || newParentId === "") return null;
  if (typeof newParentId !== "string" || !newParentId) {
    throw new Error("Invalid parent");
  }
  if (newParentId === taskId) {
    throw new Error("A task cannot be its own parent");
  }
  const { ids, maxDepth } = await localDescendants(table, taskId);
  if (ids.has(newParentId)) {
    throw new Error("A task cannot have one of its descendants as a parent");
  }
  let cur: unknown = newParentId;
  let depth = 0;
  let parentRow: SyncRow | undefined;
  const seen = new Set<string>();
  while (typeof cur === "string" && cur) {
    if (cur === taskId || seen.has(cur)) {
      throw new Error("A task cannot have one of its descendants as a parent");
    }
    seen.add(cur);
    const row = await table.get(cur);
    if (!row || row["deleted"] === 1 || row["deletedAt"] != null) {
      throw new Error("Parent task not found");
    }
    if (depth === 0) parentRow = row;
    cur = (row["parentId"] as string | null | undefined) ?? null;
    depth += 1;
    if (depth > 32) {
      throw new Error("A task cannot have one of its descendants as a parent");
    }
  }
  if (depth + 1 + maxDepth > 3) {
    throw new Error("Subtasks can be nested up to 3 levels maximum");
  }
  return parentRow ?? null;
}

// ---------------------------------------------------------------------------
// Positions: minimal client mirror of backend positionBetween. New rows
// append at end: generateKeyBetween(lastPos, null). Moves with
// afterId/beforeId resolve locally; failures fall back (server recomputes
// authoritatively from afterId/beforeId since we never ship computed
// positions for moves).
// ---------------------------------------------------------------------------

interface Scope {
  listId?: string;
  taskId?: string;
  parentId?: string | null;
  sectionId?: string | null;
}

interface Sibling {
  id: string;
  position: string;
}

async function siblingEntries(
  table: Table<SyncRow, string>,
  entity: string,
  scope: Scope,
  excludeId: string
): Promise<Sibling[]> {
  let rows: SyncRow[];
  if (entity === "tasks" && typeof scope.listId === "string") {
    rows = await table.where("listId").equals(scope.listId).toArray();
  } else if (entity === "sections" && typeof scope.listId === "string") {
    rows = await table.where("listId").equals(scope.listId).toArray();
  } else if (
    entity === "checklistItems" &&
    typeof scope.taskId === "string"
  ) {
    rows = await table.where("taskId").equals(scope.taskId).toArray();
  } else {
    rows = await table.toArray();
  }
  const out: Sibling[] = [];
  for (const r of rows) {
    if (r["id"] === excludeId) continue;
    if (r["deleted"] === 1 || r["deletedAt"] != null) continue;
    if (typeof r["position"] !== "string") continue;
    if (entity === "tasks") {
      if (r["listId"] !== scope.listId) continue;
      if (norm(r["parentId"]) !== norm(scope.parentId)) continue;
      if (norm(r["sectionId"]) !== norm(scope.sectionId)) continue;
    } else if (entity === "sections") {
      if (r["listId"] !== scope.listId) continue;
    } else if (entity === "checklistItems") {
      if (r["taskId"] !== scope.taskId) continue;
    }
    out.push({ id: r["id"] as string, position: r["position"] as string });
  }
  out.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  return out;
}

async function appendPosition(
  table: Table<SyncRow, string>,
  entity: string,
  scope: Scope,
  excludeId: string
): Promise<string> {
  const siblings = await siblingEntries(table, entity, scope, excludeId);
  const last = siblings.length > 0 ? siblings[siblings.length - 1].position : null;
  return generateKeyBetween(last, null);
}

async function movePosition(
  table: Table<SyncRow, string>,
  entity: string,
  scope: Scope,
  afterId: unknown,
  beforeId: unknown,
  excludeId: string
): Promise<string | null> {
  const siblings = await siblingEntries(table, entity, scope, excludeId);
  const byId = new Map(siblings.map((s) => [s.id, s.position]));
  const a =
    typeof afterId === "string" && afterId ? (byId.get(afterId) ?? null) : null;
  const b =
    typeof beforeId === "string" && beforeId
      ? (byId.get(beforeId) ?? null)
      : null;
  try {
    return generateKeyBetween(a, b);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Outbox helpers (all called inside the write tx).
// ---------------------------------------------------------------------------

async function pendingEntries(
  db: ReturnType<typeof getDB>,
  entity: string,
  entityId: string
): Promise<OutboxEntry[]> {
  const rows = await db.outbox.where("entityId").equals(entityId).toArray();
  return rows
    .filter((e) => e.entity === entity)
    .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
}

function isPlainUpsert(e: OutboxEntry): boolean {
  if (e.op !== "upsert") return false;
  const src = (e as LocalOutboxEntry).srcOp;
  return src === undefined || src === "create";
}

async function addEntry(
  db: ReturnType<typeof getDB>,
  args: {
    entity: string;
    op: "upsert" | "delete";
    entityId: string;
    patch?: Record<string, unknown>;
    editedAt: number;
    createdAt: number;
    srcOp?: DomainOp;
  }
): Promise<string> {
  const entry: LocalOutboxEntry = {
    id: uuidv7(),
    entity: args.entity,
    op: args.op,
    entityId: args.entityId,
    patch: args.patch,
    editedAt: args.editedAt,
    schemaVersion: SCHEMA,
    createdAt: args.createdAt,
    attempts: 0,
  };
  if (args.srcOp) entry.srcOp = args.srcOp;
  await db.outbox.add(entry);
  return entry.id;
}

// Merge into the latest pending entry only when it is a plain upsert;
// otherwise append a new entry (preserves push order).
async function enqueueUpsert(
  db: ReturnType<typeof getDB>,
  entity: string,
  entityId: string,
  patch: Record<string, unknown>,
  editedAt: number,
  now: number,
  srcOp?: DomainOp
): Promise<string> {
  const mine = await pendingEntries(db, entity, entityId);
  const latest = mine[mine.length - 1];
  if (latest && isPlainUpsert(latest)) {
    const merged = { ...(latest.patch ?? {}), ...patch };
    await db.outbox.update(latest.id, { patch: merged, editedAt });
    return latest.id;
  }
  return addEntry(db, {
    entity,
    op: "upsert",
    entityId,
    patch,
    editedAt,
    createdAt: now,
    srcOp,
  });
}

function requireRow(
  existing: SyncRow | undefined,
  entity: string
): asserts existing is SyncRow {
  if (!existing || existing["deleted"] === 1 || existing["deletedAt"] != null) {
    throw new Error(`${singular(entity)} not found`);
  }
}

// ---------------------------------------------------------------------------
// mutate
// ---------------------------------------------------------------------------

export async function mutate(
  userId: string,
  input: MutateInput
): Promise<string> {
  const { entity, op, entityId } = input;
  const patch: Record<string, unknown> = { ...(input.patch ?? {}) };
  if (!DATA_TABLES.has(entity)) throw new Error(`Unknown entity: ${entity}`);
  if (!OPS.has(op)) throw new Error(`Unknown op: ${op}`);
  if (typeof entityId !== "string" || !entityId) {
    throw new Error("entityId is required");
  }
  assertTextFields(entity, op, patch);

  const db = getDB(userId);
  const table = db.table(entity) as Table<SyncRow, string>;
  const now = Date.now();
  const meta = await db.meta.get("clockOffset");
  const offset =
    meta && typeof meta.value === "number" ? (meta.value as number) : 0;
  const editedAt = Math.min(now + offset, now + MAX_FUTURE_SKEW_MS);

  let outboxId = "";
  await db.transaction("rw", [table, db.outbox], async () => {
    const existing = await table.get(entityId);

    switch (op) {
      case "create": {
        let parentRow: SyncRow | null = null;
        if (entity === "tasks" && patch["parentId"] !== undefined) {
          parentRow = await assertValidParent(table, entityId, patch["parentId"]);
        }
        let scope: Scope = {};
        if (entity === "tasks") {
          const listId = parentRow
            ? (parentRow["listId"] as string)
            : (patch["listId"] as string | undefined);
          scope = {
            listId,
            parentId: (patch["parentId"] as string | null) ?? null,
            sectionId: (patch["sectionId"] as string | null) ?? null,
          };
        } else if (entity === "sections") {
          scope = { listId: patch["listId"] as string | undefined };
        } else if (entity === "checklistItems") {
          scope = { taskId: patch["taskId"] as string | undefined };
        }
        const position =
          typeof patch["position"] === "string" && patch["position"]
            ? (patch["position"] as string)
            : await appendPosition(table, entity, scope, entityId);
        const row: SyncRow = {
          ...(existing ?? {}),
          ...patch,
          id: entityId,
          position,
          updatedAt: editedAt,
        };
        if (parentRow) row["listId"] = parentRow["listId"] as string;
        if (!existing) {
          row["createdAt"] = now;
          row["deleted"] = 0;
          row["deletedAt"] = null;
        }
        await table.put(row);
        outboxId = await enqueueUpsert(
          db,
          entity,
          entityId,
          { ...patch, position },
          editedAt,
          now,
          existing ? undefined : "create"
        );
        break;
      }

      case "update": {
        requireRow(existing, entity);
        const row: SyncRow = {
          ...existing,
          ...patch,
          id: entityId,
          updatedAt: editedAt,
        };
        await table.put(row);
        outboxId = await enqueueUpsert(
          db,
          entity,
          entityId,
          patch,
          editedAt,
          now
        );
        break;
      }

      case "delete": {
        const pending = await pendingEntries(db, entity, entityId);
        if (
          pending.length > 0 &&
          pending.every(isPlainUpsert) &&
          pending.some((e) => (e as LocalOutboxEntry).srcOp === "create")
        ) {
          // Created locally and never synced: cancel instead of tombstoning.
          await db.outbox.bulkDelete(pending.map((e) => e.id));
          await table.delete(entityId);
          outboxId = "";
          break;
        }
        const latest = pending[pending.length - 1];
        if (latest && latest.op === "delete") {
          outboxId = latest.id;
        } else {
          outboxId = await addEntry(db, {
            entity,
            op: "delete",
            entityId,
            editedAt,
            createdAt: now,
          });
        }
        const tombstone = {
          deletedAt: editedAt,
          deleted: 1,
          updatedAt: editedAt,
        };
        if (existing) {
          await table.update(entityId, tombstone);
          if (entity === "tasks") {
            const { ids } = await localDescendants(table, entityId);
            for (const id of ids) {
              await table.update(id, tombstone);
            }
          }
        } else {
          await table.put({
            id: entityId,
            ...tombstone,
            createdAt: now,
          });
        }
        break;
      }

      case "complete": {
        if (entity !== "tasks") {
          throw new Error(`Op "complete" is not supported for ${entity}`);
        }
        requireRow(existing, entity);
        await table.update(entityId, {
          status: "done",
          completedAt: editedAt,
          updatedAt: editedAt,
        });
        if (patch["completeSubtasks"] === true) {
          const { ids } = await localDescendants(table, entityId);
          for (const id of ids) {
            await table.update(id, {
              status: "done",
              completedAt: editedAt,
              updatedAt: editedAt,
            });
          }
        }
        // Domain op: separate entry, never coalesced.
        outboxId = await addEntry(db, {
          entity,
          op: "upsert",
          entityId,
          patch,
          editedAt,
          createdAt: now,
          srcOp: "complete",
        });
        break;
      }

      case "move": {
        requireRow(existing, entity);
        const sets: SyncRow = {};
        for (const [k, v] of Object.entries(patch)) {
          if (!CONTROL_KEYS.has(k)) sets[k] = v;
        }
        if (entity === "tasks") {
          let nextListId = existing["listId"] as string;
          const rawParent =
            patch["parentId"] !== undefined
              ? (patch["parentId"] as string | null)
              : ((existing["parentId"] as string | null | undefined) ?? null);
          let parentRow: SyncRow | null = null;
          if (patch["parentId"] !== undefined) {
            parentRow = await assertValidParent(table, entityId, rawParent);
            if (rawParent) nextListId = parentRow!["listId"] as string;
          }
          if (
            patch["listId"] !== undefined &&
            (patch["listId"] as string) !== (existing["listId"] as string)
          ) {
            if (rawParent) {
              throw new Error("Subtasks must stay in their parent's list");
            }
            nextListId = patch["listId"] as string;
          }
          let nextSectionId: unknown;
          if (
            nextListId !== (existing["listId"] as string) &&
            patch["sectionId"] === undefined
          ) {
            nextSectionId = null;
          } else if (patch["sectionId"] !== undefined) {
            const s = patch["sectionId"] as string | null;
            nextSectionId = s === "" ? null : s;
          } else {
            nextSectionId = (existing["sectionId"] as string | null) ?? null;
          }
          let nextPosition = existing["position"] as string | undefined;
          if (
            typeof patch["position"] === "string" &&
            (patch["position"] as string)
          ) {
            nextPosition = patch["position"] as string;
          } else if (
            patch["afterId"] !== undefined ||
            patch["beforeId"] !== undefined
          ) {
            const computed = await movePosition(
              table,
              entity,
              {
                listId: nextListId,
                parentId: rawParent ?? null,
                sectionId: (nextSectionId as string | null) ?? null,
              },
              patch["afterId"],
              patch["beforeId"],
              entityId
            );
            if (computed) nextPosition = computed;
          }
          sets["listId"] = nextListId;
          sets["parentId"] = rawParent ?? null;
          sets["sectionId"] = nextSectionId ?? null;
          if (nextPosition !== undefined) sets["position"] = nextPosition;
          if (nextListId !== (existing["listId"] as string)) {
            const { ids } = await localDescendants(table, entityId);
            for (const id of ids) {
              await table.update(id, { listId: nextListId, updatedAt: editedAt });
            }
          }
        } else if (
          patch["afterId"] !== undefined ||
          patch["beforeId"] !== undefined
        ) {
          // Container move (folders/lists/sections/checklistItems): resolve
          // position locally within the target scope.
          let scope: Scope = {};
          if (entity === "sections") {
            scope = {
              listId: (patch["listId"] as string | undefined) ??
                (existing["listId"] as string | undefined),
            };
          } else if (entity === "checklistItems") {
            scope = { taskId: existing["taskId"] as string | undefined };
          }
          const computed = await movePosition(
            table,
            entity,
            scope,
            patch["afterId"],
            patch["beforeId"],
            entityId
          );
          if (computed && typeof patch["position"] !== "string") {
            sets["position"] = computed;
          }
        }
        sets["updatedAt"] = editedAt;
        await table.update(entityId, sets);
        // Domain op: separate entry, never coalesced. Computed positions
        // stay local; the server recomputes from afterId/beforeId.
        outboxId = await addEntry(db, {
          entity,
          op: "upsert",
          entityId,
          patch,
          editedAt,
          createdAt: now,
          srcOp: "move",
        });
        break;
      }

      case "restore": {
        if (
          !existing ||
          (existing["deleted"] !== 1 && existing["deletedAt"] == null)
        ) {
          throw new Error(`${singular(entity)} is not deleted`);
        }
        const stamp = existing["deletedAt"];
        await table.update(entityId, {
          deletedAt: null,
          deleted: 0,
          updatedAt: editedAt,
        });
        if (entity === "tasks") {
          // Revive descendants tombstoned in the same cascade (same stamp).
          const { ids } = await localDescendants(table, entityId, true);
          for (const id of ids) {
            const r = await table.get(id);
            if (r && r["deletedAt"] === stamp) {
              await table.update(id, {
                deletedAt: null,
                deleted: 0,
                updatedAt: editedAt,
              });
            }
          }
        }
        // Domain op: separate entry, never coalesced.
        outboxId = await addEntry(db, {
          entity,
          op: "upsert",
          entityId,
          patch,
          editedAt,
          createdAt: now,
          srcOp: "restore",
        });
        break;
      }
    }
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT));
  }
  return outboxId;
}
