"use client";

import * as React from "react";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Sidebar } from "./sidebar";
import { TaskPane } from "./task-pane";
import { CalendarView } from "./calendar-view";
import { PlannerView } from "./planner-view";
import { BoardView } from "./board-view";
import { TaskDetailPanel } from "./task-detail-panel";
import { CompleteSubtasksDialog } from "./complete-subtasks-dialog";
import { StreakCelebration } from "./streak-celebration";
import { CommandPalette } from "./command-palette";
import { KeyboardShortcutsModal } from "./keyboard-shortcuts-modal";
import { MobileNav } from "./mobile-nav";
import { ToastProvider, useToast } from "./toast-system";
import { ListDialog } from "./list-dialog";
import { FolderDialog } from "./folder-dialog";
import { FilterDialog } from "./filter-dialog";
import { BulkActionToolbar } from "./bulk-action-toolbar";
import { TrashModal } from "./trash-modal";
import { TemplatesModal } from "./templates-modal";
import { TagsModal } from "./tags-modal";
import { useAuth } from "@/components/auth";
import { useLiveQuery } from "dexie-react-hooks";
import { getDB } from "@/lib/db/schema";
import { v7 as uuidv7 } from "uuid";
import { mutate } from "@/lib/data/mutate";
import { inverseOf, pushUndo, popUndo } from "@/lib/tasks/undo";
import { restoreFromTrash } from "../sync/conflict-actions";
import { subscribeRemoteChanged } from "../sync/remote-events";
import {
  getLists,
  getFolders,
  getTasks,
  getTask,
  getViewsCounts,
  getViewItems,
  getCalendar,
  getBoard,
  moveBoardTask,
  moveTask,
  createTask,
  quickAddTask,
  parseNaturalLanguageText,
  updateTask,
  deleteTask,
  completeTask,
  skipTask,
  reopenTask,
  archiveTask,
  unarchiveTask,
  duplicateTask,
  saveTaskAsTemplate,
  createChecklistItem,
  updateChecklistItem,
  deleteChecklistItem,
  replaceTaskTags,
  restoreTrash,
  bulkTasks,
  deleteList,
  archiveList,
  deleteFolder,
  getTags,
  getFilters,
  createFilter,
  updateFilter,
  deleteFilter,
  moveFilter,
  getFilterTasks,
  previewFilter,
  type BackendSavedFilter,
  type BackendList,
  type BackendFolder,
  type BackendTask,
  type BackendTag,
  type BackendViewTask,
  type BackendViewCountsResponse,
  type TaskCompletionResult,
  type ParsedTaskResult,
} from "@/lib/api";
import {
  backendTaskToTaskItem,
  priorityUiToBackend,
  priorityBackendToUi,
  formatDueDate,
  taskItemToBackendUpdateInput,
} from "@/lib/adapters";
import { getListTasks } from "@/lib/data/queries/list";
import { dexieRowsToTaskItems } from "@/lib/data/adapters";
import type { TaskItem, ListId, FolderId, Priority, ViewMode, HierarchicalSubtask } from "./types";

const PHASE4_VIEWS = new Set(["overdue", "priority", "no-date", "all"]);

// Phase 5 cutover 6c: offline-first task writes via lib/data/mutate (Dexie +
// outbox, position auto-appended on create). REST remains the fallback when
// there is no userId or Dexie throws (e.g. no IndexedDB). Helpers below
// resolve with the REST result on fallback, or with null when the local
// write was accepted (callers then skip server-echo reconciliation; the
// sync pull brings server truth back).
async function persistTaskComplete(
  userId: string | null,
  id: string,
  completeSubtasks = false
): Promise<TaskCompletionResult | null> {
  if (!userId) return completeTask(id, completeSubtasks ? true : undefined);
  try {
    await mutate(userId, {
      entity: "tasks",
      op: "complete",
      entityId: id,
      patch: completeSubtasks ? { completeSubtasks: true } : {},
    });
    return null;
  } catch {
    return completeTask(id, completeSubtasks ? true : undefined);
  }
}

// Phase 3 premium Day 5: Undo-hold window for repeating-task completion.
// The row looks done immediately, but the complete mutation only fires when
// this window expires. Undo inside the window cancels the timer, so the
// backend never sees the completion and no duplicate spawns.
const REPEAT_HOLD_MS = 8000;

// Count open (incomplete) subtasks recursively through the hierarchy tree.
function countOpenSubtasks(subtasks: HierarchicalSubtask[]): number {
  let count = 0;
  for (const s of subtasks) {
    if (!s.completed) count += 1;
    if (s.subtasks && s.subtasks.length > 0) {
      count += countOpenSubtasks(s.subtasks);
    }
  }
  return count;
}

// Optimistically mark a subtask tree done (used when completing with subtasks).
function markSubtasksDone(subtasks: HierarchicalSubtask[]): HierarchicalSubtask[] {
  return subtasks.map((s) => ({
    ...s,
    completed: true,
    subtasks: s.subtasks ? markSubtasksDone(s.subtasks) : [],
  }));
}

async function persistTaskReopen(
  userId: string | null,
  id: string
): Promise<BackendTask | null> {
  if (!userId) return reopenTask(id);
  try {
    await mutate(userId, {
      entity: "tasks",
      op: "update",
      entityId: id,
      patch: { status: "todo", completedAt: null },
    });
    return null;
  } catch {
    return reopenTask(id);
  }
}

// Phase 5 follow-up: offline-first bulk writes. Each bulk action expands
// into sequential per-task mutate() ops (sequential keeps position moves
// ordered). If any mutate throws, the whole batch falls back to the
// existing transactional bulk REST endpoint.
async function persistBulk(
  userId: string | null,
  ids: string[],
  mutateOne: (uid: string, id: string) => Promise<unknown>,
  restFallback: () => Promise<unknown>
): Promise<void> {
  if (!userId) {
    await restFallback();
    return;
  }
  try {
    for (const id of ids) {
      await mutateOne(userId, id);
    }
  } catch {
    await restFallback();
  }
}

const INITIAL_WORKSPACE_TASKS: TaskItem[] = [
  {
    id: "task-1",
    title: "Verify ElysiaJS cryptographic invite token verification contract",
    description: "Ensure constant-time comparison on invite hash validation to prevent timing side channels.",
    notes: "# Cryptographic Verification Specs\n\nEnsure constant-time comparison on invite hash validation to prevent timing side channels.\n\n- [x] Strict length pre-check\n- [ ] Constant-time XOR accumulator",
    completed: true,
    priority: "high",
    list: "today",
    folder: "engineering",
    tags: ["security", "elysia"],
    dueDate: "Today",
    subtasks: [
      {
        id: "st-1",
        title: "Write constant-time string comparator",
        completed: true,
        depth: 2,
        priority: "high",
        subtasks: [
          {
            id: "st-1-1",
            title: "Validate buffer boundary checks",
            completed: true,
            depth: 3,
            priority: "med",
            subtasks: [],
          },
        ],
      },
      {
        id: "st-2",
        title: "Add test cases with valid/expired codes",
        completed: true,
        depth: 2,
        priority: "med",
        subtasks: [],
      },
    ],
    checklist: [
      { id: "cl-1", text: "Bench constant-time comp against naive string equals", done: true },
      { id: "cl-2", text: "Validate against token forgery payloads", done: false },
    ],
    createdAt: "9:00 AM",
    updatedAt: "Just now",
  },
  {
    id: "task-2",
    title: "Implement tactile 3D split-border depth on primary buttons",
    description: "Align with light model: top border lightest, side borders neutral, bottom border grounded shadow.",
    notes: "### Button Physics\n\n- Base gradient 8-12% lightness drop\n- Active state 1px down shift + inset shadow",
    completed: true,
    priority: "med",
    list: "today",
    folder: "design",
    tags: ["ui-tokens", "tailwind"],
    dueDate: "Today",
    subtasks: [
      {
        id: "st-3",
        title: "Audit buttons against 8-12% lightness gradient",
        completed: true,
        depth: 2,
        priority: "med",
        subtasks: [],
      },
      {
        id: "st-4",
        title: "Ensure active/pressed inset depth shift",
        completed: true,
        depth: 2,
        priority: "low",
        subtasks: [],
      },
    ],
    checklist: [
      { id: "cl-3", text: "Inspect button pressed state in dark mode", done: true },
      { id: "cl-4", text: "Test on mobile touchscreen", done: true },
    ],
    createdAt: "10:30 AM",
    updatedAt: "10:45 AM",
  },
  {
    id: "task-3",
    title: "Configure Cmd+K accessible command palette dialog",
    description: "Fuzzy navigation between lists, folders, theme toggle, and keyboard shortcuts.",
    notes: "Dialog should trap focus cleanly and support ArrowUp / ArrowDown cycling.",
    completed: false,
    priority: "high",
    list: "today",
    folder: "engineering",
    tags: ["keyboard", "a11y"],
    dueDate: "Today",
    subtasks: [
      {
        id: "st-5",
        title: "Trap keyboard focus inside modal",
        completed: true,
        depth: 2,
        priority: "high",
        subtasks: [
          {
            id: "st-5-1",
            title: "Verify tab-loop barrier at dialog edges",
            completed: true,
            depth: 3,
            priority: "high",
            subtasks: [],
          },
        ],
      },
      {
        id: "st-6",
        title: "Add ArrowUp / ArrowDown navigation",
        completed: true,
        depth: 2,
        priority: "med",
        subtasks: [],
      },
      {
        id: "st-7",
        title: "Handle Escape key dismiss",
        completed: true,
        depth: 2,
        priority: "low",
        subtasks: [],
      },
    ],
    checklist: [
      { id: "cl-5", text: "Test Screen Reader aria-modal announcing", done: true },
      { id: "cl-6", text: "Add fuzzy match scoring threshold", done: false },
    ],
    createdAt: "11:15 AM",
    updatedAt: "11:15 AM",
  },
  {
    id: "task-4",
    title: "Benchmark Sub-millisecond ElysiaJS JSON throughput",
    description: "Confirm P99 latency remains below 1.2ms on local Bun runtime under concurrency.",
    notes: null,
    completed: false,
    priority: "med",
    list: "upcoming",
    folder: "engineering",
    tags: ["perf", "bun"],
    dueDate: "Tomorrow",
    subtasks: [
      {
        id: "st-8",
        title: "Configure autocannon test runner",
        completed: false,
        depth: 2,
        priority: "med",
        subtasks: [],
      },
    ],
    checklist: [
      { id: "cl-7", text: "Warm up JIT compiler before recording metrics", done: false },
    ],
    createdAt: "Yesterday",
    updatedAt: "Yesterday",
  },
  {
    id: "task-5",
    title: "Refine Bubblegum Pink accent glow behind product mockup",
    description: "Restrain opacity to 5-10% budget; avoid high-saturation neon spill onto body copy.",
    notes: null,
    completed: false,
    priority: "low",
    list: "upcoming",
    folder: "design",
    tags: ["design-tokens", "visual"],
    dueDate: "Friday",
    subtasks: [],
    checklist: [],
    createdAt: "2 days ago",
    updatedAt: "2 days ago",
  },
  {
    id: "task-6",
    title: "Review personal engineering logs & workflow optimization notes",
    description: "Write summary report on Bun + Next.js App Router pairing efficiency.",
    notes: null,
    completed: false,
    priority: "low",
    list: "backlog",
    folder: "personal",
    tags: ["notes", "review"],
    dueDate: "Next week",
    subtasks: [],
    checklist: [],
    createdAt: "3 days ago",
    updatedAt: "3 days ago",
  },
  {
    id: "task-7",
    title: "Initial Next.js 16 monorepo architecture scaffolding",
    description: "Completed project bootstrap with Bun workspace packages.",
    notes: null,
    completed: true,
    priority: "high",
    list: "completed",
    folder: "engineering",
    tags: ["arch", "scaffold"],
    dueDate: "Completed",
    subtasks: [],
    checklist: [],
    createdAt: "Sprint 0",
    updatedAt: "Sprint 0",
  },
];

interface AppWorkspaceInnerProps {
  onOpenAuth?: () => void;
  onToggleTheme: () => void;
  onOpenShortcuts?: () => void;
}

