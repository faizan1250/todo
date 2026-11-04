import type {
  BackendTask,
  BackendChecklistItem,
  BackendTag,
  CreateTaskInput,
  UpdateTaskInput,
} from "./api";
import type { TaskItem, Subtask, ChecklistItemUi, Priority, ListId, FolderId } from "@/components/app/types";

/**
 * Convert backend integer priority (0..4) to UI Priority ("low" | "med" | "high")
 * 0 (none) -> "low"
 * 1 (low) -> "low"
 * 2 (med) -> "med"
 * 3 (high) -> "high"
 * 4 (urgent) -> "high"
 */
export function priorityBackendToUi(priority: number): Priority {
  if (priority >= 3) return "high";
  if (priority === 2) return "med";
  return "low";
}

/**
 * Convert UI Priority ("low" | "med" | "high") to backend integer priority (1..3)
 */
export function priorityUiToBackend(priority: Priority): number {
  switch (priority) {
    case "high":
      return 3;
    case "med":
      return 2;
    case "low":
    default:
      return 1;
  }
}

/**
 * Format due date into a human-friendly string ("Today", "Tomorrow", "Yesterday", or "Oct 24")
 */
export function formatDueDate(dueAt?: string | number | null): string | undefined {
  if (!dueAt) return undefined;

  const date = typeof dueAt === "number" || typeof dueAt === "string" ? new Date(dueAt) : null;
  if (!date || isNaN(date.getTime())) return undefined;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffMs = targetDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Format creation or update timestamp
 */
export function formatTimestamp(ts?: string | number | null): string {
  if (!ts) return "Just now";

  const date = typeof ts === "number" || typeof ts === "string" ? new Date(ts) : null;
  if (!date || isNaN(date.getTime())) return "Just now";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);

  if (diffSec < 60) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return "Yesterday";
  }

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Infer folder category from task tags or default
 */
export function determineTaskFolder(task: BackendTask): FolderId {
  const rawTags = task.tags || [];
  const tagNames = rawTags.map((t) => (typeof t === "string" ? t : t.name).toLowerCase());

  if (tagNames.some((n) => n.includes("design") || n.includes("ui") || n.includes("ux"))) {
    return "design";
  }
  if (tagNames.some((n) => n.includes("personal") || n.includes("life") || n.includes("habit"))) {
    return "personal";
  }
  return "engineering";
}

/**
 * Determine which smart list a task belongs to (today, upcoming, backlog, completed)
 */
export function determineTaskList(task: BackendTask): ListId {
  if (task.status === "done") {
    return "completed";
  }

  if (task.dueAt) {
    const dueDate = new Date(task.dueAt);
    if (!isNaN(dueDate.getTime())) {
      const now = new Date();
      const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      if (dueDate <= endOfToday) {
        return "today";
      }
      return "upcoming";
    }
  }

  return "backlog";
}

/**
 * Convert a backend task entity to the UI TaskItem model
 */
export function backendTaskToTaskItem(
  task: BackendTask,
  options?: {
    listOverride?: ListId;
    folderOverride?: FolderId;
  }
): TaskItem {
  // Extract tags as string array
  const tags: string[] = Array.isArray(task.tags)
    ? task.tags.map((t: BackendTag | string) => (typeof t === "string" ? t : t.name))
    : [];

  // Extract subtasks (from task.subtasks or task.checklist)
  let subtasks: Subtask[] = [];
  if (Array.isArray(task.subtasks) && task.subtasks.length > 0) {
    subtasks = task.subtasks.map((st) => ({
      id: st.id,
      title: st.title,
      completed: st.status === "done",
    }));
  } else if (Array.isArray(task.checklist) && task.checklist.length > 0) {
    subtasks = task.checklist.map((ci) => ({
      id: ci.id,
      title: ci.text,
      completed: ci.done,
    }));
  }

  // Extract checklist items
  const checklist: ChecklistItemUi[] = Array.isArray(task.checklist)
    ? task.checklist.map((ci: BackendChecklistItem) => ({
        id: ci.id,
        text: ci.text,
        done: ci.done,
        position: ci.position,
      }))
    : [];

  const completed = task.status === "done";
  const priority = priorityBackendToUi(task.priority);
  const folder = options?.folderOverride ?? determineTaskFolder(task);
  const list = options?.listOverride ?? determineTaskList(task);

  return {
    id: task.id,
    title: task.title,
    description: task.notes || undefined,
    notes: task.notes,
    completed,
    priority,
    numericPriority: task.priority,
    list,
    folder,
    tags,
    dueDate: formatDueDate(task.dueAt),
    dueAt: task.dueAt,
    subtasks,
    checklist,
    createdAt: formatTimestamp(task.createdAt),
    updatedAt: formatTimestamp(task.updatedAt),
    listId: task.listId,
    sectionId: task.sectionId,
    parentId: task.parentId,
    position: task.position,
    version: task.version,
    rawStatus: task.status,
  };
}

/**
 * Convert a UI task item to CreateTaskInput for the backend API
 */
export function taskItemToBackendCreateInput(
  item: {
    title: string;
    priority?: Priority;
    numericPriority?: number;
    description?: string;
    notes?: string | null;
    folder?: FolderId;
    list?: ListId;
    dueAt?: string | number | null;
    sectionId?: string | null;
    parentId?: string | null;
    tagIds?: string[];
  },
  listId: string
): CreateTaskInput {
  const priority =
    item.numericPriority !== undefined
      ? item.numericPriority
      : item.priority
      ? priorityUiToBackend(item.priority)
      : 1;

  return {
    title: item.title.trim(),
    listId,
    notes: item.notes || item.description || null,
    priority,
    status: "todo",
    dueAt: item.dueAt ?? null,
    sectionId: item.sectionId ?? null,
    parentId: item.parentId ?? null,
    tagIds: item.tagIds,
  };
}

/**
 * Convert a UI task item to UpdateTaskInput for the backend API
 */
export function taskItemToBackendUpdateInput(
  item: Partial<TaskItem>
): UpdateTaskInput {
  const input: UpdateTaskInput = {};

  if (item.title !== undefined) input.title = item.title;
  if (item.notes !== undefined) input.notes = item.notes;
  if (item.description !== undefined && item.notes === undefined) {
    input.notes = item.description;
  }
  if (item.numericPriority !== undefined) {
    input.priority = item.numericPriority;
  } else if (item.priority !== undefined) {
    input.priority = priorityUiToBackend(item.priority);
  }
  if (item.completed !== undefined) {
    input.status = item.completed ? "done" : "todo";
  }
  if (item.dueAt !== undefined) input.dueAt = item.dueAt;
  if (item.listId !== undefined) input.listId = item.listId;
  if (item.sectionId !== undefined) input.sectionId = item.sectionId;
  if (item.parentId !== undefined) input.parentId = item.parentId;
  if (item.position !== undefined) input.position = item.position;
  if (item.version !== undefined) input.version = item.version;

  return input;
}
