import Dexie, { type Table } from "dexie";

export interface SyncMeta {
  key: string;
  value: unknown;
}

export interface OutboxEntry {
  id: string;
  entity: string;
  op: string;
  entityId: string;
  patch?: any;
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
  folders!: Table<any, string>;
  lists!: Table<any, string>;
  sections!: Table<any, string>;
  tasks!: Table<any, string>;
  checklistItems!: Table<any, string>;
  tags!: Table<any, string>;
  templates!: Table<any, string>;
  reminders!: Table<any, string>;
  recurrences!: Table<any, string>;
  places!: Table<any, string>;
  savedFilters!: Table<any, string>;
  timeBlocks!: Table<any, string>;
  user!: Table<any, string>;
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