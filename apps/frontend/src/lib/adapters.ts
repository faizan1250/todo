import type {
  BackendTask,
  BackendChecklistItem,
  BackendTag,
  BackendReminder,
  CreateTaskInput,
  UpdateTaskInput,
} from "./api";
import type {
  TaskItem,
  HierarchicalSubtask,
  ChecklistItemUi,
  ReminderItem,
  Priority,
  ListId,
  FolderId,
} from "@/components/app/types";

/**
 * Format minutes into human-readable estimate (e.g. 30 -> "30m", 90 -> "1h 30m")
 */
export function formatEstimate(min?: number | null): string {
  if (min === null || min === undefined || isNaN(min) || min <= 0) return "";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

/**
 * Format due date into a human-friendly string ("Today", "Tomorrow", "Yesterday", or "Oct 24")
 */
export function formatDueDate(dueAt?: string | number | Date | null): string | undefined {
  if (!dueAt) return undefined;

  const date =
    dueAt instanceof Date
      ? dueAt
      : typeof dueAt === "number" || typeof dueAt === "string"
      ? new Date(dueAt)
      : null;
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
 * Format a date/time stamp nicely. If allDay is true, returns date only.
 */
export function formatDateWithTime(date?: string | number | Date | null, allDay?: boolean): string {
  if (!date) return "";
  const d =
    date instanceof Date
      ? date
      : typeof date === "number" || typeof date === "string"
      ? new Date(date)
      : null;
  if (!d || isNaN(d.getTime())) return "";

  const datePart = formatDueDate(date) || d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (allDay) {
    return datePart;
  }
  const timePart = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${datePart} at ${timePart}`;
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
 * Compute the rollup total estimate (self + all subtasks recursively)
 */
export function computeEstimateTotal(task: BackendTask): number | null {
  if (typeof task.estimateTotal === "number") return task.estimateTotal;
  let total = typeof task.estimateMin === "number" ? task.estimateMin : 0;
  let hasAny = typeof task.estimateMin === "number";

  const recurseSubtasks = (subs?: BackendTask[]) => {
    if (!Array.isArray(subs)) return;
    for (const sub of subs) {
      if (typeof sub.estimateMin === "number") {
        total += sub.estimateMin;
        hasAny = true;
      }
      if (sub.subtasks) recurseSubtasks(sub.subtasks);
    }
  };

  recurseSubtasks(task.subtasks);
  return hasAny ? total : null;
}

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

  if (task.status === "done") {
    return "completed";
  }

  return "backlog";
}

/**
 * Recursively map backend tasks to HierarchicalSubtask tree with depth tracking
 */
export function mapBackendSubtasks(
  subtasks?: BackendTask[],
  parentDepth = 1
): HierarchicalSubtask[] {
  if (!Array.isArray(subtasks) || subtasks.length === 0) return [];
  const currentDepth = Math.min(3, parentDepth + 1);
  return subtasks.map((st) => ({
    id: st.id,
    parentId: st.parentId ?? null,
    title: st.title,
    completed: st.status === "done",
    priority: priorityBackendToUi(st.priority),
    depth: currentDepth,
    subtasks: mapBackendSubtasks(st.subtasks, currentDepth),
  }));
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
  const tagIds: string[] = Array.isArray(task.tags)
    ? task.tags.map((t: BackendTag | string) => (typeof t === "string" ? t : t.id))
    : [];

  // Extract hierarchical subtasks strictly from task.subtasks (recursive tree)
  const subtasks: HierarchicalSubtask[] = mapBackendSubtasks(task.subtasks, 1);

  // Extract checklist items strictly from task.checklist
  const checklist: ChecklistItemUi[] = Array.isArray(task.checklist)
    ? task.checklist.map((ci: BackendChecklistItem) => ({
        id: ci.id,
        taskId: ci.taskId,
        text: ci.text,
        done: ci.done,
        position: ci.position,
      }))
    : [];

  const completed = task.status === "done";
  const priority = priorityBackendToUi(task.priority);
  const folder = options?.folderOverride ?? determineTaskFolder(task);
  const list = options?.listOverride ?? determineTaskList(task);

  const recurrenceRule =
    task.recurrenceRule ||
    (task.recurrence
      ? { rrule: task.recurrence.rrule, mode: task.recurrence.mode || "fixed" }
      : null);

  const reminders: ReminderItem[] = Array.isArray(task.reminders)
    ? task.reminders.map((r: BackendReminder) => ({
        id: r.id,
        taskId: r.taskId,
        kind: r.kind,
        relativeTo: r.relativeTo,
        offsetMin: r.offsetMin,
        remindAt: r.remindAt,
        firedAt: r.firedAt,
      }))
    : [];

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
    tagIds,
    dueDate: formatDueDate(task.dueAt),
    dueAt: task.dueAt,
    startAt: task.startAt,
    deadlineAt: task.deadlineAt,
    allDay: task.allDay ?? false,
    estimateMin: task.estimateMin,
    estimateTotal: computeEstimateTotal(task),
    recurrenceId: task.recurrenceId,
    recurrenceRule,
    placeId: task.placeId,
    locationName: task.locationName,
    lat: task.lat,
    lng: task.lng,
    radiusM: task.radiusM,
    locationTrigger: task.locationTrigger,
    reminders,
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
    startAt?: string | number | null;
    deadlineAt?: string | number | null;
    allDay?: boolean;
    estimateMin?: number | null;
    placeId?: string | null;
    locationName?: string | null;
    lat?: number | null;
    lng?: number | null;
    radiusM?: number | null;
    locationTrigger?: "arrive" | "leave" | null;
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
    startAt: item.startAt ?? null,
    deadlineAt: item.deadlineAt ?? null,
    allDay: item.allDay ?? false,
    estimateMin: item.estimateMin ?? null,
    placeId: item.placeId ?? null,
    locationName: item.locationName ?? null,
    lat: item.lat ?? null,
    lng: item.lng ?? null,
    radiusM: item.radiusM ?? null,
    locationTrigger: item.locationTrigger ?? null,
    sectionId: item.sectionId ?? null,
    parentId: item.parentId ?? null,
    tagIds: item.tagIds,
  };
}

/**
 * Convert a UI task item to UpdateTaskInput for the backend API
 */
export function taskItemToBackendUpdateInput(
  item: Partial<TaskItem> & { tagIds?: string[] }
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
  if (item.startAt !== undefined) input.startAt = item.startAt;
  if (item.deadlineAt !== undefined) input.deadlineAt = item.deadlineAt;
  if (item.allDay !== undefined) input.allDay = item.allDay;
  if (item.estimateMin !== undefined) input.estimateMin = item.estimateMin;
  if (item.placeId !== undefined) input.placeId = item.placeId;
  if (item.locationName !== undefined) input.locationName = item.locationName;
  if (item.lat !== undefined) input.lat = item.lat;
  if (item.lng !== undefined) input.lng = item.lng;
  if (item.radiusM !== undefined) input.radiusM = item.radiusM;
  if (item.locationTrigger !== undefined) input.locationTrigger = item.locationTrigger;
  if (item.listId !== undefined) input.listId = item.listId;
  if (item.sectionId !== undefined) input.sectionId = item.sectionId;
  if (item.parentId !== undefined) input.parentId = item.parentId;
  if (item.position !== undefined) input.position = item.position;
  if (item.version !== undefined) input.version = item.version;
  if (item.tagIds !== undefined) input.tagIds = item.tagIds;

  return input;
}
