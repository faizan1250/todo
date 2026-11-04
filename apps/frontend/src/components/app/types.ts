export type ListId = "today" | "upcoming" | "backlog" | "completed";

export type FolderId = "engineering" | "design" | "personal";

export type Priority = "high" | "med" | "low";

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface ChecklistItemUi {
  id: string;
  text: string;
  done: boolean;
  position?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  notes?: string | null;
  completed: boolean;
  priority: Priority;
  numericPriority?: number;
  list: ListId;
  folder: FolderId;
  tags: string[];
  dueDate?: string;
  dueAt?: string | number | null;
  subtasks: Subtask[];
  checklist?: ChecklistItemUi[];
  createdAt: string;
  updatedAt: string;
  listId?: string;
  sectionId?: string | null;
  parentId?: string | null;
  position?: string;
  version?: number;
  rawStatus?: "todo" | "in_progress" | "done" | "cancelled";
}

export interface ListMeta {
  id: ListId;
  label: string;
  icon: string;
  count?: number;
}

export interface FolderMeta {
  id: FolderId;
  label: string;
  color: string;
  count?: number;
}
