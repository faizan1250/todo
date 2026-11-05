"use client";

import * as React from "react";
import { useState, useCallback, useEffect, useMemo } from "react";
import { Sidebar } from "./sidebar";
import { TaskPane } from "./task-pane";
import { TaskDetailPanel } from "./task-detail-panel";
import { StreakCelebration } from "./streak-celebration";
import { CommandPalette } from "./command-palette";
import { KeyboardShortcutsModal } from "./keyboard-shortcuts-modal";
import { MobileNav } from "./mobile-nav";
import { ToastProvider, useToast } from "./toast-system";
import { ListDialog } from "./list-dialog";
import { FolderDialog } from "./folder-dialog";
import { BulkActionToolbar } from "./bulk-action-toolbar";
import { TrashModal } from "./trash-modal";
import { TemplatesModal } from "./templates-modal";
import { useAuth } from "@/components/auth";
import {
  getLists,
  getFolders,
  getTasks,
  getViewsCounts,
  getViewItems,
  createTask,
  quickAddTask,
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
  type BackendList,
  type BackendFolder,
  type BackendTask,
  type BackendViewCountsResponse,
} from "@/lib/api";
import {
  backendTaskToTaskItem,
  priorityUiToBackend,
  taskItemToBackendUpdateInput,
} from "@/lib/adapters";
import type { TaskItem, ListId, FolderId, Priority } from "./types";

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
  void user;

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

  // Modals state for Lists & Folders
  const [isListDialogOpen, setIsListDialogOpen] = useState(false);
  const [listDialogMode, setListDialogMode] = useState<"create" | "edit">("create");
  const [listToEdit, setListToEdit] = useState<BackendList | null>(null);
  const [listDialogFolderId, setListDialogFolderId] = useState<string | null>(null);

  const [isFolderDialogOpen, setIsFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<"create" | "edit">("create");
  const [folderToEdit, setFolderToEdit] = useState<BackendFolder | null>(null);

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

  // Library Modals State
  const [isTrashOpen, setIsTrashOpen] = useState(false);
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);

  // Streak State
  const [streakCount, setStreakCount] = useState(5);
  const [isStreakActive, setIsStreakActive] = useState(false);
  const [streakTaskTitle, setStreakTaskTitle] = useState("");

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

  const PHASE4_VIEWS = new Set(["overdue", "priority", "no-date", "all"]);

  // Load items for Phase 4 smart views via getViewItems
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!PHASE4_VIEWS.has(activeList)) return;
    let isMounted = true;
    setIsLoadingView(true);
    getViewItems(activeList, { limit: 50 })
      .then((res) => {
        if (!isMounted) return;
        const mapped = res.items.map((t) =>
          backendTaskToTaskItem(t as any, { listOverride: activeList as ListId })
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
    void loadTasks();
  }, [isAuthenticated, activeList, activeListId, loadTasks]);

  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;

    const queryParams: { listId?: string; include: string } = {
      include: "subtasks,checklist,tags",
    };
    if (activeListId) {
      queryParams.listId = activeListId;
    }

    getTasks(queryParams)
      .then((res) => {
        if (!isMounted) return;
        const mapped = res.items.map((t) => backendTaskToTaskItem(t));
        setTasks(mapped);
        if (mapped.length > 0) {
          setSelectedTaskId((prev) =>
            prev && mapped.some((t) => t.id === prev) ? prev : mapped[0].id
          );
        } else {
          setSelectedTaskId(null);
        }
        setIsLoadingTasks(false);
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

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated, activeListId, toast]);

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
        await bulkTasks(ids, "complete", { completeSubtasks: true });
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
  }, [isAuthenticated, selectedTaskIds, success, toast]);

  const handleBulkReopen = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    setIsBulkSubmitting(true);
    try {
      if (isAuthenticated) {
        await bulkTasks(ids, "reopen");
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
  }, [isAuthenticated, selectedTaskIds, success, toast]);

  const handleBulkMove = useCallback(
    async (targetListId: string) => {
      if (selectedTaskIds.size === 0) return;
      const ids = Array.from(selectedTaskIds);
      const targetList = userLists.find((l) => l.id === targetListId);
      setIsBulkSubmitting(true);
      try {
        if (isAuthenticated) {
          await bulkTasks(ids, "move", { listId: targetListId });
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
    [isAuthenticated, selectedTaskIds, userLists, success, toast]
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
          await bulkTasks(ids, "set_priority", { priority });
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
    [isAuthenticated, selectedTaskIds, success, toast]
  );

  const handleBulkArchive = useCallback(async () => {
    if (selectedTaskIds.size === 0) return;
    const ids = Array.from(selectedTaskIds);
    setIsBulkSubmitting(true);
    try {
      if (isAuthenticated) {
        await bulkTasks(ids, "archive");
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
  }, [isAuthenticated, selectedTaskId, selectedTaskIds, success, toast]);

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
        await bulkTasks(ids, "delete");
      }

      toast({
        title: "Deleted",
        message: `Moved ${ids.length} ${ids.length === 1 ? "task" : "tasks"} to Trash`,
        actionLabel: "Undo",
        onAction: async () => {
          try {
            if (isAuthenticated) {
              await Promise.all(ids.map((id) => restoreTrash("task", id)));
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
  }, [isAuthenticated, selectedTaskId, selectedTaskIds, tasks, success, toast]);

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

  const handleOpenShortcuts = useCallback(() => {
    setIsShortcutsOpen(true);
    externalOpenShortcuts?.();
  }, [externalOpenShortcuts]);

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
  const handleToggleComplete = useCallback(
    (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) return;

      const willComplete = !target.completed;

      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, completed: willComplete, updatedAt: "Just now" } : t))
      );

      if (willComplete) {
        setStreakCount((s) => s + 1);
        setStreakTaskTitle(target.title);
        setIsStreakActive(true);

        toast({
          title: "Task completed",
          message: `"${target.title}" marked done.`,
          type: "success",
          actionLabel: "Undo",
          onAction: () => {
            setTasks((prev) =>
              prev.map((t) => (t.id === id ? { ...t, completed: false, updatedAt: "Undone" } : t))
            );
            setStreakCount((s) => Math.max(1, s - 1));

            if (isAuthenticated && !id.startsWith("temp-")) {
              reopenTask(id).catch((err) => {
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
      } else {
        toast({
          message: `"${target.title}" marked active.`,
          actionLabel: "Undo",
          onAction: () => {
            setTasks((prev) =>
              prev.map((t) => (t.id === id ? { ...t, completed: true, updatedAt: "Re-done" } : t))
            );

            if (isAuthenticated && !id.startsWith("temp-")) {
              completeTask(id).catch((err) => {
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

      if (isAuthenticated && !id.startsWith("temp-")) {
        const apiCall = willComplete ? completeTask(id) : reopenTask(id);
        apiCall
          .then((updated) => {
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
      }
    },
    [tasks, isAuthenticated, toast]
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
    [tasks, selectedTaskId, isAuthenticated, toast]
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

      // N -> Quick-focus task creation
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        const input = document.querySelector<HTMLInputElement>("input[placeholder*='Add task']");
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
      } else {
        success(`Created task "${data.title}"`);
      }
    },
    [activeListId, userLists, isAuthenticated, success, toast]
  );

  const handleQuickAddTask = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      if (!isAuthenticated) {
        handleAddTask({
          title: trimmed,
          priority: "med",
          folder: activeFolder || "none",
          list: activeList === "completed" ? "today" : activeList,
        });
        return;
      }

      try {
        const created = await quickAddTask({
          text: trimmed,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
    [isAuthenticated, activeFolder, activeList, activeListId, handleAddTask, success]
  );

  const handleUpdateTask = useCallback(
    (updated: TaskItem) => {
      const prevTask = tasks.find((t) => t.id === updated.id);
      setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));

      if (isAuthenticated && !updated.id.startsWith("temp-") && !updated.id.startsWith("task-")) {
        updateTask(updated.id, taskItemToBackendUpdateInput(updated)).catch((err) => {
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
      }
    },
    [isAuthenticated, tasks, toast]
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
        try {
          await archiveTask(taskId);
          toast({
            title: "Task archived",
            message: `"${target.title}" moved to archive.`,
            actionLabel: "Undo",
            onAction: () => {
              setTasks((prev) => [target, ...prev]);
              setSelectedTaskId(target.id);
              unarchiveTask(taskId).catch((err) => {
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
    [tasks, selectedTaskId, isAuthenticated, toast]
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
        const apiCall = completed ? completeTask(subtaskId) : reopenTask(subtaskId);
        apiCall.catch((err) => {
          console.error("Failed to toggle subtask on backend:", err);
        });
      }
    },
    [isAuthenticated]
  );

  const handleAddSubtask = useCallback(
    (title: string, parentId: string) => {
      const targetBackendListId =
        activeListId || userLists.find((l) => l.isInbox)?.id || userLists[0]?.id;

      if (isAuthenticated && targetBackendListId && !parentId.startsWith("temp-") && !parentId.startsWith("task-")) {
        createTask({
          title,
          parentId,
          listId: targetBackendListId,
          priority: 1,
        }).catch((err) => {
          console.error("Failed to create subtask on backend:", err);
        });
      }
    },
    [isAuthenticated, activeListId, userLists]
  );

  const handleDeleteSubtask = useCallback(
    (subtaskId: string) => {
      if (isAuthenticated && !subtaskId.startsWith("st-") && !subtaskId.startsWith("temp-")) {
        deleteTask(subtaskId).catch((err) => {
          console.error("Failed to delete subtask on backend:", err);
        });
      }
    },
    [isAuthenticated]
  );

  const handleAddChecklistItem = useCallback(
    (text: string) => {
      if (
        isAuthenticated &&
        selectedTaskId &&
        !selectedTaskId.startsWith("temp-") &&
        !selectedTaskId.startsWith("task-")
      ) {
        createChecklistItem(selectedTaskId, text)
          .then((createdItem) => {
            setTasks((prev) =>
              prev.map((t) => {
                if (t.id !== selectedTaskId) return t;
                const updatedList = t.checklist.map((ci) =>
                  ci.text === text && ci.id.startsWith("ci-")
                    ? { ...ci, id: createdItem.id }
                    : ci
                );
                return { ...t, checklist: updatedList };
              })
            );
          })
          .catch((err) => {
            console.error("Failed to create checklist item on backend:", err);
          });
      }
    },
    [isAuthenticated, selectedTaskId]
  );

  const handleToggleChecklistItem = useCallback(
    (itemId: string, done: boolean) => {
      if (isAuthenticated && !itemId.startsWith("ci-")) {
        updateChecklistItem(itemId, { done }).catch((err) => {
          console.error("Failed to update checklist item on backend:", err);
        });
      }
    },
    [isAuthenticated]
  );

  const handleDeleteChecklistItem = useCallback(
    (itemId: string) => {
      if (isAuthenticated && !itemId.startsWith("ci-")) {
        deleteChecklistItem(itemId).catch((err) => {
          console.error("Failed to delete checklist item on backend:", err);
        });
      }
    },
    [isAuthenticated]
  );

  const handleUpdateTags = useCallback(
    (tagNames: string[], tagIds?: string[]) => {
      if (
        isAuthenticated &&
        selectedTaskId &&
        tagIds &&
        tagIds.length > 0 &&
        !selectedTaskId.startsWith("temp-") &&
        !selectedTaskId.startsWith("task-")
      ) {
        replaceTaskTags(selectedTaskId, tagIds).catch((err) => {
          console.error("Failed to replace tags on backend:", err);
        });
      }
    },
    [isAuthenticated, selectedTaskId]
  );

  const handleLoadMoreView = useCallback(async () => {
    if (!viewCursor || !viewHasMore) return;
    setIsLoadingView(true);
    try {
      const res = await getViewItems(activeList, { cursor: viewCursor, limit: 50 });
      const mapped = res.items.map((t) =>
        backendTaskToTaskItem(t as any, { listOverride: activeList as ListId })
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
          const input = document.querySelector<HTMLInputElement>("input[placeholder*='Add task']");
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
        className="hidden md:flex"
      />

      {/* Main Task Pane */}
      <TaskPane
        tasks={tasks}
        activeList={activeList}
        activeListId={activeListId}
        activeListName={activeListName}
        activeFolder={activeFolder}
        folders={userFolders}
        selectedTaskId={selectedTaskId}
        selectedTaskIds={selectedTaskIds}
        onToggleSelectTask={handleToggleSelectTask}
        onSelectTask={(task) => setSelectedTaskId(task.id)}
        onToggleComplete={handleToggleComplete}
        onDeleteTask={handleDeleteTask}
        onAddTask={handleAddTask}
        onQuickAddTask={handleQuickAddTask}
        isLoading={isLoadingTasks || isLoadingView}
        hasMore={viewHasMore}
        isLoadingMore={isLoadingView}
        onLoadMore={handleLoadMoreView}
      />

      {/* Collapsible Task Detail Panel */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          isOpen={!!selectedTask}
          folders={userFolders}
          onClose={() => setSelectedTaskId(null)}
          onUpdateTask={handleUpdateTask}
          onDeleteTask={handleDeleteTask}
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
          const input = document.querySelector<HTMLInputElement>("input[placeholder*='Add task']");
          input?.focus();
        }}
        onToggleTheme={onToggleTheme}
        onToggleSidebar={() => setIsSidebarCollapsed((prev) => !prev)}
        onOpenAuth={onOpenAuth}
        onOpenShortcuts={handleOpenShortcuts}
        onOpenTrash={() => setIsTrashOpen(true)}
        onOpenTemplates={() => setIsTemplatesOpen(true)}
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
          const input = document.querySelector<HTMLInputElement>("input[placeholder*='Add task']");
          input?.focus();
        }}
        onToggleTheme={onToggleTheme}
      />

      {/* List Dialog Modal */}
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
      />

      {/* Templates Modal */}
      <TemplatesModal
        isOpen={isTemplatesOpen}
        onClose={() => setIsTemplatesOpen(false)}
        lists={userLists}
        defaultListId={activeListId}
        onTemplateInstantiated={handleTemplateInstantiated}
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
