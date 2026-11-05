import Dexie, { type Table } from "dexie";

// Per-user Dexie DB (Phase 5). Separate from src/lib/sync/db.ts (old
// single-DB engine) which stays untouched until cutover at the end.
//
// DB name: `todo-${userId}`, version 1. One Dexie instance per userId,
// cached in module scope via getDB().
//
// Conventions (set by the Day 2 apply layer, not here):
// - `deleted` is a derived 0|1 flag materialized on every row from
//   deletedAt, so compound indexes can filter out trashed rows.
// - `tagIds` lives on task rows as string[] (no index; membership
//   filtering happens in memory after the indexed query).

export type SyncRow = Record<string, unknown>;

export type OutboxOp = "upsert" | "delete";

export interface OutboxEntry {
  id: string;
  entity: string;
  op: OutboxOp;
  entityId: string;
  patch?: Record<string, unknown>;
  editedAt: number;
  schemaVersion?: number;
  createdAt: number;
  attempts: number;
}

export interface MetaRow {
  key: MetaKey;
  value: unknown;
}

// Known meta keys. Cursor/epoch drive incremental pull, deviceId +
// clockOffset drive LWW tie-breaking, schemaVersion gates migrations.
export type MetaKey =
  | "cursor"
  | "epoch"
  | "deviceId"
  | "clockOffset"
  | "schemaVersion"
  | (string & {});

export class TodoDB extends Dexie {
  tasks!: Table<SyncRow, string>;
  lists!: Table<SyncRow, string>;
  folders!: Table<SyncRow, string>;
  sections!: Table<SyncRow, string>;
  checklistItems!: Table<SyncRow, string>;
  tags!: Table<SyncRow, string>;
  templates!: Table<SyncRow, string>;
  reminders!: Table<SyncRow, string>;
  recurrences!: Table<SyncRow, string>;
  places!: Table<SyncRow, string>;
  timeBlocks!: Table<SyncRow, string>;
  savedFilters!: Table<SyncRow, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<MetaRow, string>;

  constructor(userId: string) {
    super(`todo-${userId}`);
    this.version(1).stores({
      tasks:
        "id, listId, parentId, [listId+deleted+position], [deleted+status+dueAt], dueAt, seq",
      lists: "id, folderId, seq",
      folders: "id, seq",
      sections: "id, listId, seq",
      checklistItems: "id, taskId, seq",
      tags: "id, seq",
      templates: "id, seq",
      reminders: "id, taskId, seq",
      recurrences: "id, seq",
      places: "id, seq",
      timeBlocks: "id, taskId, seq",
      savedFilters: "id, seq",
      outbox: "id, entityId, createdAt",
      meta: "key",
    });
  }
}

const cache = new Map<string, TodoDB>();

export function getDB(userId: string): TodoDB {
  let db = cache.get(userId);
  if (!db) {
    db = new TodoDB(userId);
    cache.set(userId, db);
  }
  return db;
}
