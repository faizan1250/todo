import Dexie, { type Table } from "dexie";

export type SyncRow = Record<string, unknown>;

export interface SyncMeta {
  key: string;
  value: unknown;
}

export interface OutboxEntry {
  id: string;
  entity: string;
  op: string;
  entityId: string;
  patch?: SyncRow;
  editedAt: number;
  schemaVersion?: number;
  createdAt: number;
  attempts: number;
}

const entityStores: Record<string, string> = {
  folders: "id, userId, seq, updatedAt, deletedAt, [userId+seq]",
  lists: "id, userId, seq, updatedAt, deletedAt, folderId, [userId+seq]",
  sections: "id, userId, seq, updatedAt, deletedAt, listId, [userId+seq]",
  tasks:
    "id, userId, seq, updatedAt, deletedAt, listId, sectionId, parentId, recurrenceId, placeId, [userId+seq]",
  checklistItems: "id, userId, seq, updatedAt, deletedAt, taskId, [userId+seq]",
  tags: "id, userId, seq, updatedAt, deletedAt, [userId+seq]",
  templates: "id, userId, seq, updatedAt, deletedAt, [userId+seq]",
  reminders: "id, userId, seq, updatedAt, deletedAt, taskId, [userId+seq]",
  recurrences: "id, userId, seq, updatedAt, deletedAt, [userId+seq]",
  places: "id, userId, seq, updatedAt, deletedAt, [userId+seq]",
  savedFilters: "id, userId, seq, updatedAt, deletedAt, [userId+seq]",
  timeBlocks: "id, userId, seq, updatedAt, deletedAt, taskId, [userId+seq]",
  user: "id, seq, updatedAt",
};

export class TodoDB extends Dexie {
  folders!: Table<SyncRow, string>;
  lists!: Table<SyncRow, string>;
  sections!: Table<SyncRow, string>;
  tasks!: Table<SyncRow, string>;
  checklistItems!: Table<SyncRow, string>;
  tags!: Table<SyncRow, string>;
  templates!: Table<SyncRow, string>;
  reminders!: Table<SyncRow, string>;
  recurrences!: Table<SyncRow, string>;
  places!: Table<SyncRow, string>;
  savedFilters!: Table<SyncRow, string>;
  timeBlocks!: Table<SyncRow, string>;
  user!: Table<SyncRow, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<SyncMeta, string>;

  constructor() {
    super("TodoDB");
    this.version(2).stores({
      ...entityStores,
      outbox: "id, entity, createdAt",
      meta: "key",
    });
  }
}

export const db = new TodoDB();