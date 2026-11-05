// Local-first row shapes for the per-user Dexie DB (Phase 5).
//
// Convention (matches TodoDB indexes in lib/db/schema.ts):
// - camelCase keys, timestamps as UTC ms numbers (or null).
// - `deleted` is the derived 0|1 flag; `deletedAt` is ms|null.
// Day-2 apply layer maps server rows into these shapes; Day-1b optimistic
// writes in mutate.ts already conform to them.

export interface LocalTask {
  id: string;
  listId: string;
  parentId: string | null;
  sectionId: string | null;
  title: string;
  notes: string | null;
  status: string;
  priority: number;
  position: string;
  startAt: number | null;
  dueAt: number | null;
  deadlineAt: number | null;
  allDay: boolean;
  estimateMin: number | null;
  recurrenceId: string | null;
  placeId: string | null;
  completedAt: number | null;
  archivedAt: number | null;
  tagIds?: string[];
  deleted: 0 | 1;
  deletedAt: number | null;
  updatedAt: number;
  createdAt: number;
  [k: string]: unknown;
}

export interface LocalList {
  id: string;
  name: string;
  folderId: string | null;
  isInbox: boolean;
  archivedAt: number | null;
  position: string;
  deleted: 0 | 1;
  deletedAt: number | null;
  updatedAt: number;
  createdAt: number;
  [k: string]: unknown;
}

export interface LocalSection {
  id: string;
  listId: string;
  name: string;
  position: string;
  deleted: 0 | 1;
  deletedAt: number | null;
  updatedAt: number;
  createdAt: number;
  [k: string]: unknown;
}

export interface LocalTag {
  id: string;
  name: string;
  color: string | null;
  updatedAt: number;
  createdAt: number;
  [k: string]: unknown;
}

export interface LocalChecklistItem {
  id: string;
  taskId: string;
  text: string;
  done: boolean;
  position: string;
  deleted: 0 | 1;
  deletedAt: number | null;
  updatedAt: number;
  createdAt: number;
  [k: string]: unknown;
}
