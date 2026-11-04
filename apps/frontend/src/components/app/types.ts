export type ListId = "today" | "upcoming" | "backlog" | "completed";

export type FolderId = "engineering" | "design" | "personal";

export type Priority = "high" | "med" | "low";

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface TaskItem {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  priority: Priority;
  list: ListId;
  folder: FolderId;
  tags: string[];
  dueDate?: string;
  subtasks: Subtask[];
  createdAt: string;
  updatedAt: string;
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
