export type SystemViewId =
  | "today"
  | "upcoming"
  | "backlog"
  | "completed"
  | "overdue"
  | "priority"
  | "no-date"
  | "all";

export type ViewMode = "list" | "calendar" | "planner";

export type ListId = SystemViewId | (string & {});

export type FolderId = "engineering" | "design" | "personal" | (string & {});

export type Priority = "high" | "med" | "low";

export interface HierarchicalSubtask {
  id: string;
  parentId?: string | null;
  title: string;
  completed: boolean;
  priority?: Priority;
  depth: number;
  subtasks?: HierarchicalSubtask[];
}

export type Subtask = HierarchicalSubtask;

export interface ChecklistItemUi {
  id: string;
  taskId?: string;
  text: string;
  done: boolean;
  position?: string;
}

export interface ReminderItem {
  id: string;
  taskId?: string;
  kind: "absolute" | "relative";
  relativeTo?: "due" | "start" | "deadline" | null;
  offsetMin?: number | null;
  remindAt?: string | number | null;
  firedAt?: string | number | null;
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
  tagIds?: string[];
  dueDate?: string;
  dueAt?: string | number | null;
  startAt?: string | number | null;
  deadlineAt?: string | number | null;
  allDay?: boolean;
  estimateMin?: number | null;
  estimateTotal?: number | null;
  recurrenceId?: string | null;
  recurrenceRule?: { rrule: string; mode: "fixed" | "after_completion" } | null;
  placeId?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number | null;
  locationTrigger?: "arrive" | "leave" | null;
  reminders?: ReminderItem[];
  subtasks: HierarchicalSubtask[];
  checklist: ChecklistItemUi[];
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

// -------------------------------------------------------------
// Tactile Color Palette Swatches (Deep Blue + Bubblegum Pink Theme)
// -------------------------------------------------------------
export interface ColorSwatch {
  id: string;
  name: string;
  hex: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
}

export const TACTILE_COLOR_SWATCHES: ColorSwatch[] = [
  {
    id: "deep-blue",
    name: "Deep Blue",
    hex: "#09318D",
    bgClass: "bg-[#09318D]",
    borderClass: "border-[#09318D]",
    textClass: "text-[#09318D]",
  },
  {
    id: "bubblegum-pink",
    name: "Bubblegum Pink",
    hex: "#FD91CC",
    bgClass: "bg-[#FD91CC]",
    borderClass: "border-[#FD91CC]",
    textClass: "text-[#FD91CC]",
  },
  {
    id: "emerald",
    name: "Emerald",
    hex: "#10B981",
    bgClass: "bg-[#10B981]",
    borderClass: "border-[#10B981]",
    textClass: "text-[#10B981]",
  },
  {
    id: "amber",
    name: "Amber",
    hex: "#F59E0B",
    bgClass: "bg-[#F59E0B]",
    borderClass: "border-[#F59E0B]",
    textClass: "text-[#F59E0B]",
  },
  {
    id: "violet",
    name: "Violet",
    hex: "#8B5CF6",
    bgClass: "bg-[#8B5CF6]",
    borderClass: "border-[#8B5CF6]",
    textClass: "text-[#8B5CF6]",
  },
  {
    id: "rose",
    name: "Rose",
    hex: "#F43F5E",
    bgClass: "bg-[#F43F5E]",
    borderClass: "border-[#F43F5E]",
    textClass: "text-[#F43F5E]",
  },
  {
    id: "cyan",
    name: "Cyan",
    hex: "#06B6D4",
    bgClass: "bg-[#06B6D4]",
    borderClass: "border-[#06B6D4]",
    textClass: "text-[#06B6D4]",
  },
  {
    id: "slate",
    name: "Slate",
    hex: "#64748B",
    bgClass: "bg-[#64748B]",
    borderClass: "border-[#64748B]",
    textClass: "text-[#64748B]",
  },
];

// -------------------------------------------------------------
// Icon Presets for Lists & Folders
// -------------------------------------------------------------
export const LIST_ICON_PRESETS = [
  "list",
  "check-square",
  "briefcase",
  "code",
  "sparkles",
  "book-open",
  "heart",
  "flag",
  "star",
  "zap",
] as const;

export const FOLDER_ICON_PRESETS = [
  "folder",
  "briefcase",
  "code",
  "layers",
  "bookmark",
  "sparkles",
  "tag",
  "archive",
] as const;