function AppWorkspaceInner({ onOpenAuth, onToggleTheme, onOpenShortcuts: externalOpenShortcuts }: AppWorkspaceInnerProps) {
  const { toast, success } = useToast();
  const auth = useAuth();
  const { isAuthenticated, user } = auth;
  const userId = user?.id ?? null;

  const [tasks, setTasks] = useState<TaskItem[]>(INITIAL_WORKSPACE_TASKS);
  const [userLists, setUserLists] = useState<BackendList[]>([]);
  const [userFolders, setUserFolders] = useState<BackendFolder[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [viewCounts, setViewCounts] = useState<BackendViewCountsResponse | null>(null);
  const [viewCursor, setViewCursor] = useState<string | null>(null);
  const [viewHasMore, setViewHasMore] = useState(false);
  const [isLoadingView, setIsLoadingView] = useState(false);
  const [selectedListOverride, setSelectedListOverride] = useState<ListId | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const [calendarItems, setCalendarItems] = useState<
    import("@/lib/api").BackendCalendarItem[]
  >([]);
  const [isLoadingCalendar, setIsLoadingCalendar] = useState(false);
  const [includeDone, setIncludeDone] = useState(false);

  // Board state
  const [boardData, setBoardData] = useState<import("@/lib/api").BackendBoardResponse | null>(null);
  const [isLoadingBoard, setIsLoadingBoard] = useState(false);
  const [boardGroupBy, setBoardGroupBy] = useState<string>("section");

  // Modals state for Lists & Folders
  const [isListDialogOpen, setIsListDialogOpen] = useState(false);
  const [listDialogMode, setListDialogMode] = useState<"create" | "edit">("create");
  const [listToEdit, setListToEdit] = useState<BackendList | null>(null);
  const [listDialogFolderId, setListDialogFolderId] = useState<string | null>(null);

  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<"create" | "edit">("create");
  const [folderToEdit, setFolderToEdit] = useState<BackendFolder | null>(null);

  // Saved filters state
  const [savedFilters, setSavedFilters] = useState<BackendSavedFilter[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(null);
  const [filterTasks, setFilterTasks] = useState<TaskItem[]>([]);
  const [filterCursor, setFilterCursor] = useState<string | null>(null);
  const [filterHasMore, setFilterHasMore] = useState(false);
  const [isLoadingFilter, setIsLoadingFilter] = useState(false);
  const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false);
  const [filterDialogMode, setFilterDialogMode] = useState<"create" | "edit">("create");
  const [filterToEdit, setFilterToEdit] = useState<BackendSavedFilter | null>(null);

  const prefList = auth?.profile?.preferences?.defaultListId as ListId | undefined;
  const effectiveDefaultList: ListId =
    prefList && ["today", "upcoming", "backlog", "completed"].includes(prefList)
      ? prefList
      : "today";
  const activeList = selectedListOverride ?? effectiveDefaultList;
  const setActiveList = useCallback((list: ListId) => {
    setSelectedListOverride(list);
  }, []);

  const [activeFolder, setActiveFolder] = useState<FolderId | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>("task-3");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

  // Bulk Selection State
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  // Complete-with-open-subtasks confirm state (asked once per toggle action)
  const [pendingSubtasksComplete, setPendingSubtasksComplete] = useState<{
    id: string;
    openCount: number;
  } | null>(null);

  // Pending Undo-hold timers for repeating-task completion (Day 5).
  // Keyed by task id so Undo (or a reopen) can cancel the held mutation.
  const pendingRepeatTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // Drop held timers on unmount — a held mutation must never fire after the
  // workspace is gone.
  useEffect(() => {
    const timers = pendingRepeatTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Library Modals State
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const [isTagsOpen, setIsTagsOpen] = useState(false);

  // Tags state: workspace-owned list (REST), tag-filtered view, and
  // Dexie-first per-tag open-task counts for the sidebar + tags modal.
  const [userTags, setUserTags] = useState<BackendTag[]>([]);
  const [activeTag, setActiveTag] = useState<BackendTag | null>(null);
  const [tagTasks, setTagTasks] = useState<TaskItem[]>([]);
  const [tagCursor, setTagCursor] = useState<string | null>(null);
  const [tagHasMore, setTagHasMore] = useState(false);
  const [isLoadingTag, setIsLoadingTag] = useState(false);

  // Streak State
  const [streakCount, setStreakCount] = useState(5);
  const [isStreakActive, setIsStreakActive] = useState(false);
  const [streakTaskTitle, setStreakTaskTitle] = useState("");

  // Calendar fetch
  useEffect(() => {
    if (viewMode !== "calendar") return;
    if (!isAuthenticated) return;
    let cancelled = false;
    const run = async () => {
      setIsLoadingCalendar(true);
      try {
        const year = calendarMonth.getFullYear();
        const monthIndex = calendarMonth.getMonth();
        const first = new Date(year, monthIndex, 1);
        const last = new Date(year, monthIndex + 1, 0);
        const from = first.toISOString().slice(0, 10);
        const to = last.toISOString().slice(0, 10);
        const res = await getCalendar({ from, to, include_done: includeDone });
        if (!cancelled) setCalendarItems(res.items ?? []);
      } catch (err) {
        console.error("Failed to load calendar:", err);
        if (!cancelled) setCalendarItems([]);
      } finally {
        if (!cancelled) setIsLoadingCalendar(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [viewMode, isAuthenticated, calendarMonth, includeDone]);

  // Board fetch
  useEffect(() => {
    if (viewMode !== "board") return;
    if (!isAuthenticated) return;
    let cancelled = false;
    const run = async () => {
      setIsLoadingBoard(true);
      try {
        const res = await getBoard({ list_id: activeListId || undefined, group_by: boardGroupBy });
        if (!cancelled) setBoardData(res);
      } catch (err) {
        console.error("Failed to load board:", err);
        if (!cancelled) setBoardData(null);
      } finally {
        if (!cancelled) setIsLoadingBoard(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [viewMode, isAuthenticated, activeListId, boardGroupBy]);

  // Container CRUD handlers
  const handleCreateList = useCallback((folderId?: string | null) => {
    setListDialogMode("create");
    setListToEdit(null);
    setListDialogFolderId(folderId ?? null);
    setIsListDialogOpen(true);
  }, []);

  const handleEditList = useCallback((list: BackendList) => {
    setListDialogMode("edit");
    setListToEdit(list);
    setListDialogFolderId(list.folderId ?? null);
    setIsListDialogOpen(true);
  }, []);

  const handleArchiveList = useCallback(
    async (list: BackendList) => {
      try {
        await archiveList(list.id);
        setUserLists((prev) => prev.filter((l) => l.id !== list.id));
        if (activeListId === list.id) {
          const inbox = userLists.find((l) => l.isInbox);
          setActiveListId(inbox?.id ?? null);
        }
        success(`Archived list "${list.name}"`);
      } catch (err) {
        console.error("Failed to archive list:", err);
        toast({
          title: "Archive failed",
          message: err instanceof Error ? err.message : "Could not archive list",
          type: "error",
        });
      }
    },
    [activeListId, userLists, success, toast]
  );

  const handleDeleteList = useCallback(
    async (list: BackendList) => {
      try {
        await deleteList(list.id);
        setUserLists((prev) => prev.filter((l) => l.id !== list.id));
        if (activeListId === list.id) {
          const inbox = userLists.find((l) => l.isInbox);
          setActiveListId(inbox?.id ?? null);
        }
        success(`Deleted list "${list.name}"`);
      } catch (err) {
        console.error("Failed to delete list:", err);
        toast({
          title: "Delete failed",
          message: err instanceof Error ? err.message : "Could not delete list",
          type: "error",
        });
      }
    },
    [activeListId, userLists, success, toast]
  );

  const handleListSuccess = useCallback(
    (savedList: BackendList) => {
      if (listDialogMode === "edit") {
        setUserLists((prev) =>
          prev.map((l) => (l.id === savedList.id ? savedList : l))
        );
        success(`Updated list "${savedList.name}"`);
      } else {
        setUserLists((prev) => [...prev, savedList]);
        setActiveListId(savedList.id);
        setSelectedListOverride(null);
        success(`Created list "${savedList.name}"`);
      }
    },
    [listDialogMode, success]
  );

  const handleCreateFolder = useCallback(() => {
    setFolderDialogMode("create");
    setFolderToEdit(null);
    setIsFolderDialogOpen(true);
  }, []);

  const handleEditFolder = useCallback((folder: BackendFolder) => {
    setFolderDialogMode("edit");
    setFolderToEdit(folder);
    setIsFolderDialogOpen(true);
  }, []);

  const handleDeleteFolder = useCallback(
    async (folder: BackendFolder) => {
      try {
        await deleteFolder(folder.id);
        setUserFolders((prev) => prev.filter((f) => f.id !== folder.id));
        setUserLists((prev) =>
          prev.map((l) => (l.folderId === folder.id ? { ...l, folderId: null } : l))
        );
        if (activeFolder === folder.id) {
          setActiveFolder(null);
        }
        success(`Deleted folder "${folder.name}"`);
      } catch (err) {
        console.error("Failed to delete folder:", err);
        toast({
          title: "Delete failed",
          message: err instanceof Error ? err.message : "Could not delete folder",
          type: "error",
        });
      }
    },
    [activeFolder, success, toast]
  );

  const handleFolderSuccess = useCallback(
    (savedFolder: BackendFolder) => {
      if (folderDialogMode === "edit") {
        setUserFolders((prev) =>
          prev.map((f) => (f.id === savedFolder.id ? savedFolder : f))
        );
        success(`Updated folder "${savedFolder.name}"`);
      } else {
        setUserFolders((prev) => [...prev, savedFolder]);
        success(`Created folder "${savedFolder.name}"`);
      }
    },
    [folderDialogMode, success]
  );

  // Fetch user's lists and folders when authenticated
  const loadContainers = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const [lists, folders] = await Promise.all([
        getLists(),
        getFolders(),
      ]);

      setUserLists(lists);
      setUserFolders(folders);

      // Automatically pick the default Inbox list (or first active list) if no list is selected
      const inbox = lists.find((l) => l.isInbox) || lists[0];
      if (inbox) {
        setActiveListId((prev) => prev || inbox.id);
      }
    } catch (err) {
      console.error("Failed to load containers:", err);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    getFilters()
      .then((res) => {
        if (!isMounted) return;
        setSavedFilters(res);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load filters:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;

    Promise.all([getLists(), getFolders()])
      .then(([lists, folders]) => {
        if (!isMounted) return;
        setUserLists(lists);
        setUserFolders(folders);
        const inbox = lists.find((l) => l.isInbox) || lists[0];
        if (inbox) {
          setActiveListId((prev) => prev || inbox.id);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load containers:", err);
      });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  // Fetch tags for the sidebar section + tags modal (REST-owned list).
  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    getTags()
      .then((res) => {
        if (isMounted) setUserTags(res);
      })
      .catch((err) => {
        if (isMounted) console.error("Failed to load tags:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  const reloadTags = useCallback(async () => {
    try {
      const res = await getTags();
      setUserTags(res);
    } catch (err) {
      console.error("Failed to reload tags:", err);
    }
  }, []);

  // Dexie-first per-tag open-task counts (alive, unarchived, not done).
  // Degrades to {} when there is no userId or Dexie throws.
  const tagCounts = useLiveQuery(async () => {
    const counts: Record<string, number> = {};
    if (!userId) return counts;
    try {
      const rows = await getDB(userId).tasks.toArray();
      for (const r of rows) {
        if (r["deleted"] === 1 || r["deletedAt"] != null) continue;
        if (r["archivedAt"] != null) continue;
        const status = r["status"];
        if (status === "done" || status === "cancelled") continue;
        const ids = (r["tagIds"] as string[] | undefined) ?? [];
        for (const id of ids) counts[id] = (counts[id] ?? 0) + 1;
      }
    } catch {
      return {};
    }
    return counts;
  }, [userId]) ?? {};

  // Fetch smart view counts
  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    getViewsCounts()
      .then((res) => {
        if (isMounted) setViewCounts(res);
      })
      .catch((err) => {
        if (isMounted) console.error("Failed to load view counts:", err);
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, tasks.length]);

  // Fetch tasks for active list or active smart view
  const loadTasks = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const queryParams: { listId?: string; include: string } = {
        include: "subtasks,checklist,tags",
      };
      if (activeListId) {
        queryParams.listId = activeListId;
      }
      const res = await getTasks(queryParams);
      const mapped = res.items.map((t) => backendTaskToTaskItem(t));
      setTasks(mapped);
      if (mapped.length > 0) {
        setSelectedTaskId((prev) =>
          prev && mapped.some((t) => t.id === prev) ? prev : mapped[0].id
        );
      } else {
        setSelectedTaskId(null);
      }
    } catch (err) {
      console.error("Failed to load tasks:", err);
      toast({
        title: "Failed to load tasks",
        message: err instanceof Error ? err.message : "Network error",
        type: "error",
      });
    }
  }, [isAuthenticated, activeListId, toast]);

  // Load items for Phase 4 smart views via getViewItems
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!PHASE4_VIEWS.has(activeList)) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingView(true);
    getViewItems(activeList, { limit: 50 })
      .then((res) => {
        if (!isMounted) return;
        const mapped = res.items.map((t) =>
          backendTaskToTaskItem(t as BackendTask, { listOverride: activeList as ListId })
        );
        setTasks(mapped);
        setViewCursor(res.nextCursor);
        setViewHasMore(res.hasMore);
        setIsLoadingView(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load view items:", err);
        setIsLoadingView(false);
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, activeList]);

  // Reload all tasks when leaving a Phase 4 view to a normal smart view
  useEffect(() => {
    if (!isAuthenticated) return;
    if (PHASE4_VIEWS.has(activeList)) return;
    if (activeListId !== null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks();
  }, [isAuthenticated, activeList, activeListId, loadTasks]);

  // Dexie-first list read (Phase 5 cutover 6b): when the per-user local DB
  // already holds rows for this list, render from Dexie and skip REST.
  // Empty local store (pre-first-sync) or any Dexie error falls back to the
  // intact REST path below. Writes stay on REST (untouched).
  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;

    const queryParams: { listId?: string; include: string } = {
      include: "subtasks,checklist,tags",
    };
    if (activeListId) {
      queryParams.listId = activeListId;
    }

    const applyItems = (mapped: TaskItem[]) => {
      if (!isMounted) return;
      setTasks(mapped);
      if (mapped.length > 0) {
        setSelectedTaskId((prev) =>
          prev && mapped.some((t) => t.id === prev) ? prev : mapped[0].id
        );
      } else {
        setSelectedTaskId(null);
      }
      setIsLoadingTasks(false);
    };

    const loadViaRest = () => {
      getTasks(queryParams)
        .then((res) => {
          if (!isMounted) return;
          applyItems(res.items.map((t) => backendTaskToTaskItem(t)));
        })
        .catch((err) => {
          if (!isMounted) return;
          console.error("Failed to load tasks:", err);
          toast({
            title: "Failed to load tasks",
            message: err instanceof Error ? err.message : "Network error",
            type: "error",
          });
          setIsLoadingTasks(false);
        });
    };

    const run = async () => {
      if (userId && activeListId) {
        try {
          const local = await getListTasks(userId, activeListId);
          if (!isMounted) return;
          if (local.length > 0) {
            applyItems(await dexieRowsToTaskItems(userId, local));
            return;
          }
          // No local rows yet (pre-first-sync): fall through to REST.
        } catch (err) {
          console.error("Dexie list read failed, falling back to REST:", err);
        }
        if (!isMounted) return;
      }
      loadViaRest();
    };

    void run();

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, activeListId, userId, toast]);

  // Remote-change refresh: sync pulls write to Dexie, but `tasks` is React
  // state loaded one-shot above — without this, rows created or edited on
  // another device would never render here. Collapses pull bursts (first
  // sync notifies per row) into one trailing reload.
  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeRemoteChanged((detail) => {
      if (
        detail.entity !== "tasks" &&
        detail.entity !== "sections" &&
        detail.entity !== "checklistItems"
      ) {
        return;
      }
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        if (!activeListId) return;
        getListTasks(userId, activeListId)
          .then((local) => dexieRowsToTaskItems(userId, local))
          .then((mapped) => {
            setTasks(mapped);
            setSelectedTaskId((prev) =>
              prev && mapped.some((t) => t.id === prev)
                ? prev
                : mapped[0]?.id ?? null
            );
          })
          .catch((err) => {
            console.error("Remote-change reload failed:", err);
          });
      }, 500);
    });
    return () => {
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    };
  }, [isAuthenticated, userId, activeListId]);

  // Bulk Selection Handlers
  const handleToggleSelectTask = useCallback(
    (id: string, shiftKey?: boolean, visibleTaskIds?: string[]) => {
      setSelectedTaskIds((prev) => {
        const next = new Set(prev);
        if (shiftKey && visibleTaskIds && visibleTaskIds.length > 0) {
          const lastId = Array.from(prev).pop();
          if (lastId && lastId !== id) {
            const startIdx = visibleTaskIds.indexOf(lastId);
            const endIdx = visibleTaskIds.indexOf(id);
            if (startIdx !== -1 && endIdx !== -1) {
              const low = Math.min(startIdx, endIdx);
              const high = Math.max(startIdx, endIdx);
              for (let i = low; i <= high; i++) {
                next.add(visibleTaskIds[i]);
              }
              return next;
            }
          }
        }

        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    []
  );

  const handleSelectAllTasks = useCallback(() => {
    setSelectedTaskIds(new Set(tasks.map((t) => t.id)));
  }, [tasks]);

  const handleClearTaskSelection = useCallback(() => {
    setSelectedTaskIds(new Set());
  }, []);

  // Bulk Actions
  const handleBulkComplete = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    setIsBulkSubmitting(true);
    try {
      if (isAuthenticated) {
        await persistBulk(
          userId,
          ids,
          (uid, id) =>
            mutate(uid, {
              entity: "tasks",
              op: "complete",
              entityId: id,
              patch: { completeSubtasks: true },
            }),
          () => bulkTasks(ids, "complete", { completeSubtasks: true })
        );
      }
      setTasks((prev) =>
        prev.map((t) => (ids.includes(t.id) ? { ...t, completed: true } : t))
      );
      success(`Completed ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`);
      setSelectedTaskIds(new Set());
    } catch (err) {
      console.error("Bulk complete failed:", err);
      toast({
        title: "Action failed",
        message: err instanceof Error ? err.message : "Failed to complete tasks",
        type: "error",
      });
    } finally {
      setIsBulkSubmitting(false);
    }
  }, [isAuthenticated, selectedTaskIds, success, toast, userId]);

  const handleBulkReopen = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    setIsBulkSubmitting(true);
    try {
      if (isAuthenticated) {
        await persistBulk(
          userId,
          ids,
          (uid, id) =>
            mutate(uid, {
              entity: "tasks",
              op: "update",
              entityId: id,
              patch: { status: "todo", completedAt: null },
            }),
          () => bulkTasks(ids, "reopen")
        );
      }
      setTasks((prev) =>
        prev.map((t) => (ids.includes(t.id) ? { ...t, completed: false } : t))
      );
      success(`Reopened ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`);
      setSelectedTaskIds(new Set());
    } catch (err) {
      console.error("Bulk reopen failed:", err);
      toast({
        title: "Action failed",
        message: err instanceof Error ? err.message : "Failed to reopen tasks",
        type: "error",
      });
    } finally {
      setIsBulkSubmitting(false);
    }
  }, [isAuthenticated, selectedTaskIds, success, toast, userId]);

  const handleBulkMove = useCallback(
    async (targetListId: string) => {
      if (selectedTaskIds.size === 0) return;
      const ids = Array.from(selectedTaskIds);
      const targetList = userLists.find((l) => l.id === targetListId);
      setIsBulkSubmitting(true);
      try {
        if (isAuthenticated) {
          await persistBulk(
            userId,
            ids,
            (uid, id) =>
              mutate(uid, {
                entity: "tasks",
                op: "move",
                entityId: id,
                patch: { listId: targetListId },
              }),
            () => bulkTasks(ids, "move", { listId: targetListId })
          );
        }
        setTasks((prev) =>
          prev.map((t) => (ids.includes(t.id) ? { ...t, listId: targetListId } : t))
        );
        success(
          `Moved ${ids.length} ${ids.length === 1 ? "task" : "tasks"} to ${targetList?.name || "list"}`
        );
        setSelectedTaskIds(new Set());
      } catch (err) {
        console.error("Bulk move failed:", err);
        toast({
          title: "Action failed",
          message: err instanceof Error ? err.message : "Failed to move tasks",
          type: "error",
        });
      } finally {
        setIsBulkSubmitting(false);
      }
    },
    [isAuthenticated, selectedTaskIds, userLists, success, toast, userId]
  );

  const handleBulkSetPriority = useCallback(
    async (priority: number) => {
      if (selectedTaskIds.size === 0) return;
      const ids = Array.from(selectedTaskIds);
      const priorityMap: Record<number, Priority> = {
        4: "high",
        3: "high",
        2: "med",
        1: "low",
        0: "low",
      };
      const uiPriority = priorityMap[priority] || "med";
      setIsBulkSubmitting(true);
      try {
        if (isAuthenticated) {
          await persistBulk(
            userId,
            ids,
            (uid, id) =>
              mutate(uid, {
                entity: "tasks",
                op: "update",
                entityId: id,
                patch: { priority },
              }),
            () => bulkTasks(ids, "set_priority", { priority })
          );
        }
        setTasks((prev) =>
          prev.map((t) => (ids.includes(t.id) ? { ...t, priority: uiPriority } : t))
        );
        success(
          `Updated priority for ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`
        );
        setSelectedTaskIds(new Set());
      } catch (err) {
        console.error("Bulk priority update failed:", err);
        toast({
          title: "Action failed",
          message: err instanceof Error ? err.message : "Failed to update priority",
          type: "error",
        });
      } finally {
        setIsBulkSubmitting(false);
      }
    },
    [isAuthenticated, selectedTaskIds, success, toast, userId]
  );

  const handleBulkArchive = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    setIsBulkSubmitting(true);
    try {
      if (isAuthenticated) {
        await persistBulk(
          userId,
          ids,
          (uid, id) =>
            mutate(uid, {
              entity: "tasks",
              op: "update",
              entityId: id,
              patch: { archivedAt: Date.now() },
            }),
          () => bulkTasks(ids, "archive")
        );
      }
      setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
      if (selectedTaskId && ids.includes(selectedTaskId)) {
        setSelectedTaskId(null);
      }
      success(`Archived ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`);
      setSelectedTaskIds(new Set());
    } catch (err) {
      console.error("Bulk archive failed:", err);
      toast({
        title: "Action failed",
        message: err instanceof Error ? err.message : "Failed to archive tasks",
        type: "error",
      });
    } finally {
      setIsBulkSubmitting(false);
    }
  }, [isAuthenticated, selectedTaskId, selectedTaskIds, success, toast, userId]);

  const handleBulkDelete = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    const deletedTasks = tasks.filter((t) => ids.includes(t.id));

    // Optimistic removal
    setTasks((prev) => prev.filter((t) => !ids.includes(t.id)));
    if (selectedTaskId && ids.includes(selectedTaskId)) {
      setSelectedTaskId(null);
    }
    setSelectedTaskIds(new Set());

    try {
      if (isAuthenticated) {
        await persistBulk(
          userId,
          ids,
          (uid, id) => mutate(uid, { entity: "tasks", op: "delete", entityId: id }),
          () => bulkTasks(ids, "delete")
        );
      }

      toast({
        title: "Deleted",
        message: `Moved ${ids.length} ${ids.length === 1 ? "task" : "tasks"} to Trash`,
        actionLabel: "Undo",
        onAction: async () => {
          try {
            if (isAuthenticated) {
              // Offline-first restore (mutate op) with REST fallback.
              // Local-only ids never left the device, so they stay REST.
              await Promise.all(
                ids.map((id) =>
                  userId && !id.startsWith("temp-") && !id.startsWith("task-")
                    ? restoreFromTrash(userId, "tasks", id).catch(() =>
                        restoreTrash("task", id)
                      )
                    : restoreTrash("task", id)
                )
              );
            }
            setTasks((prev) => [...deletedTasks, ...prev]);
            success(`Restored ${ids.length} ${ids.length === 1 ? "task" : "tasks"}`);
          } catch (err) {
            console.error("Failed to restore tasks:", err);
            toast({
              title: "Restore failed",
              message: "Could not restore tasks from trash",
              type: "error",
            });
          }
        },
        durationMs: 6000,
      });
    } catch (err) {
      console.error("Bulk delete failed:", err);
      setTasks((prev) => [...deletedTasks, ...prev]);
      toast({
        title: "Delete failed",
        message: err instanceof Error ? err.message : "Failed to delete tasks",
        type: "error",
      });
    }
  }, [isAuthenticated, selectedTaskId, selectedTaskIds, tasks, success, toast, userId]);

  // Trash & Template callback handlers
  const handleItemRestored = useCallback(
    (type: "task" | "list" | "folder" | "section") => {
      success(`Restored ${type} from trash`);
      if (type === "task") {
        void loadTasks();
      } else {
        void loadContainers();
      }
    },
    [loadTasks, loadContainers, success]
  );

  const handleTemplateInstantiated = useCallback(
    (newTask: BackendTask) => {
      const mapped = backendTaskToTaskItem(newTask);
      setTasks((prev) => [mapped, ...prev]);
      setSelectedTaskId(mapped.id);
      success("Template instantiated into list!");
    },
    [success]
  );

  const handleNewFilter = useCallback(() => {
    setFilterDialogMode("create");
    setFilterToEdit(null);
    setIsFilterDialogOpen(true);
  }, []);

  const handleEditFilter = useCallback(
    (id: string) => {
      const f = savedFilters.find((x) => x.id === id) || null;
      setFilterDialogMode("edit");
      setFilterToEdit(f);
      setIsFilterDialogOpen(true);
    },
    [savedFilters]
  );

  const handleDeleteFilter = useCallback(
    async (id: string) => {
      try {
        await deleteFilter(id);
        setSavedFilters((prev) => prev.filter((f) => f.id !== id));
        if (activeFilterId === id) {
          setActiveFilterId(null);
          setFilterTasks([]);
        }
        success("Deleted filter");
      } catch (err) {
        console.error("Failed to delete filter:", err);
        toast({
          title: "Delete failed",
          message: err instanceof Error ? err.message : "Could not delete filter",
          type: "error",
        });
      }
    },
    [activeFilterId, success, toast]
  );

  // Single-task move from the detail panel (mirrors handleBulkMove for one
  // task, plus an optional section). Offline-first mutate with REST fallback.
  const handleMovePanelTask = useCallback(
    async (taskId: string, listId: string, sectionId: string | null) => {
      const targetList = userLists.find((l) => l.id === listId);
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, listId, sectionId, updatedAt: "Just now" } : t
        )
      );
      if (isAuthenticated && !taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        const patch = { listId, sectionId };
        const doRestMove = () => moveTask(taskId, patch);
        try {
          if (userId) {
            await mutate(userId, { entity: "tasks", op: "move", entityId: taskId, patch });
          } else {
            await doRestMove();
          }
          success(`Moved to ${targetList?.name || "list"}`);
        } catch (err) {
          console.error("Failed to move task:", err);
          try {
            await doRestMove();
            success(`Moved to ${targetList?.name || "list"}`);
          } catch (restErr) {
            console.error("Failed to move task on backend:", restErr);
            toast({
              title: "Move failed",
              message: restErr instanceof Error ? restErr.message : "Could not move task",
              type: "error",
            });
          }
        }
      }
    },
    [isAuthenticated, userLists, userId, success, toast]
  );

  // Drag-reorder drop from the task pane (dnd-kit). Optimistic splice in both
  // the main list and the filter list (whichever holds the task), then an
  // offline-first mutate "move" with afterId/beforeId — the server recomputes
  // position authoritatively and repairs collisions. REST is the fallback.
  // sectionId undefined = same-section reorder; null = move to unsectioned.
  const handleReorderTask = useCallback(
    async (
      taskId: string,
      target: { sectionId: string | null | undefined; afterId: string | null; beforeId: string | null }
    ) => {
      const spliceInto = (prev: TaskItem[]): TaskItem[] => {
        const from = prev.findIndex((t) => t.id === taskId);
        if (from < 0) return prev;
        const moving = prev[from];
        const moved: TaskItem = {
          ...moving,
          ...(target.sectionId !== undefined ? { sectionId: target.sectionId } : null),
          updatedAt: "Just now",
        };
        const without = prev.filter((t) => t.id !== taskId);
        let at: number;
        if (target.beforeId) {
          const i = without.findIndex((t) => t.id === target.beforeId);
          at = i < 0 ? without.length : i;
        } else if (target.afterId) {
          const i = without.findIndex((t) => t.id === target.afterId);
          at = i < 0 ? without.length : i + 1;
        } else {
          // Sole-member scope (e.g. dropped into an empty section): keep the
          // row where the grouping puts it; the move still persists sectionId.
          at = from < without.length ? from : without.length;
        }
        return [...without.slice(0, at), moved, ...without.slice(at)];
      };
      setTasks(spliceInto);
      setFilterTasks(spliceInto);
      if (isAuthenticated && !taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        const patch: Record<string, unknown> = {
          afterId: target.afterId,
          beforeId: target.beforeId,
        };
        if (target.sectionId !== undefined) patch["sectionId"] = target.sectionId;
        const doRestMove = () => moveTask(taskId, patch);
        try {
          if (userId) {
            await mutate(userId, { entity: "tasks", op: "move", entityId: taskId, patch });
          } else {
            await doRestMove();
          }
        } catch (err) {
          console.error("Failed to reorder task:", err);
          try {
            await doRestMove();
          } catch (restErr) {
            console.error("Failed to reorder task on backend:", restErr);
            toast({
              title: "Move failed",
              message: restErr instanceof Error ? restErr.message : "Could not move task",
              type: "error",
            });
          }
        }
      }
    },
    [isAuthenticated, userId, toast]
  );

  const handleMoveFilter = useCallback(
    async (id: string, dir: "up" | "down") => {
      const idx = savedFilters.findIndex((f) => f.id === id);
      if (idx < 0) return;
      const targetIdx = dir === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= savedFilters.length) return;
      const other = savedFilters[targetIdx];
      try {
        // move after/before
        if (dir === "up") {
          await moveFilter(id, { beforeId: other.id });
        } else {
          await moveFilter(id, { afterId: other.id });
        }
        // reload
        const res = await getFilters();
        setSavedFilters(res);
      } catch (err) {
        console.error("Failed to move filter:", err);
        toast({
          title: "Move failed",
          message: err instanceof Error ? err.message : "Could not move filter",
          type: "error",
        });
      }
    },
    [savedFilters, toast]
  );

  const handleSelectFilter = useCallback(
    async (id: string) => {
      setActiveFilterId(id);
      setActiveTag(null);
      setTagTasks([]);
      setIsLoadingFilter(true);
      try {
        const res = await getFilterTasks(id, { limit: 50 });
        const mapped = res.items.map((t) => backendTaskToTaskItem(t));
        setFilterTasks(mapped);
        setFilterCursor(res.nextCursor);
        setFilterHasMore(res.hasMore);
      } catch (err) {
        console.error("Failed to load filter tasks:", err);
        setFilterTasks([]);
      } finally {
        setIsLoadingFilter(false);
      }
    },
    []
  );

  const handleLoadMoreFilter = useCallback(async () => {
    if (!activeFilterId || !filterCursor || !filterHasMore) return;
    setIsLoadingFilter(true);
    try {
      const res = await getFilterTasks(activeFilterId, { cursor: filterCursor, limit: 50 });
      const mapped = res.items.map((t) => backendTaskToTaskItem(t));
      setFilterTasks((prev) => [...prev, ...mapped]);
      setFilterCursor(res.nextCursor);
      setFilterHasMore(res.hasMore);
    } catch (err) {
      console.error("Failed to load more filter tasks:", err);
    } finally {
      setIsLoadingFilter(false);
    }
  }, [activeFilterId, filterCursor, filterHasMore]);

  // Tag-filtered view: mirrors the saved-filter mechanism but sources tasks
  // via getTasks({ tag }) (no saved-filter id exists for tags). Selecting the
  // active tag again toggles back to the list view.
  const handleSelectTag = useCallback(
    async (tag: { id: string; name: string }) => {
      if (activeTag?.id === tag.id) {
        setActiveTag(null);
        setTagTasks([]);
        setTagCursor(null);
        setTagHasMore(false);
        return;
      }
      setActiveFilterId(null);
      setFilterTasks([]);
      setActiveTag({ id: tag.id, name: tag.name } as BackendTag);
      setIsLoadingTag(true);
      try {
        const res = await getTasks({ tag: tag.name, include: "subtasks,checklist,tags", limit: 50 });
        const mapped = res.items.map((t) => backendTaskToTaskItem(t));
        setTagTasks(mapped);
        setTagCursor(res.nextCursor);
        setTagHasMore(res.hasMore);
      } catch (err) {
        console.error("Failed to load tag tasks:", err);
        setTagTasks([]);
        toast({
          title: "Failed to load tag",
          message: err instanceof Error ? err.message : "Network error",
          type: "error",
        });
      } finally {
        setIsLoadingTag(false);
      }
    },
    [activeTag, toast]
  );

  const handleLoadMoreTag = useCallback(async () => {
    if (!activeTag || !tagCursor || !tagHasMore) return;
    setIsLoadingTag(true);
    try {
      const res = await getTasks({ tag: activeTag.name, include: "subtasks,checklist,tags", cursor: tagCursor, limit: 50 });
      const mapped = res.items.map((t) => backendTaskToTaskItem(t));
      setTagTasks((prev) => [...prev, ...mapped]);
      setTagCursor(res.nextCursor);
      setTagHasMore(res.hasMore);
    } catch (err) {
      console.error("Failed to load more tag tasks:", err);
    } finally {
      setIsLoadingTag(false);
    }
  }, [activeTag, tagCursor, tagHasMore]);

  const handleFilterSuccess = useCallback(
    (saved: BackendSavedFilter) => {
      setSavedFilters((prev) => {
        const idx = prev.findIndex((f) => f.id === saved.id);
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = saved;
          return next;
        }
        return [...prev, saved];
      });
      success(`Saved filter "${saved.name}"`);
    },
    [success]
  );

  const handleOpenShortcuts = useCallback(() => {
    setIsShortcutsOpen(true);
    externalOpenShortcuts?.();
  }, [externalOpenShortcuts]);

  const handleOpenTaskFromSearch = useCallback(
    async (taskId: string) => {
      if (tasks.some((t) => t.id === taskId)) {
        setSelectedTaskId(taskId);
        return;
      }
      if (!isAuthenticated) {
        setSelectedTaskId(taskId);
        return;
      }
      try {
        const fetched = await getTask(taskId, "subtasks,checklist,tags");
        const mapped = backendTaskToTaskItem(fetched);
        setTasks((prev) => (prev.some((t) => t.id === mapped.id) ? prev : [mapped, ...prev]));
        setSelectedTaskId(mapped.id);
      } catch (err) {
        console.error("Failed to open task from search:", err);
        setSelectedTaskId(taskId);
      }
    },
    [tasks, isAuthenticated]
  );

  // Derived Inbox list and active list name
  const inboxList = useMemo(() => {
    return userLists.find((l) => l.isInbox) || null;
  }, [userLists]);

  const activeListName = useMemo(() => {
    if (activeListId) {
      const found = userLists.find((l) => l.id === activeListId);
      if (found) return found.name;
    }
    return undefined;
  }, [activeListId, userLists]);

  // Compute counts
  const listCounts = useMemo(() => {
    const counts: Record<string, number> = {
      today: viewCounts?.counts?.today ?? tasks.filter((t) => t.list === "today").length,
      upcoming: viewCounts?.counts?.upcoming ?? tasks.filter((t) => t.list === "upcoming").length,
      backlog: tasks.filter((t) => t.list === "backlog").length,
      completed: viewCounts?.counts?.completed ?? tasks.filter((t) => t.completed).length,
      overdue: viewCounts?.counts?.overdue ?? 0,
      priority: viewCounts?.counts?.priority ?? 0,
      "no-date": viewCounts?.counts?.["no-date"] ?? 0,
      all: viewCounts?.counts?.all ?? tasks.length,
    };

    for (const list of userLists) {
      counts[list.id] = tasks.filter((t) => t.listId === list.id).length;
    }

    return counts;
  }, [tasks, userLists, viewCounts]);

  const folderCounts = useMemo(() => {
    const counts: Record<string, number> = {
      engineering: tasks.filter((t) => t.folder === "engineering").length,
      design: tasks.filter((t) => t.folder === "design").length,
      personal: tasks.filter((t) => t.folder === "personal").length,
    };

    for (const folder of userFolders) {
      const folderListIds = new Set(
        userLists.filter((l) => l.folderId === folder.id).map((l) => l.id)
      );
      counts[folder.id] = tasks.filter(
        (t) => (t.listId && folderListIds.has(t.listId)) || t.folder === folder.name.toLowerCase()
      ).length;
    }

    return counts;
  }, [tasks, userFolders, userLists]);

  // Selected Task
  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId]
  );

  // Visible tasks in current list & folder for keyboard navigation
  const visibleTasks = useMemo(() => {
    return tasks.filter((task) => {
      if (activeListId) {
        if (task.listId && task.listId !== activeListId) return false;
      } else if (activeList === "completed") {
        if (!task.completed) return false;
      } else {
        if (task.list !== activeList) return false;
      }
      if (activeFolder && task.folder !== activeFolder) return false;
      return true;
    });
  }, [tasks, activeList, activeListId, activeFolder]);

  // Task Handlers
  // firePersistComplete runs the actual complete/reopen write and reconciles
  // the server echo (version + spawned nextTask). Shared by the immediate
  // path and the Undo-hold timer so both reconcile identically.
  const firePersistComplete = useCallback(
    (id: string, willComplete: boolean, withSubtasks: boolean) => {
      if (!isAuthenticated || id.startsWith("temp-")) return;
      // Phase 5 cutover 6c: offline-first via mutate (REST fallback inside
      // the persist helpers). A null echo means the local write was
      // accepted; the optimistic state above stands until sync pull.
      const apiCall: Promise<TaskCompletionResult | BackendTask | null> =
        willComplete
          ? persistTaskComplete(userId, id, withSubtasks)
          : persistTaskReopen(userId, id);
      apiCall
        .then((updated) => {
          if (updated === null) return;
          setTasks((prev) => {
            const mapped = prev.map((t) =>
              t.id === id
                ? {
                    ...t,
                    version: updated.version,
                    rawStatus: updated.status,
                    updatedAt: "Just now",
                  }
                : t
            );
            // When completing a recurring task, seamlessly add nextTask into state
            if (updated.nextTask) {
              const nextItem = backendTaskToTaskItem(updated.nextTask);
              if (!mapped.some((t) => t.id === nextItem.id)) {
                return [nextItem, ...mapped];
              }
            }
            return mapped;
          });
        })
        .catch((err) => {
          console.error("Failed to update task completion:", err);
          // Revert state
          setTasks((prev) =>
            prev.map((t) => (t.id === id ? { ...t, completed: !willComplete } : t))
          );
          if (willComplete) {
            setStreakCount((s) => Math.max(1, s - 1));
            setIsStreakActive(false);
          }
          toast({
            title: "Action failed",
            message: err instanceof Error ? err.message : "Failed to toggle task",
            type: "error",
          });
        });
    },
    [isAuthenticated, userId, toast]
  );

  // runToggleComplete performs the actual toggle; handleToggleComplete below
  // gates completion of a parent with open subtasks behind a one-time confirm.
  const runToggleComplete = useCallback(
    (id: string, withSubtasks: boolean) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) return;

      const willComplete = !target.completed;
      const isRepeating = Boolean(target.recurrenceId || target.recurrenceRule);

      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                completed: willComplete,
                subtasks: willComplete && withSubtasks ? markSubtasksDone(t.subtasks) : t.subtasks,
                updatedAt: "Just now",
              }
            : t
        )
      );

      if (willComplete) {
        setStreakCount((s) => s + 1);
        setStreakTaskTitle(target.title);
        setIsStreakActive(true);

        if (isRepeating) {
          // Day 5 Undo-hold: the row looks done now, but the complete
          // mutation only fires when the toast window expires. Undo cancels
          // the timer, so no backend write happens and no duplicate spawns.
          const prevTimer = pendingRepeatTimers.current.get(id);
          if (prevTimer) clearTimeout(prevTimer);
          const rrule = target.recurrenceRule?.rrule ?? null;
          const anchorIso = target.dueAt ?? null;
          const showHoldToast = (nextLabel: string | null) => {
            toast({
              title: "Done",
              message: nextLabel
                ? `Next: ${nextLabel}`
                : `"${target.title}" marked done.`,
              type: "success",
              actionLabel: "Undo",
              durationMs: REPEAT_HOLD_MS,
              onAction: () => {
                const pending = pendingRepeatTimers.current.get(id);
                if (pending) {
                  clearTimeout(pending);
                  pendingRepeatTimers.current.delete(id);
                }
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === id ? { ...t, completed: false, updatedAt: "Undone" } : t
                  )
                );
                setStreakCount((s) => Math.max(1, s - 1));
                // Held mutation never fired: nothing to invert server-side.
              },
            });
          };
          if (rrule) {
            // Lazy chunk: the rrule parser stays out of the main bundle.
            void Promise.all([
              import("@/components/repeat/next-dates"),
              import("@/components/repeat/rrule-presets"),
            ])
              .then(([{ getNextDate }, { formatNextDateLabel }]) => {
                const next = getNextDate(rrule, { anchorIso });
                showHoldToast(next ? formatNextDateLabel(next) : null);
              })
              .catch(() => showHoldToast(null));
          } else {
            showHoldToast(null);
          }
          pendingRepeatTimers.current.set(
            id,
            setTimeout(() => {
              pendingRepeatTimers.current.delete(id);
              firePersistComplete(id, true, withSubtasks);
            }, REPEAT_HOLD_MS)
          );
        } else {
        // Phase 2 premium 1b (pilot): capture the before-image and push the
        // inverse so Undo replays it via mutate(). Falls back to
        // persistTaskReopen below when the stack misses.
        pushUndo(
          inverseOf(
            { entity: "tasks", op: "complete", entityId: id },
            { beforeStatus: target.rawStatus ?? "todo" }
          )
        );

        toast({
          title: "Task completed",
          message: `"${target.title}" marked done.`,
          type: "success",
          actionLabel: "Undo",
          durationMs: 8000,
          onAction: () => {
            setTasks((prev) =>
              prev.map((t) => (t.id === id ? { ...t, completed: false, updatedAt: "Undone" } : t))
            );
            setStreakCount((s) => Math.max(1, s - 1));

            if (isAuthenticated && !id.startsWith("temp-")) {
              const next = popUndo();
              const inverse = next && next.entityId === id ? next : undefined;
              if (next && !inverse) pushUndo(next); // belongs to another toast; leave it
              const undoWrite =
                inverse && userId
                  ? mutate(userId, inverse)
                  : persistTaskReopen(userId, id);
              undoWrite.catch((err) => {
                console.error("Undo reopen task failed:", err);
                setTasks((prev) =>
                  prev.map((t) => (t.id === id ? { ...t, completed: true } : t))
                );
                toast({
                  title: "Undo failed",
                  message: err instanceof Error ? err.message : "Failed to undo task completion",
                  type: "error",
                });
              });
            }
          },
        });
        }
      } else {
        // A reopen inside the hold window cancels the held complete mutation.
        const pending = pendingRepeatTimers.current.get(id);
        if (pending) {
          clearTimeout(pending);
          pendingRepeatTimers.current.delete(id);
        }
        toast({
          message: `"${target.title}" marked active.`,
          actionLabel: "Undo",
          onAction: () => {
            setTasks((prev) =>
              prev.map((t) => (t.id === id ? { ...t, completed: true, updatedAt: "Re-done" } : t))
            );

            if (isAuthenticated && !id.startsWith("temp-")) {
              persistTaskComplete(userId, id).catch((err) => {
                console.error("Undo complete task failed:", err);
                setTasks((prev) =>
                  prev.map((t) => (t.id === id ? { ...t, completed: false } : t))
                );
                toast({
                  title: "Undo failed",
                  message: err instanceof Error ? err.message : "Failed to undo task reopen",
                  type: "error",
                });
              });
            }
          },
        });
      }

      // Immediate write for every path except a repeating completion, whose
      // mutation is held until the Undo toast window expires (see above).
      if (!(willComplete && isRepeating)) {
        firePersistComplete(id, willComplete, withSubtasks);
      }
    },
    [tasks, isAuthenticated, userId, toast, firePersistComplete]
  );

  // Gate: completing a parent with open subtasks asks once whether to
  // complete the sub-tasks too. Reopening never prompts. Row keyboard
  // (Space) funnels through here as well, so one gate covers every path.
  const handleToggleComplete = useCallback(
    (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) return;
      if (!target.completed) {
        const openCount = countOpenSubtasks(target.subtasks);
        if (openCount > 0) {
          setPendingSubtasksComplete({ id, openCount });
          return;
        }
      }
      runToggleComplete(id, false);
    },
    [tasks, runToggleComplete]
  );

  const handleSkipTask = useCallback(
    async (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) return;

      // Optimistically mark current task cancelled
      setTasks((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, completed: true, rawStatus: "cancelled" as const, updatedAt: "Skipped" }
            : t
        )
      );

      try {
        const res = await skipTask(id);
        let nextDueDateStr = "";

        setTasks((prev) => {
          const updated = prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  completed: true,
                  rawStatus: "cancelled" as const,
                  version: res.task?.version || res.version,
                  updatedAt: "Skipped",
                }
              : t
          );
          if (res.nextTask) {
            const nextItem = backendTaskToTaskItem(res.nextTask);
            nextDueDateStr =
              nextItem.dueDate ||
              (nextItem.dueAt ? new Date(nextItem.dueAt).toLocaleDateString() : "");
            if (!updated.some((t) => t.id === nextItem.id)) {
              return [nextItem, ...updated];
            }
          }
          return updated;
        });

        toast({
          title: "Occurrence skipped",
          message: nextDueDateStr
            ? `Skipped occurrence. Next task due on ${nextDueDateStr}.`
            : "Skipped occurrence.",
          type: "info",
        });
      } catch (err) {
        console.error("Failed to skip recurring task occurrence:", err);
        // Revert status
        setTasks((prev) =>
          prev.map((t) =>
            t.id === id
              ? { ...t, completed: target.completed, rawStatus: target.rawStatus }
              : t
          )
        );
        toast({
          title: "Skip failed",
          message: err instanceof Error ? err.message : "Failed to skip recurring task occurrence",
          type: "error",
        });
      }
    },
    [tasks, toast]
  );

  const handleDeleteTask = useCallback(
    (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) return;

      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (selectedTaskId === id) setSelectedTaskId(null);

      if (isAuthenticated && !id.startsWith("temp-")) {
        const doRestDelete = () => {
          deleteTask(id)
            .then(() => {
              toast({
                title: "Task deleted",
                message: `"${target.title}" moved to trash.`,
                actionLabel: "Undo",
                onAction: () => {
                  setTasks((prev) => [target, ...prev]);
                  setSelectedTaskId(target.id);

                  restoreTrash("task", id).catch((err) => {
                    console.error("Failed to restore task from trash:", err);
                    setTasks((prev) => prev.filter((t) => t.id !== id));
                    toast({
                      title: "Undo failed",
                      message: err instanceof Error ? err.message : "Failed to restore task from trash",
                      type: "error",
                    });
                  });
                },
              });
            })
            .catch((err) => {
              console.error("Failed to delete task:", err);
              setTasks((prev) => [target, ...prev]);
              toast({
                title: "Delete failed",
                message: err instanceof Error ? err.message : "Could not delete task",
                type: "error",
              });
            });
        };
        if (userId) {
          // Phase 5 cutover 6c: offline-first delete; undo restores via the
          // mutate restore op so it also works offline (REST fallback both).
          mutate(userId, { entity: "tasks", op: "delete", entityId: id })
            .then(() => {
              toast({
                title: "Task deleted",
                message: `"${target.title}" moved to trash.`,
                actionLabel: "Undo",
                onAction: () => {
                  setTasks((prev) => [target, ...prev]);
                  setSelectedTaskId(target.id);

                  const doRestore = mutate(userId, {
                    entity: "tasks",
                    op: "restore",
                    entityId: id,
                  }).catch(() => restoreTrash("task", id));
                  doRestore.catch((err) => {
                    console.error("Failed to restore task from trash:", err);
                    setTasks((prev) => prev.filter((t) => t.id !== id));
                    toast({
                      title: "Undo failed",
                      message: err instanceof Error ? err.message : "Failed to restore task from trash",
                      type: "error",
                    });
                  });
                },
              });
            })
            .catch(() => doRestDelete());
        } else {
          doRestDelete();
        }
      } else {
        toast({
          title: "Task deleted",
          message: `"${target.title}" moved to trash.`,
          actionLabel: "Undo",
          onAction: () => {
            setTasks((prev) => [target, ...prev]);
          },
        });
      }
    },
    [tasks, selectedTaskId, isAuthenticated, userId, toast]
  );

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInput =
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement ||
        (activeElement as HTMLElement)?.isContentEditable;

      // Handle Escape in all contexts
      if (e.key === "Escape") {
        if (isShortcutsOpen) {
          setIsShortcutsOpen(false);
          return;
        }
        if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
          return;
        }
        if (selectedTaskId) {
          setSelectedTaskId(null);
          return;
        }
      }

      // Handle Cmd+K / Ctrl+K in all contexts
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
        return;
      }

      // If user is focused on an input/editable, don't hijack single-character hotkeys
      if (isInput) return;

      // Modals open -> don't trigger workspace hotkeys
      if (isShortcutsOpen || isCommandPaletteOpen) return;

      // ? or Shift+/ -> Open Shortcuts Modal
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault();
        setIsShortcutsOpen(true);
        return;
      }

      // / without modifiers -> Open Command Palette
      if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      // N / Q -> Quick-focus task creation
      if (
        (e.key.toLowerCase() === "n" || e.key.toLowerCase() === "q") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>("input[data-testid='quick-add-input']");
        input?.focus();
        return;
      }

      // J / ArrowDown -> Navigate to next task
      if (
        (e.key.toLowerCase() === "j" || e.key === "ArrowDown") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (visibleTasks.length === 0) return;
        const currentIndex = visibleTasks.findIndex((t) => t.id === selectedTaskId);
        if (currentIndex === -1 || currentIndex >= visibleTasks.length - 1) {
          setSelectedTaskId(visibleTasks[0]?.id ?? null);
        } else {
          setSelectedTaskId(visibleTasks[currentIndex + 1]?.id ?? null);
        }
        return;
      }

      // K / ArrowUp -> Navigate to previous task
      if (
        (e.key.toLowerCase() === "k" || e.key === "ArrowUp") &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        e.preventDefault();
        if (visibleTasks.length === 0) return;
        const currentIndex = visibleTasks.findIndex((t) => t.id === selectedTaskId);
        if (currentIndex <= 0) {
          setSelectedTaskId(visibleTasks[visibleTasks.length - 1]?.id ?? null);
        } else {
          setSelectedTaskId(visibleTasks[currentIndex - 1]?.id ?? null);
        }
        return;
      }

      // Space or X -> Toggle selected task completion
      if ((e.key === " " || e.key.toLowerCase() === "x") && selectedTaskId) {
        e.preventDefault();
        handleToggleComplete(selectedTaskId);
        return;
      }

      // D or Backspace -> Delete selected task
      if (
        (e.key.toLowerCase() === "d" || e.key === "Backspace") &&
        selectedTaskId &&
        !e.ctrlKey &&
        !e.metaKey
      ) {
        e.preventDefault();
        handleDeleteTask(selectedTaskId);
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isShortcutsOpen,
    isCommandPaletteOpen,
    selectedTaskId,
    visibleTasks,
    handleToggleComplete,
    handleDeleteTask,
  ]);

  const handleAddTask = useCallback(
    (data: {
      title: string;
      priority: Priority;
      folder: FolderId;
      list: ListId;
      sectionId?: string | null;
      dueDate?: string | null;
    }) => {
      const tempId = `temp-${Date.now()}`;
      const targetBackendListId =
        activeListId || userLists.find((l) => l.isInbox)?.id || userLists[0]?.id;

      const newTask: TaskItem = {
        id: tempId,
        title: data.title,
        completed: false,
        priority: data.priority,
        folder: data.folder,
        list: data.list,
        tags: data.folder && data.folder !== "none" ? [data.folder] : [],
        dueDate: data.dueDate || (data.list === "today" ? "Today" : undefined),
        subtasks: [],
        checklist: [],
        createdAt: "Just now",
        updatedAt: "Just now",
        listId: targetBackendListId || undefined,
        sectionId: data.sectionId || null,
      };

      setTasks((prev) => [newTask, ...prev]);
      setSelectedTaskId(newTask.id);

      if (isAuthenticated && targetBackendListId) {
        let dueAt: string | undefined = undefined;
        if (data.dueDate === "Today" || data.list === "today") {
          dueAt = new Date().toISOString();
        } else if (data.dueDate === "Tomorrow") {
          const tmr = new Date();
          tmr.setDate(tmr.getDate() + 1);
          dueAt = tmr.toISOString();
        } else if (data.dueDate) {
          const parsed = new Date(data.dueDate);
          if (!isNaN(parsed.getTime())) {
            dueAt = parsed.toISOString();
          }
        }

        const doRestCreate = () => {
          createTask({
            title: data.title,
            priority: priorityUiToBackend(data.priority),
            listId: targetBackendListId,
            sectionId: data.sectionId || undefined,
            dueAt,
          })
            .then((createdBackendTask) => {
              const mapped = backendTaskToTaskItem(createdBackendTask, {
                listOverride: data.list,
                folderOverride: data.folder,
              });
              setTasks((prev) => prev.map((t) => (t.id === tempId ? mapped : t)));
              setSelectedTaskId((prev) => (prev === tempId ? mapped.id : prev));
              success(`Created task "${data.title}"`);
            })
            .catch((err) => {
              console.error("Failed to create task on backend:", err);
              setTasks((prev) => prev.filter((t) => t.id !== tempId));
              setSelectedTaskId((prev) => (prev === tempId ? null : prev));
              toast({
                title: "Creation failed",
                message: err instanceof Error ? err.message : "Could not create task",
                type: "error",
              });
            });
        };
        if (userId) {
          // Phase 5 cutover 6c: offline-first create, client-generated id.
          // mutate appends position at end internally. Falls back to REST.
          const newId = uuidv7();
          const createPatch: Record<string, unknown> = {
            title: data.title,
            priority: priorityUiToBackend(data.priority),
            listId: targetBackendListId,
            dueAt,
          };
          if (data.sectionId) createPatch["sectionId"] = data.sectionId;
          mutate(userId, { entity: "tasks", op: "create", entityId: newId, patch: createPatch })
            .then(() => {
              setTasks((prev) =>
                prev.map((t) => (t.id === tempId ? { ...t, id: newId } : t))
              );
              setSelectedTaskId((prev) => (prev === tempId ? newId : prev));
              success(`Created task "${data.title}"`);
            })
            .catch(() => doRestCreate());
        } else {
          doRestCreate();
        }
      } else {
        success(`Created task "${data.title}"`);
      }
    },
    [activeListId, userLists, isAuthenticated, userId, success, toast]
  );

  const handleQuickAddTask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

      if (!isAuthenticated) {
        handleAddTask({
          title: trimmed,
          priority: "med",
          folder: activeFolder || "none",
          list: activeList === "completed" ? "today" : activeList,
        });
        return;
      }

      // Offline-first path (Phase 5 follow-up): NLP parse stays online, then
      // the task is created via mutate. Tag/reminder/recurrence enrichment
      // from the parse result cannot resolve offline (tag ids, reminder and
      // recurrence rows), so only plain task row fields (title/listId/dueAt/
      // priority/allDay/estimateMin) travel on the mutate path.
      if (userId) {
        const resolveListId = (preferred?: string | null) =>
          preferred ??
          activeListId ??
          userLists.find((l) => l.isInbox)?.id ??
          userLists[0]?.id;

        // Optimistic mutate-create: prepends the temp item, swaps in the
        // client-generated id on success, removes it on failure.
        const mutateCreate = async (
          patch: Record<string, unknown>,
          optimistic: TaskItem
        ): Promise<string> => {
          const newId = uuidv7();
          setTasks((prev) => [optimistic, ...prev]);
          setSelectedTaskId(optimistic.id);
          try {
            await mutate(userId, {
              entity: "tasks",
              op: "create",
              entityId: newId,
              patch,
            });
          } catch (err) {
            setTasks((prev) => prev.filter((t) => t.id !== optimistic.id));
            setSelectedTaskId((prev) => (prev === optimistic.id ? null : prev));
            throw err;
          }
          setTasks((prev) =>
            prev.map((t) => (t.id === optimistic.id ? { ...t, id: newId } : t))
          );
          setSelectedTaskId((prev) => (prev === optimistic.id ? newId : prev));
          return newId;
        };

        let parsed: ParsedTaskResult | null = null;
        try {
          parsed = await parseNaturalLanguageText(trimmed);
        } catch {
          parsed = null;
        }

        if (parsed) {
          const finalListId = resolveListId(parsed.list?.id);
          if (finalListId) {
            let dueAt: string | undefined;
            if (parsed.dueAt) {
              const d =
                parsed.dueAt instanceof Date
                  ? parsed.dueAt
                  : new Date(parsed.dueAt);
              if (!isNaN(d.getTime())) dueAt = d.toISOString();
            }
            const patch: Record<string, unknown> = {
              title: parsed.title,
              listId: finalListId,
              priority: parsed.priority,
              allDay: parsed.allDay,
            };
            if (dueAt) patch["dueAt"] = dueAt;
            if (parsed.estimateMin != null) patch["estimateMin"] = parsed.estimateMin;
            const optimistic: TaskItem = {
              id: `temp-${Date.now()}`,
              title: parsed.title,
              completed: false,
              priority: priorityBackendToUi(parsed.priority),
              folder: activeFolder || "none",
              list: activeList === "completed" ? "today" : activeList,
              tags: [],
              dueDate: dueAt ? formatDueDate(dueAt) : undefined,
              subtasks: [],
              checklist: [],
              createdAt: "Just now",
              updatedAt: "Just now",
              listId: finalListId,
              sectionId: null,
            };
            try {
              await mutateCreate(patch, optimistic);
              success(`Created "${parsed.title}"`);
            } catch {
              // Local write failed: fall back to the quick REST endpoint.
              try {
                const created = await quickAddTask({
                  text: trimmed,
                  timezone,
                  listId: activeListId || undefined,
                });
                const taskItem = backendTaskToTaskItem(created);
                setTasks((prev) => [taskItem, ...prev]);
                setSelectedTaskId(taskItem.id);
                success(`Created "${taskItem.title}"`);
              } catch (err) {
                console.error("Quick add failed:", err);
                toast({
                  title: "Quick add failed",
                  message:
                    err instanceof Error ? err.message : "Could not create task",
                  type: "error",
                });
              }
            }
            return;
          }
        }

        // Parse unavailable (offline?) or no target list: try the quick REST
        // endpoint, which re-parses server-side. When that fails too, create
        // a plain local task via mutate with the raw text as title.
        try {
          const created = await quickAddTask({
            text: trimmed,
            timezone,
            listId: activeListId || undefined,
          });
          const taskItem = backendTaskToTaskItem(created);
          setTasks((prev) => [taskItem, ...prev]);
          setSelectedTaskId(taskItem.id);
          success(`Created "${taskItem.title}"`);
        } catch (err) {
          console.error("Quick add failed, falling back to local create:", err);
          const fallbackListId = resolveListId();
          if (!fallbackListId) {
            handleAddTask({
              title: trimmed,
              priority: "med",
              folder: activeFolder || "none",
              list: activeList === "completed" ? "today" : activeList,
            });
            return;
          }
          const optimistic: TaskItem = {
            id: `temp-${Date.now()}`,
            title: trimmed,
            completed: false,
            priority: "med",
            folder: activeFolder || "none",
            list: activeList === "completed" ? "today" : activeList,
            tags: [],
            subtasks: [],
            checklist: [],
            createdAt: "Just now",
            updatedAt: "Just now",
            listId: fallbackListId,
            sectionId: null,
          };
          try {
            await mutateCreate(
              { title: trimmed, listId: fallbackListId, priority: 2 },
              optimistic
            );
            success(`Created "${trimmed}"`);
          } catch (mutateErr) {
            console.error("Local quick add failed:", mutateErr);
            toast({
              title: "Quick add failed",
              message:
                mutateErr instanceof Error
                  ? mutateErr.message
                  : "Could not create task",
              type: "error",
            });
          }
        }
        return;
      }

      try {
        const created = await quickAddTask({
          text: trimmed,
          timezone,
          listId: activeListId || undefined,
        });
        const taskItem = backendTaskToTaskItem(created);
        setTasks((prev) => [taskItem, ...prev]);
        setSelectedTaskId(taskItem.id);
        success(`Created "${taskItem.title}"`);
      } catch (err) {
        console.error("Quick add failed, falling back to standard create:", err);
        handleAddTask({
          title: trimmed,
          priority: "med",
          folder: activeFolder || "none",
          list: activeList === "completed" ? "today" : activeList,
        });
      }
    },
    [
      isAuthenticated,
      activeFolder,
      activeList,
      activeListId,
      handleAddTask,
      success,
      toast,
      userId,
      userLists,
    ]
  );

  const handleUpdateTask = useCallback(
    (updated: TaskItem) => {
      const prevTask = tasks.find((t) => t.id === updated.id);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

      if (isAuthenticated && !updated.id.startsWith("temp-") && !updated.id.startsWith("task-")) {
        const input = taskItemToBackendUpdateInput(updated);
        const doRestUpdate = () => {
          updateTask(updated.id, input).catch((err) => {
            console.error("Failed to update task:", err);
            if (prevTask) {
              setTasks((prev) => prev.map((t) => (t.id === updated.id ? prevTask : t)));
            }
            toast({
              title: "Update failed",
              message: err instanceof Error ? err.message : "Could not save task updates",
              type: "error",
            });
          });
        };
        if (userId) {
          // Phase 5 cutover 6c: offline-first update. The OCC version is a
          // REST concurrency token, not a field — strip it so push uses LWW
          // (editedAt) instead of tripping on a stale version.
          const patch: Record<string, unknown> = { ...input };
          delete patch["version"];
          mutate(userId, { entity: "tasks", op: "update", entityId: updated.id, patch }).catch(() =>
            doRestUpdate()
          );
        } else {
          doRestUpdate();
        }
      }
    },
    [isAuthenticated, tasks, userId, toast]
  );

  const handleDuplicateTask = useCallback(
    async (taskId: string) => {
      const original = tasks.find((t) => t.id === taskId);
      if (!original) return;

      if (isAuthenticated && !taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        try {
          const backendDuplicated = await duplicateTask(taskId);
          const mapped = backendTaskToTaskItem(backendDuplicated, {
            listOverride: original.list,
            folderOverride: original.folder,
          });
          const originalIndex = tasks.findIndex((t) => t.id === taskId);
          setTasks((prev) => {
            const next = [...prev];
            next.splice(originalIndex + 1, 0, mapped);
            return next;
          });
          setSelectedTaskId(mapped.id);
          success(`Duplicated "${original.title}"`);
        } catch (err) {
          console.error("Failed to duplicate task on backend:", err);
          toast({
            title: "Duplicate failed",
            message: err instanceof Error ? err.message : "Could not duplicate task",
            type: "error",
          });
        }
      } else {
        const duplicateItem: TaskItem = {
          ...original,
          id: `temp-${Date.now()}`,
          title: `${original.title} (Copy)`,
          createdAt: "Just now",
          updatedAt: "Just now",
        };
        const originalIndex = tasks.findIndex((t) => t.id === taskId);
        setTasks((prev) => {
          const next = [...prev];
          next.splice(originalIndex + 1, 0, duplicateItem);
          return next;
        });
        setSelectedTaskId(duplicateItem.id);
        success(`Duplicated "${original.title}"`);
      }
    },
    [tasks, isAuthenticated, success, toast]
  );

  const handleArchiveTask = useCallback(
    async (taskId: string) => {
      const target = tasks.find((t) => t.id === taskId);
      if (!target) return;

      setTasks((prev) => prev.filter((t) => t.id !== taskId));
      if (selectedTaskId === taskId) {
        setSelectedTaskId(null);
      }

      if (isAuthenticated && !taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        // Phase 5 follow-up: offline-first archive. archivedAt is a mutable
        // task field in the sync registry (TASK_FIELDS + date-parsed, not
        // server-owned), so archive/unarchive mirror as update patches with
        // the local ms convention. REST remains the fallback when there is
        // no userId or Dexie throws (e.g. unknown local row).
        const archiveOp: Promise<unknown> = userId
          ? mutate(userId, {
              entity: "tasks",
              op: "update",
              entityId: taskId,
              patch: { archivedAt: Date.now() },
            }).catch(() => archiveTask(taskId))
          : archiveTask(taskId);
        const unarchiveOp = (): Promise<unknown> =>
          userId
            ? mutate(userId, {
                entity: "tasks",
                op: "update",
                entityId: taskId,
                patch: { archivedAt: null },
              }).catch(() => unarchiveTask(taskId))
            : unarchiveTask(taskId);
        try {
          await archiveOp;
          toast({
            title: "Task archived",
            message: `"${target.title}" moved to archive.`,
            actionLabel: "Undo",
            onAction: () => {
              setTasks((prev) => [target, ...prev]);
              setSelectedTaskId(target.id);
              unarchiveOp().catch((err) => {
                console.error("Failed to unarchive task:", err);
                setTasks((prev) => prev.filter((t) => t.id !== taskId));
                toast({
                  title: "Undo failed",
                  message: err instanceof Error ? err.message : "Could not restore archived task",
                  type: "error",
                });
              });
            },
          });
        } catch (err) {
          console.error("Failed to archive task:", err);
          setTasks((prev) => [target, ...prev]);
          toast({
            title: "Archive failed",
            message: err instanceof Error ? err.message : "Could not archive task",
            type: "error",
          });
        }
      } else {
        toast({
          title: "Task archived",
          message: `"${target.title}" moved to archive.`,
          actionLabel: "Undo",
          onAction: () => {
            setTasks((prev) => [target, ...prev]);
            setSelectedTaskId(target.id);
          },
        });
      }
    },
    [tasks, selectedTaskId, isAuthenticated, userId, toast]
  );

  const handleSaveAsTemplate = useCallback(
    async (taskId: string, name: string) => {
      if (isAuthenticated && !taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        try {
          await saveTaskAsTemplate(taskId, name);
          success(`Saved "${name}" as template`);
        } catch (err) {
          console.error("Failed to save template on backend:", err);
          toast({
            title: "Template save failed",
            message: err instanceof Error ? err.message : "Could not save template",
            type: "error",
          });
        }
      } else {
        success(`Saved "${name}" as template`);
      }
    },
    [isAuthenticated, success, toast]
  );

  const handleToggleSubtask = useCallback(
    (subtaskId: string, completed: boolean) => {
      if (isAuthenticated && !subtaskId.startsWith("st-") && !subtaskId.startsWith("temp-")) {
        // Offline-first via mutate (complete/reopen), REST fallback.
        const persist = completed
          ? persistTaskComplete(userId, subtaskId)
          : persistTaskReopen(userId, subtaskId);
        persist.catch((err) => {
          console.error("Failed to toggle subtask on backend:", err);
        });
      }
    },
    [isAuthenticated, userId]
  );

  const handleAddSubtask = useCallback(
    (title: string, parentId: string) => {
      const targetBackendListId =
        activeListId || userLists.find((l) => l.isInbox)?.id || userLists[0]?.id;

      if (isAuthenticated && targetBackendListId && !parentId.startsWith("temp-") && !parentId.startsWith("task-")) {
        const doRestCreate = () => {
          createTask({
            title,
            parentId,
            listId: targetBackendListId,
            priority: 1,
          }).catch((err) => {
            console.error("Failed to create subtask on backend:", err);
          });
        };
        if (userId) {
          // Offline-first subtask create (tasks entity with parentId).
          // Falls back to REST when the parent row is unknown locally.
          mutate(userId, {
            entity: "tasks",
            op: "create",
            entityId: uuidv7(),
            patch: {
              title,
              parentId,
              listId: targetBackendListId,
              priority: 1,
            },
          }).catch(() => doRestCreate());
        } else {
          doRestCreate();
        }
      }
    },
    [isAuthenticated, activeListId, userLists, userId]
  );

  const handleDeleteSubtask = useCallback(
    (subtaskId: string) => {
      if (isAuthenticated && !subtaskId.startsWith("st-") && !subtaskId.startsWith("temp-")) {
        const doRestDelete = () => {
          deleteTask(subtaskId).catch((err) => {
            console.error("Failed to delete subtask on backend:", err);
          });
        };
        if (userId) {
          mutate(userId, { entity: "tasks", op: "delete", entityId: subtaskId }).catch(() =>
            doRestDelete()
          );
        } else {
          doRestDelete();
        }
      }
    },
    [isAuthenticated, userId]
  );

  const handleAddChecklistItem = useCallback(
    (text: string) => {
      if (
        isAuthenticated &&
        selectedTaskId &&
        !selectedTaskId.startsWith("temp-") &&
        !selectedTaskId.startsWith("task-")
      ) {
        const taskId = selectedTaskId;
        const reconcileId = (id: string) => {
          setTasks((prev) =>
            prev.map((t) => {
              if (t.id !== taskId) return t;
              const updatedList = t.checklist.map((ci) =>
                ci.text === text && ci.id.startsWith("ci-")
                  ? { ...ci, id }
                  : ci
              );
              return { ...t, checklist: updatedList };
            })
          );
        };
        const doRestCreate = () => {
          createChecklistItem(taskId, text)
            .then((createdItem) => {
              reconcileId(createdItem.id);
            })
            .catch((err) => {
              console.error("Failed to create checklist item on backend:", err);
            });
        };
        if (userId) {
          // Offline-first checklist create; reconcile the optimistic temp
          // id with the client-generated id (server echo arrives via sync).
          const newId = uuidv7();
          mutate(userId, {
            entity: "checklistItems",
            op: "create",
            entityId: newId,
            patch: { taskId, text },
          })
            .then(() => {
              reconcileId(newId);
            })
            .catch(() => doRestCreate());
        } else {
          doRestCreate();
        }
      }
    },
    [isAuthenticated, selectedTaskId, userId]
  );

  const handleToggleChecklistItem = useCallback(
    (itemId: string, done: boolean) => {
      if (isAuthenticated && !itemId.startsWith("ci-")) {
        const doRestUpdate = () => {
          updateChecklistItem(itemId, { done }).catch((err) => {
            console.error("Failed to update checklist item on backend:", err);
          });
        };
        if (userId) {
          // done-toggle is an update op (no complete op for checklistItems).
          mutate(userId, {
            entity: "checklistItems",
            op: "update",
            entityId: itemId,
            patch: { done },
          }).catch(() => doRestUpdate());
        } else {
          doRestUpdate();
        }
      }
    },
    [isAuthenticated, userId]
  );

  const handleDeleteChecklistItem = useCallback(
    (itemId: string) => {
      if (isAuthenticated && !itemId.startsWith("ci-")) {
        const doRestDelete = () => {
          deleteChecklistItem(itemId).catch((err) => {
            console.error("Failed to delete checklist item on backend:", err);
          });
        };
        if (userId) {
          mutate(userId, { entity: "checklistItems", op: "delete", entityId: itemId }).catch(() =>
            doRestDelete()
          );
        } else {
          doRestDelete();
        }
      }
    },
    [isAuthenticated, userId]
  );

  const handleUpdateTags = useCallback(
    // Offline-first tag attach/detach via the tasks setTags sync op
    // (whole-set LWW, patch { tagIds }). REST remains the fallback when
    // there is no userId or Dexie throws. An empty array is a valid set
    // (detach-all), so only the array's presence is required.
    (tagNames: string[], tagIds?: string[]) => {
      if (
        isAuthenticated &&
        selectedTaskId &&
        tagIds &&
        !selectedTaskId.startsWith("temp-") &&
        !selectedTaskId.startsWith("task-")
      ) {
        const taskId = selectedTaskId;
        const nextIds = [...tagIds];
        if (userId) {
          mutate(userId, {
            entity: "tasks",
            op: "setTags",
            entityId: taskId,
            patch: { tagIds: nextIds },
          }).catch(() => {
            replaceTaskTags(taskId, nextIds).catch((err) => {
              console.error("Failed to replace tags on backend:", err);
            });
          });
        } else {
          replaceTaskTags(taskId, nextIds).catch((err) => {
            console.error("Failed to replace tags on backend:", err);
          });
        }
      }
    },
    [isAuthenticated, selectedTaskId, userId]
  );

  const handleLoadMoreView = useCallback(async () => {
    if (!viewCursor || !viewHasMore) return;
    setIsLoadingView(true);
    try {
      const res = await getViewItems(activeList, { cursor: viewCursor, limit: 50 });
      const mapped = res.items.map((t) =>
        backendTaskToTaskItem(t as BackendTask, { listOverride: activeList as ListId })
      );
      setTasks((prev) => [...prev, ...mapped]);
      setViewCursor(res.nextCursor);
      setViewHasMore(res.hasMore);
    } catch (err) {
      console.error("Failed to load more view items:", err);
    } finally {
      setIsLoadingView(false);
    }
  }, [activeList, viewCursor, viewHasMore]);

  const handleMoveBoardTask = useCallback(
    async (taskId: string, column: string, afterId?: string, beforeId?: string) => {
      if (!isAuthenticated) return;

      const doRestMove = async () => {
        await moveBoardTask({ taskId, column, afterId, beforeId });
        const res = await getBoard({ list_id: activeListId || undefined, group_by: boardGroupBy });
        setBoardData(res);
      };

      // Phase 5 cutover: offline-first board move via mutate with an
      // optimistic column update (a REST refetch here would race the ~300ms
      // delayed push and snap the card back). mutate "move" never ships
      // computed positions — the server recomputes from afterId/beforeId.
      // Status/priority column changes steer fields, not position, so they
      // go through "update" (sync move only handles list/section/parent).
      if (userId && !taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        try {
          const reorderPatch: Record<string, unknown> = {};
          if (afterId !== undefined) reorderPatch.afterId = afterId;
          if (beforeId !== undefined) reorderPatch.beforeId = beforeId;

          let movedFields: Partial<BackendViewTask> | null = null;
          if (
            boardGroupBy === "status" &&
            ["todo", "in_progress", "done", "cancelled"].includes(column)
          ) {
            await mutate(userId, {
              entity: "tasks",
              op: "update",
              entityId: taskId,
              patch: { status: column },
            });
            if (Object.keys(reorderPatch).length > 0) {
              await mutate(userId, { entity: "tasks", op: "move", entityId: taskId, patch: reorderPatch });
            }
            movedFields = { status: column as BackendViewTask["status"] };
          } else if (
            boardGroupBy === "priority" &&
            ["0", "1", "2", "3", "4"].includes(column)
          ) {
            await mutate(userId, {
              entity: "tasks",
              op: "update",
              entityId: taskId,
              patch: { priority: Number(column) },
            });
            if (Object.keys(reorderPatch).length > 0) {
              await mutate(userId, { entity: "tasks", op: "move", entityId: taskId, patch: reorderPatch });
            }
            movedFields = { priority: Number(column) };
          } else {
            await mutate(userId, {
              entity: "tasks",
              op: "move",
              entityId: taskId,
              patch: {
                sectionId: column === "no_section" ? null : column,
                ...reorderPatch,
              },
            });
            movedFields = { sectionId: column === "no_section" ? null : column };
          }

          setBoardData((prev) => {
            if (!prev || !movedFields) return prev;
            let moving: BackendViewTask | null = null;
            const withoutSource = prev.columns.map((col) => {
              const idx = col.tasks.findIndex((t) => t.id === taskId);
              if (idx < 0) return col;
              moving = col.tasks[idx];
              return {
                ...col,
                tasks: col.tasks.filter((t) => t.id !== taskId),
                count: Math.max(0, col.count - 1),
              };
            });
            if (!moving) return prev;
            const moved: BackendViewTask = { ...(moving as BackendViewTask), ...movedFields };
            return {
              ...prev,
              columns: withoutSource.map((col) => {
                if (col.key !== column) return col;
                const at = beforeId ? col.tasks.findIndex((t) => t.id === beforeId) : -1;
                const tasks =
                  at >= 0
                    ? [...col.tasks.slice(0, at), moved, ...col.tasks.slice(at)]
                    : [...col.tasks, moved];
                return { ...col, tasks, count: col.count + 1 };
              }),
            };
          });
          return;
        } catch {
          // Dexie write failed: fall through to the REST path below.
        }
      }

      try {
        await doRestMove();
      } catch (err) {
        console.error("Failed to move board task:", err);
        toast({
          title: "Move failed",
          message: err instanceof Error ? err.message : "Could not move task",
          type: "error",
        });
      }
    },
    [isAuthenticated, userId, activeListId, boardGroupBy, toast]
  );

  // Cycle folders for mobile nav
  const handleCycleFolder = useCallback(() => {
    const folders: (FolderId | null)[] = [null, "engineering", "design", "personal"];
    const currentIndex = folders.indexOf(activeFolder);
    const nextFolder = folders[(currentIndex + 1) % folders.length];
    setActiveFolder(nextFolder);
  }, [activeFolder]);

  return (
    <div className="relative flex h-[calc(100vh-65px)] w-full overflow-hidden bg-white dark:bg-[#051A4D]">
      {/* Collapsible Left Sidebar */}
      <Sidebar
        activeList={activeList}
        onSelectList={setActiveList}
        activeListId={activeListId}
        onSelectListId={setActiveListId}
        activeFolder={activeFolder}
        onSelectFolder={setActiveFolder}
        lists={userLists}
        folders={userFolders}
        inboxList={inboxList}
        listCounts={listCounts}
        folderCounts={folderCounts}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenShortcuts={handleOpenShortcuts}
        onNewTask={() => {
          // Focus or select add task
          const input = document.querySelector<HTMLInputElement>("input[data-testid='quick-add-input']");
          input?.focus();
        }}
        onCreateList={handleCreateList}
        onEditList={handleEditList}
        onArchiveList={handleArchiveList}
        onDeleteList={handleDeleteList}
        onCreateFolder={handleCreateFolder}
        onEditFolder={handleEditFolder}
        onDeleteFolder={handleDeleteFolder}
        onOpenTrash={() => setIsTrashOpen(true)}
        onOpenTemplates={() => setIsTemplatesOpen(true)}
        savedFilters={[...savedFilters].sort((a, b) => Number(b.pinned) - Number(a.pinned))}
        activeFilterId={activeFilterId}
        onSelectFilter={handleSelectFilter}
        onNewFilter={handleNewFilter}
        onEditFilter={handleEditFilter}
        onDeleteFilter={handleDeleteFilter}
        onMoveFilter={handleMoveFilter}
        tags={userTags}
        tagCounts={tagCounts}
        activeTagId={activeTag?.id ?? null}
        onSelectTag={handleSelectTag}
        onOpenTags={() => setIsTagsOpen(true)}
        className="hidden md:flex"
      />

      {/* Main Task Pane / Calendar View */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-[#E4E8F2] bg-white px-4 py-2 dark:border-[#132E74] dark:bg-[#051A4D]">
          <button
            type="button"
            onClick={() => setViewMode("list")}
            className={`rounded-md px-3 py-1 text-sm ${viewMode === "list" ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]" : "text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]"}`}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setViewMode("calendar")}
            className={`rounded-md px-3 py-1 text-sm ${viewMode === "calendar" ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]" : "text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]"}`}
          >
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setViewMode("planner")}
            className={`rounded-md px-3 py-1 text-sm ${viewMode === "planner" ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]" : "text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]"}`}
          >
            Planner
          </button>
          <button
            type="button"
            onClick={() => setViewMode("board")}
            className={`rounded-md px-3 py-1 text-sm ${viewMode === "board" ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]" : "text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]"}`}
          >
            Board
          </button>
        </div>
        {viewMode === "board" ? (
          <BoardView
            columns={boardData?.columns ?? []}
            isLoading={isLoadingBoard}
            groupBy={boardGroupBy}
            onGroupByChange={(g) => setBoardGroupBy(g)}
            onMoveTask={handleMoveBoardTask}
            className="flex-1"
          />
        ) : viewMode === "planner" ? (
          <PlannerView className="flex-1" />
        ) : viewMode === "calendar" ? (
          <CalendarView
            items={calendarItems}
            isLoading={isLoadingCalendar}
            month={calendarMonth}
            onMonthChange={setCalendarMonth}
            onSelectTask={(id) => setSelectedTaskId(id)}
            includeDone={includeDone}
            onToggleIncludeDone={setIncludeDone}
            className="flex-1"
          />
        ) : (
          <TaskPane
            tasks={activeFilterId ? filterTasks : activeTag ? tagTasks : tasks}
            activeList={activeList}
            activeListId={activeListId}
            activeListName={activeFilterId ? (savedFilters.find((f) => f.id === activeFilterId)?.name) : activeTag ? `# ${activeTag.name}` : activeListName}
            activeFolder={activeFolder}
            folders={userFolders}
            lists={userLists}
            tags={userTags}
            selectedTaskId={selectedTaskId}
            selectedTaskIds={selectedTaskIds}
            onToggleSelectTask={handleToggleSelectTask}
            onSelectTask={(task) => setSelectedTaskId(task.id)}
            onToggleComplete={handleToggleComplete}
            onDeleteTask={handleDeleteTask}
            onAddTask={handleAddTask}
            onQuickAddTask={handleQuickAddTask}
            onOpenTemplates={() => setIsTemplatesOpen(true)}
            userId={userId}
            onUpdateTask={handleUpdateTask}
            onDuplicateTask={handleDuplicateTask}
            onArchiveTask={handleArchiveTask}
            onMoveTask={handleMovePanelTask}
            onReorderTask={handleReorderTask}
            isLoading={activeFilterId ? isLoadingFilter : activeTag ? isLoadingTag : (isLoadingTasks || isLoadingView)}
            showListName={PHASE4_VIEWS.has(activeList) || activeFilterId !== null || activeTag !== null}
            hasMore={activeFilterId ? filterHasMore : activeTag ? tagHasMore : viewHasMore}
            isLoadingMore={activeFilterId ? isLoadingFilter : activeTag ? isLoadingTag : isLoadingView}
            onLoadMore={activeFilterId ? handleLoadMoreFilter : activeTag ? handleLoadMoreTag : handleLoadMoreView}
          />
        )}
      </div>

      {/* Collapsible Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          folders={userFolders}
          lists={userLists}
          onClose={() => setSelectedTaskId(null)}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
          onMoveTask={handleMovePanelTask}
          onDuplicateTask={handleDuplicateTask}
          onArchiveTask={handleArchiveTask}
          onSkipTask={handleSkipTask}
          onSaveAsTemplate={handleSaveAsTemplate}
          onToggleSubtask={handleToggleSubtask}
          onAddSubtask={handleAddSubtask}
          onDeleteSubtask={handleDeleteSubtask}
          onToggleChecklistItem={handleToggleChecklistItem}
          onAddChecklistItem={handleAddChecklistItem}
          onDeleteChecklistItem={handleDeleteChecklistItem}
          onUpdateTags={handleUpdateTags}
          userId={userId}
        />
      )}

      {/* Streak Micro-Interaction Celebration */}
      <StreakCelebration
        active={isStreakActive}
        streakCount={streakCount}
        taskTitle={streakTaskTitle}
        onDismiss={() => setIsStreakActive(false)}
      />

      {/* Command Palette Accessible Dialog */}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onSelectList={setActiveList}
        onSelectFolder={setActiveFolder}
        onNewTask={() => {
          const input = document.querySelector<HTMLInputElement>("input[data-testid='quick-add-input']");
          input?.focus();
        }}
        onToggleTheme={onToggleTheme}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onOpenAuth={onOpenAuth}
        onOpenShortcuts={handleOpenShortcuts}
        onOpenTrash={() => setIsTrashOpen(true)}
        onOpenTemplates={() => setIsTemplatesOpen(true)}
        onOpenTask={handleOpenTaskFromSearch}
      />

      {/* Global Keyboard Shortcuts Modal */}
      <KeyboardShortcutsModal
        isOpen={isShortcutsOpen}
        onClose={() => setIsShortcutsOpen(false)}
      />

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeList={activeList}
        onSelectList={setActiveList}
        activeFolder={activeFolder}
        onCycleFolder={handleCycleFolder}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onNewTask={() => {
          const input = document.querySelector<HTMLInputElement>("input[data-testid='quick-add-input']");
          input?.focus();
        }}
        onToggleTheme={onToggleTheme}
      />

      {/* List Dialog Modal */}
      <FilterDialog
        isOpen={isFilterDialogOpen}
        onClose={() => setIsFilterDialogOpen(false)}
        mode={filterDialogMode}
        filterToEdit={filterToEdit}
        onSuccess={handleFilterSuccess}
      />

      <ListDialog
        isOpen={isListDialogOpen}
        onClose={() => setIsListDialogOpen(false)}
        mode={listDialogMode}
        listToEdit={listToEdit}
        defaultFolderId={listDialogFolderId}
        folders={userFolders}
        onSuccess={handleListSuccess}
      />

      {/* Folder Dialog Modal */}
      <FolderDialog
        isOpen={isFolderDialogOpen}
        onClose={() => setIsFolderDialogOpen(false)}
        mode={folderDialogMode}
        folderToEdit={folderToEdit}
        onSuccess={handleFolderSuccess}
      />

      {/* Floating Tactile Bulk Action Toolbar */}
      <BulkActionToolbar
        selectedCount={selectedTaskIds.size}
        totalCount={tasks.length}
        lists={userLists}
        onSelectAll={handleSelectAllTasks}
        onClearSelection={handleClearTaskSelection}
        onComplete={handleBulkComplete}
        onReopen={handleBulkReopen}
        onMoveToList={handleBulkMove}
        onSetPriority={handleBulkSetPriority}
        onArchive={handleBulkArchive}
        onDelete={handleBulkDelete}
        isSubmitting={isBulkSubmitting}
      />

      {/* Trash Modal */}
      <TrashModal
        isOpen={isTrashOpen}
        onClose={() => setIsTrashOpen(false)}
        onItemRestored={handleItemRestored}
        userId={userId}
      />

      {/* Complete-with-subtasks confirm (asked once per toggle action) */}
      <CompleteSubtasksDialog
        isOpen={pendingSubtasksComplete !== null}
        openCount={pendingSubtasksComplete?.openCount ?? 0}
        onConfirmAll={() => {
          const pending = pendingSubtasksComplete;
          setPendingSubtasksComplete(null);
          if (pending) runToggleComplete(pending.id, true);
        }}
        onConfirmSingle={() => {
          const pending = pendingSubtasksComplete;
          setPendingSubtasksComplete(null);
          if (pending) runToggleComplete(pending.id, false);
        }}
        onClose={() => setPendingSubtasksComplete(null)}
      />

      {/* Templates Modal */}
      <TemplatesModal
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
        lists={userLists}
        defaultListId={activeListId}
        onTemplateInstantiated={handleTemplateInstantiated}
      />

      {/* Tags Modal */}
      <TagsModal
        isOpen={isTagsOpen}
        onClose={() => setIsTagsOpen(false)}
        tags={userTags}
        tagCounts={tagCounts}
        userId={userId}
        activeTagId={activeTag?.id ?? null}
        onSelectTag={handleSelectTag}
        onTagsChanged={reloadTags}
      />
    </div>
  );
}

export function AppWorkspace(props: AppWorkspaceInnerProps) {
  return (
    <ToastProvider>
      <AppWorkspaceInner {...props} />
    </ToastProvider>
  );
}
