"use client";

import * as React from "react";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  Plus,
  Filter,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  X,
  FolderPlus,
  Loader2,
  Layers,
  Calendar,
  Flag,
  Folder,
  Tag,
  Repeat,
  Clock,
  Bookmark,
  MoreHorizontal,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useVirtualizer } from "@tanstack/react-virtual";
import { InsertionLine, SortableTaskRow, TaskRow } from "./task-row";
import { isNoopMove, moveNeighbors } from "@/lib/tasks/reorder";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { v7 as uuidv7 } from "uuid";
import { mutate } from "@/lib/data/mutate";
import { copy } from "@/lib/copy";
import { depthOfTask, planIndent, planOutdent } from "@/lib/tasks/indent";
import { useToast } from "./toast-system";
import { TaskContextMenu } from "./task-context-menu";
import {
  getSections,
  createSection,
  updateSection,
  deleteSection,
  restoreTrash,
  parseNaturalLanguageText,
  type BackendSection,
  type BackendFolder,
  type BackendList,
  type BackendTag,
  type ParsedTaskResult,
} from "@/lib/api";
import { formatEstimate, formatDueDate } from "@/lib/adapters";
import {
  ParsedChips,
  SuggestMenu,
  FirstTip,
  InboxExamples,
  buildSmartParse,
  removeChipFromText,
  resolveHourText,
  getActiveTrigger,
  filterSuggestions,
  applySuggestion,
  loadSharedParse,
  summarizeChips,
  safeTimezone,
  EMPTY_SMART_PARSE,
  EMPTY_INBOX_EXAMPLES,
  PLACEHOLDER_EXAMPLES,
  isSmartTypingEnabled,
  setSmartTypingEnabled,
  hasSeenSmartTip,
  markSmartTipSeen,
  type ListSummary,
  type ParsedChip,
  type SuggestItem,
  type TriggerChar,
} from "@/components/quickadd";
import { TaskRowSkeletonList } from "./task-skeleton";
import { EmptyState } from "./empty-state";
import type { TaskItem, ListId, FolderId, Priority } from "./types";

/** Target of a drag-reorder drop. sectionId undefined = keep current section. */
export interface ReorderTarget {
  sectionId: string | null | undefined;
  afterId: string | null;
  beforeId: string | null;
}

// Rows are h-14 (56px); lists longer than this virtualize (flat only).
const VIRTUALIZE_AFTER = 200;
const VIRTUAL_ROW_PX = 56;

// dnd-kit container ids. "flat" = ungrouped list (no sections exist);
// "unsectioned" = the no-section group when sections exist.
const FLAT_CONTAINER = "flat";
const UNSECTIONED_CONTAINER = "unsectioned";
const sectionContainerId = (sectionId: string) => `section:${sectionId}`;
const containerSectionId = (containerId: string): string | null | undefined => {
  if (containerId === FLAT_CONTAINER) return undefined;
  if (containerId === UNSECTIONED_CONTAINER) return null;
  return containerId.startsWith("section:") ? containerId.slice("section:".length) : undefined;
};

// Whole-group end-drop zones (drop anywhere on card padding/header → end of
// that group). One droppable per group, so ids never collide.
const endDropId = (containerId: string) => `drop::${containerId}::end`;
const parseEndDropId = (id: string): string | null => {
  const prefix = "drop::";
  const suffix = "::end";
  if (!id.startsWith(prefix) || !id.endsWith(suffix)) return null;
  return id.slice(prefix.length, -suffix.length);
};

interface ResolvedDrop {
  containerId: string;
  /** Final order of the target container with the dragged id placed. */
  resultIds: string[];
  /** Row under the cursor (null = group end zone). */
  overTaskId: string | null;
  placeBefore: boolean;
}

/** Pure drop resolution shared by onDragOver (insertion line) and onDragEnd. */
function resolveDrop(
  containers: Map<string, TaskItem[]>,
  taskContainer: Map<string, string>,
  activeId: string,
  overId: string
): ResolvedDrop | null {
  const endTarget = parseEndDropId(overId);
  if (endTarget) {
    const ids = (containers.get(endTarget) ?? []).map((t) => t.id).filter((id) => id !== activeId);
    return { containerId: endTarget, resultIds: [...ids, activeId], overTaskId: null, placeBefore: false };
  }
  const targetContainer = taskContainer.get(overId);
  if (!targetContainer) return null;
  const ids = (containers.get(targetContainer) ?? []).map((t) => t.id);
  if (taskContainer.get(activeId) === targetContainer) {
    const from = ids.indexOf(activeId);
    const to = ids.indexOf(overId);
    if (from < 0 || to < 0 || from === to) return null;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return { containerId: targetContainer, resultIds: next, overTaskId: overId, placeBefore: to < from };
  }
  const without = ids.filter((id) => id !== activeId);
  const at = Math.max(0, ids.indexOf(overId));
  return {
    containerId: targetContainer,
    resultIds: [...without.slice(0, at), activeId, ...without.slice(at)],
    overTaskId: overId,
    placeBefore: true,
  };
}

/** Group card wrapper that accepts drops onto its padding/header (→ end of group). */
function EndDropZone({
  containerId,
  className,
  children,
}: {
  containerId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: endDropId(containerId) });
  return (
    <div
      ref={setNodeRef}
      className={cn(className, isOver && "ring-2 ring-[#FD91CC]/50")}
    >
      {children}
    </div>
  );
}

interface TaskPaneProps {
  tasks: TaskItem[];
  activeList: ListId;
  activeListId?: string | null;
  activeListName?: string;
  activeFolder: FolderId | null;
  folders?: BackendFolder[];
  selectedTaskId: string | null;
  onSelectTask: (task: TaskItem) => void;
  onToggleComplete: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onAddTask: (newTask: {
    title: string;
    priority: Priority;
    folder: FolderId;
    list: ListId;
    sectionId?: string | null;
    dueDate?: string | null;
  }) => void;
  onQuickAddTask?: (text: string) => Promise<void> | void;
  userId?: string | null;
  onUpdateTask?: (task: TaskItem) => void;
  onDuplicateTask?: (id: string) => void;
  onArchiveTask?: (id: string) => void;
  onMoveTask?: (taskId: string, listId: string, sectionId: string | null) => void;
  /** User lists/tags for smart quick-add (@list suggestions, unknown-list check). */
  lists?: BackendList[];
  tags?: BackendTag[];
  /** Drag-reorder drop. sectionId undefined = same section, null = unsectioned. */
  onReorderTask?: (taskId: string, target: ReorderTarget) => void;
  isLoading?: boolean;
  showListName?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleSelectTask?: (id: string, shiftKey?: boolean, visibleTaskIds?: string[]) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  onLoadMore?: () => void;
  onOpenTemplates?: () => void;
}

export function TaskPane({
  tasks,
  activeList,
  activeListId = null,
  activeListName,
  activeFolder,
  folders = [],
  selectedTaskId,
  onSelectTask,
  onToggleComplete,
  onDeleteTask,
  onAddTask,
  onQuickAddTask,
  userId = null,
  onUpdateTask,
  onDuplicateTask,
  onArchiveTask,
  onMoveTask,
  onReorderTask,
  lists = [],
  tags = [],
  isLoading = false,
  showListName = false,
  selectedTaskIds,
  onToggleSelectTask,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
  onOpenTemplates,
}: TaskPaneProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");

  // Natural Language Parsed Preview State
  const [parsedPreview, setParsedPreview] = useState<ParsedTaskResult | null>(null);

  // Sections State
  const [sections, setSections] = useState<BackendSection[]>([]);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(() => new Set());
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [isSectionSubmitting, setIsSectionSubmitting] = useState(false);
  const [openSectionMenuId, setOpenSectionMenuId] = useState<string | null>(null);

  // Right-click / Shift+F10 context menu anchor (taskId + viewport position)
  const [menuState, setMenuState] = useState<{ taskId: string; x: number; y: number } | null>(null);

  const { toast, success } = useToast();

  // Section-targeted quick add state
  const [activeSectionForNewTask, setActiveSectionForNewTask] = useState<string | null>(null);
  const [sectionTaskTitle, setSectionTaskTitle] = useState("");
  const [sectionTaskPriority, setSectionTaskPriority] = useState<Priority>("med");

  // Main New Task form state
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("med");
  const [selectedFolderOverride, setSelectedFolderOverride] = useState<FolderId | null>(null);
  const [selectedDueDateOverride, setSelectedDueDateOverride] = useState<string | null>(null);
  const [isQuickAddFocused, setIsQuickAddFocused] = useState(false);
  const [openPicker, setOpenPicker] = useState<"due" | "priority" | "folder" | null>(null);

  // Smart quick-add (additive): chips, suggestions, tips. OFF = plain input.
  const [smartOn, setSmartOn] = useState(() => isSmartTypingEnabled());
  const [tipSeen, setTipSeen] = useState(() => hasSeenSmartTip());
  const [smartParse, setSmartParse] = useState(EMPTY_SMART_PARSE);
  const [dismissedTokens, setDismissedTokens] = useState<Set<string>>(() => new Set());
  const [suggest, setSuggest] = useState<{
    trigger: TriggerChar;
    query: string;
    start: number;
    index: number;
  } | null>(null);
  const [placeholderIdx, setPlaceholderIdx] = useState(0);

  // Done group: completed tasks collapse under a "Done (n)" header (collapsed by default)
  // View key resets the group back to collapsed when the viewed list/folder changes
  // (state adjusted during render — the recommended pattern over a reset effect).
  const doneGroupViewKey = `${activeListId ?? activeList}|${activeFolder ?? ""}`;
  const [doneGroupView, setDoneGroupView] = useState(doneGroupViewKey);
  const [isDoneExpanded, setIsDoneExpanded] = useState(false);
  if (doneGroupView !== doneGroupViewKey) {
    setDoneGroupView(doneGroupViewKey);
    setIsDoneExpanded(false);
  }

  const quickAddContainerRef = useRef<HTMLDivElement>(null);
  const quickAddInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);  const newSectionInputRef = useRef<HTMLInputElement>(null);
  const editSectionInputRef = useRef<HTMLInputElement>(null);
  const sectionTaskInputRef = useRef<HTMLInputElement>(null);

  // ---- Smart quick-add derived data + behavior (additive, submit-safe) ----
  const listSummaries: ListSummary[] = useMemo(
    () => lists.map((l) => ({ id: l.id, name: l.name, isInbox: l.isInbox })),
    [lists]
  );
  const tagNames = useMemo(() => tags.map((t) => t.name), [tags]);
  const listNames = useMemo(() => listSummaries.map((l) => l.name), [listSummaries]);

  const suggestItems = useMemo(
    () =>
      smartOn && suggest
        ? filterSuggestions(suggest.trigger, suggest.query, tagNames, listNames)
        : [],
    [smartOn, suggest, tagNames, listNames]
  );
  const clampedSuggestIndex = suggest
    ? Math.min(suggest.index, Math.max(suggestItems.length - 1, 0))
    : 0;

  // Full local parse via @todo/shared (lazy chunk) → chips. Additive only:
  // the backend /parse preview badges and the submit path are untouched.
  useEffect(() => {
    if (!smartOn || !newTitle.trim()) {
      setSmartParse(EMPTY_SMART_PARSE);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      loadSharedParse()
        .then((m) => {
          if (cancelled) return;
          try {
            const parsed = m.parseNaturalLanguage(newTitle, listSummaries, safeTimezone());
            if (!cancelled) {
              setSmartParse(buildSmartParse(newTitle, parsed.tokens, listSummaries, dismissedTokens));
            }
          } catch {
            if (!cancelled) setSmartParse(EMPTY_SMART_PARSE);
          }
        })
        .catch(() => {
          if (!cancelled) setSmartParse(EMPTY_SMART_PARSE);
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [newTitle, smartOn, listSummaries, dismissedTokens]);

  // Cycle placeholder examples while the input sits empty.
  useEffect(() => {
    if (!smartOn || newTitle.trim()) return;
    const id = setInterval(
      () => setPlaceholderIdx((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length),
      4000
    );
    return () => clearInterval(id);
  }, [smartOn, newTitle]);

  const focusInputAt = (pos: number | null) => {
    const el = quickAddInputRef.current;
    if (!el) return;
    el.focus();
    if (pos !== null) {
      const p = Math.max(0, Math.min(pos, el.value.length));
      requestAnimationFrame(() => {
        try {
          el.setSelectionRange(p, p);
        } catch {
          // Non-text input edge — focus alone is enough.
        }
      });
    }
  };

  const updateSuggest = (value: string, caret: number | null) => {
    if (!smartOn || caret === null) {
      setSuggest(null);
      return;
    }
    const t = getActiveTrigger(value, caret);
    setSuggest(t ? { trigger: t.trigger, query: t.query, start: t.start, index: 0 } : null);
  };

  const handleRemoveChip = (chip: ParsedChip) => {
    const { text, caret } = removeChipFromText(newTitle, chip);
    setDismissedTokens((prev) => new Set(prev).add(chip.raw.trim().toLowerCase()));
    setNewTitle(text);
    if (!text.trim()) setParsedPreview(null);
    focusInputAt(caret);
  };

  const handleResolveHour = (chip: ParsedChip, ampm: "am" | "pm") => {
    const hour = smartParse.ambiguousHour?.hour;
    if (hour === undefined || hour === null) return;
    const { text, caret } = resolveHourText(newTitle, chip, hour, ampm);
    setNewTitle(text);
    focusInputAt(caret);
  };

  const handleSelectSuggestion = (item: SuggestItem) => {
    const el = quickAddInputRef.current;
    const caret = el?.selectionStart ?? newTitle.length;
    const start = suggest?.start ?? caret;
    const { text, caret: next } = applySuggestion(newTitle, caret, start, item.insert);
    setNewTitle(text);
    setSuggest(null);
    focusInputAt(next);
  };

  const handleDismissTip = () => {
    markSmartTipSeen();
    setTipSeen(true);
  };

  const handleToggleSmart = () => {
    const next = !smartOn;
    setSmartOn(next);
    setSmartTypingEnabled(next);
    if (!next) {
      setSuggest(null);
      setSmartParse(EMPTY_SMART_PARSE);
    }
  };

  const handleFillExample = (example: string) => {
    setDismissedTokens(new Set());
    setNewTitle(example);
    setIsQuickAddFocused(true);
    focusInputAt(example.length);
  };

  const listTitles: Record<string, string> = {
    today: "Today",
    upcoming: "Upcoming",
    backlog: "Backlog",
    completed: "Completed",
    overdue: "Overdue",
    priority: "Priority",
    "no-date": "No Date",
    all: "All",
  };

  const resolvedTitle =
    activeListName ||
    listTitles[activeList] ||
    (activeList === "today"
      ? "Today"
      : activeList === "upcoming"
      ? "Upcoming"
      : activeList === "completed"
      ? "Completed"
      : "Tasks");

  const effectiveFolder: FolderId =
    selectedFolderOverride ??
    activeFolder ??
    (folders.length > 0 ? folders[0].id : "none");

  const effectiveDueDate: string =
    selectedDueDateOverride ??
    (activeList === "today" ? "Today" : activeList === "upcoming" ? "Tomorrow" : "");

  const quickAddPlaceholder =
    smartOn && !newTitle.trim()
      ? PLACEHOLDER_EXAMPLES[placeholderIdx % PLACEHOLDER_EXAMPLES.length]
      : `+ Add task to ${resolvedTitle}... (Press Enter)`;

  // Click outside listener to collapse quick-add and close open pickers
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (quickAddContainerRef.current && !quickAddContainerRef.current.contains(e.target as Node)) {
        setOpenPicker(null);
        if (!newTitle.trim()) {
          setIsQuickAddFocused(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [newTitle]);

  // Debounced natural language parsing for quick-add input preview
  useEffect(() => {
    const trimmed = newTitle.trim();
    if (!trimmed) {
      return;
    }

    const timer = setTimeout(() => {
      parseNaturalLanguageText(trimmed)
        .then((res) => {
          setParsedPreview(res);
        })
        .catch(() => {
          // Client-side fallback token extraction
          const tagsMatch = trimmed.match(/#([a-zA-Z0-9_-]+)/g);
          const tags = tagsMatch ? tagsMatch.map((t) => t.slice(1)) : [];
          const estMatch = trimmed.match(/~(\d+)(m|h)?/);
          let estimateMin: number | null = null;
          if (estMatch) {
            const num = parseInt(estMatch[1], 10);
            estimateMin = estMatch[2] === "h" ? num * 60 : num;
          }
          const prioMatch = trimmed.match(/!(urgent|high|med|low|4|3|2|1)/i);
          let priority = 1;
          if (prioMatch) {
            const p = prioMatch[1].toLowerCase();
            if (p === "urgent" || p === "4") priority = 4;
            else if (p === "high" || p === "3") priority = 3;
            else if (p === "med" || p === "2") priority = 2;
            else priority = 1;
          }
          const isRecurring = /every\s+(day|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)/i.test(trimmed);
          const recurrence = isRecurring ? { rrule: "FREQ=DAILY;INTERVAL=1", mode: "fixed" as const } : null;

          setParsedPreview({
            title: trimmed,
            dueAt: null,
            allDay: false,
            priority,
            tags,
            list: null,
            estimateMin,
            recurrence,
            reminders: [],
            tokens: [],
          });
        });
    }, 200);

    return () => clearTimeout(timer);
  }, [newTitle]);

  const selectedFolderObj =
    !effectiveFolder || effectiveFolder === "none"
      ? null
      : folders.find(
          (f) => f.id === effectiveFolder || f.name.toLowerCase() === effectiveFolder.toLowerCase()
        ) || null;

  // Fetch sections whenever activeListId changes
  useEffect(() => {
    if (!activeListId) return;

    let isMounted = true;

    getSections(activeListId)
      .then((data) => {
        if (isMounted) {
          setSections(data);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Failed to load sections for list:", err);
          setSections([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeListId]);

  const effectiveSections = useMemo(() => {
    return activeListId ? sections : [];
  }, [activeListId, sections]);

  // Focus input when adding section
  useEffect(() => {
    if (isAddingSection) {
      newSectionInputRef.current?.focus();
    }
  }, [isAddingSection]);

  // Focus input when editing section
  useEffect(() => {
    if (editingSectionId) {
      editSectionInputRef.current?.focus();
    }
  }, [editingSectionId]);

  // Focus input when adding task to section
  useEffect(() => {
    if (activeSectionForNewTask) {
      sectionTaskInputRef.current?.focus();
    }
  }, [activeSectionForNewTask]);

  // Filter tasks based on active list, active folder, search query, status, and priority
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 1. List filter
      if (activeListId) {
        // If viewing a specific backend list, match task.listId
        if (task.listId && task.listId !== activeListId) {
          return false;
        }
      } else if (activeList === "completed") {
        if (!task.completed) return false;
      } else {
        if (task.list !== activeList) return false;
      }

      // 2. Folder filter
      if (activeFolder && task.folder !== activeFolder) {
        return false;
      }

      // 3. Status filter
      if (statusFilter === "active" && task.completed) return false;
      if (statusFilter === "completed" && !task.completed) return false;

      // 4. Priority filter
      if (priorityFilter !== "all" && task.priority !== priorityFilter) {
        return false;
      }

      // 5. Search query
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchesTitle = task.title.toLowerCase().includes(query);
        const matchesTags = task.tags.some((t) => t.toLowerCase().includes(query));
        if (!matchesTitle && !matchesTags) return false;
      }

      return true;
    });
  }, [tasks, activeList, activeListId, activeFolder, statusFilter, priorityFilter, searchQuery]);

  // Group tasks into unsectioned vs sectioned
  // When showing "all", completed tasks live in the collapsed Done group below,
  // so section/flat lists only render active tasks (status tabs keep working).
  const doneTasks = useMemo(() => filteredTasks.filter((t) => t.completed), [filteredTasks]);
  const tasksForGrouping = useMemo(
    () => (statusFilter === "all" ? filteredTasks.filter((t) => !t.completed) : filteredTasks),
    [filteredTasks, statusFilter]
  );
  const showDoneGroup = statusFilter === "all" && doneTasks.length > 0;

  const { unsectionedTasks, sectionTasksMap } = useMemo(() => {
    if (effectiveSections.length === 0) {
      return { unsectionedTasks: tasksForGrouping, sectionTasksMap: new Map<string, TaskItem[]>() };
    }

    const map = new Map<string, TaskItem[]>();
    for (const s of effectiveSections) {
      map.set(s.id, []);
    }

    const unsectioned: TaskItem[] = [];

    for (const task of tasksForGrouping) {
      if (task.sectionId && map.has(task.sectionId)) {
        map.get(task.sectionId)!.push(task);
      } else {
        unsectioned.push(task);
      }
    }

    return { unsectionedTasks: unsectioned, sectionTasksMap: map };
  }, [tasksForGrouping, effectiveSections]);

  // ---- Drag-reorder (dnd-kit) ----
  // One sortable container per group: "flat" when no sections exist, otherwise
  // "unsectioned" + one per section. Cross-group drops move sectionId too.
  const containers = useMemo(() => {
    const map = new Map<string, TaskItem[]>();
    if (effectiveSections.length === 0) {
      map.set(FLAT_CONTAINER, tasksForGrouping);
    } else {
      map.set(UNSECTIONED_CONTAINER, unsectionedTasks);
      for (const s of effectiveSections) {
        map.set(sectionContainerId(s.id), sectionTasksMap.get(s.id) ?? []);
      }
    }
    return map;
  }, [effectiveSections, tasksForGrouping, unsectionedTasks, sectionTasksMap]);

  const taskContainer = useMemo(() => {
    const map = new Map<string, string>();
    for (const [cid, list] of containers) {
      for (const t of list) map.set(t.id, cid);
    }
    return map;
  }, [containers]);

  const dndSensors = useSensors(
    // Desktop: small distance gate so row clicks never start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // Touch: 250ms press-and-hold so scroll never fights the drag.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropMark, setDropMark] = useState<ResolvedDrop | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const keyboardDrag = useRef(false);

  // Virtualize long flat lists (fixed 56px rows). Grouped lists keep a normal
  // render — headers stay sticky-friendly and section drops stay measurable.
  const shouldVirtualize =
    effectiveSections.length === 0 && tasksForGrouping.length > VIRTUALIZE_AFTER;
  const rowVirtualizer = useVirtualizer({
    count: tasksForGrouping.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => VIRTUAL_ROW_PX,
    overscan: 8,
  });

  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    const isKeyboard = event.activatorEvent instanceof KeyboardEvent;
    keyboardDrag.current = isKeyboard;
    const cid = taskContainer.get(id);
    const list = cid ? containers.get(cid) ?? [] : [];
    const pos = list.findIndex((t) => t.id === id) + 1;
    const title = tasks.find((t) => t.id === id)?.title ?? "task";
    setAnnouncement(
      isKeyboard
        ? `Picked up '${title}', position ${pos} of ${list.length}. Arrow keys to reorder, Space to drop, Escape to cancel.`
        : `Picked up '${title}', position ${pos} of ${list.length}.`
    );
  };

  const handleDragOver = (event: DragOverEvent) => {
    const id = String(event.active.id);
    const overId = event.over ? String(event.over.id) : null;
    if (!overId || overId === id) {
      setDropMark(null);
      return;
    }
    const res = resolveDrop(containers, taskContainer, id, overId);
    setDropMark(res);
    if (res && keyboardDrag.current) {
      const { toIndex } = moveNeighbors(res.resultIds, id);
      const title = tasks.find((t) => t.id === id)?.title ?? "task";
      setAnnouncement(
        `Moved '${title}' to position ${toIndex + 1} of ${res.resultIds.length}. Space to drop, Escape to cancel.`
      );
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const id = String(event.active.id);
    setActiveId(null);
    setDropMark(null);
    keyboardDrag.current = false;
    if (!onReorderTask) return;
    const overId = event.over ? String(event.over.id) : null;
    if (!overId) {
      setAnnouncement("Reorder cancelled.");
      return;
    }
    if (overId === id) return; // dropped back on itself: silent no-op
    const res = resolveDrop(containers, taskContainer, id, overId);
    if (!res) {
      setAnnouncement("Reorder cancelled.");
      return;
    }
    const sourceContainer = taskContainer.get(id);
    const sourceIds = sourceContainer
      ? (containers.get(sourceContainer) ?? []).map((t) => t.id)
      : [];
    if (sourceContainer === res.containerId && isNoopMove(sourceIds, res.resultIds)) return;
    const { afterId, beforeId, toIndex } = moveNeighbors(res.resultIds, id);
    const sectionId =
      sourceContainer === res.containerId ? undefined : containerSectionId(res.containerId);
    onReorderTask(id, { sectionId, afterId, beforeId });
    const title = tasks.find((t) => t.id === id)?.title ?? "task";
    const sectionName =
      res.containerId.startsWith("section:")
        ? effectiveSections.find((s) => sectionContainerId(s.id) === res.containerId)?.name
        : null;
    setAnnouncement(
      `Moved '${title}' to position ${toIndex + 1} of ${res.resultIds.length}${
        sectionName ? ` in ${sectionName}` : ""
      }.`
    );
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setDropMark(null);
    keyboardDrag.current = false;
    setAnnouncement("Reorder cancelled.");
  };

  // Main task creation handler (rapid keyboard entry supported)
  const handleCreateTask = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    setNewTitle("");
    setParsedPreview(null);
    setSuggest(null);
    setDismissedTokens(new Set());
    setSelectedDueDateOverride(null);
    setSelectedFolderOverride(null);
    setOpenPicker(null);

    if (onQuickAddTask) {
      try {
        await onQuickAddTask(trimmed);
      } catch (err) {
        console.error("Quick add failed, falling back to standard create:", err);
        onAddTask({
          title: trimmed,
          priority: newPriority,
          folder: effectiveFolder,
          list: activeList === "completed" ? "today" : activeList,
          dueDate: effectiveDueDate || (activeList === "today" ? "Today" : null),
        });
      }
    } else {
      onAddTask({
        title: trimmed,
        priority: newPriority,
        folder: effectiveFolder,
        list: activeList === "completed" ? "today" : activeList,
        dueDate: effectiveDueDate || (activeList === "today" ? "Today" : null),
      });
    }

    // Keep focus so users can rapidly type 5 tasks in 10 seconds!
    quickAddInputRef.current?.focus();
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Suggest menu owns Up/Down/Enter/Tab/Escape while open.
    if (smartOn && suggest && suggestItems.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const dir = e.key === "ArrowDown" ? 1 : -1;
        setSuggest((s) =>
          s ? { ...s, index: (s.index + dir + suggestItems.length) % suggestItems.length } : s
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const item = suggestItems[clampedSuggestIndex];
        if (item) handleSelectSuggestion(item);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSuggest(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleCreateTask();
    } else if (e.key === "Escape") {
      setOpenPicker(null);
      setIsQuickAddFocused(false);
      quickAddInputRef.current?.blur();
    } else if (e.key === "Backspace" && smartOn && !suggest) {
      // Backspace at a chip's end boundary removes the chip (words stay).
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      if (start !== null && start === end) {
        const chip = smartParse.chips.find((c) => c.end === start);
        if (chip) {
          e.preventDefault();
          handleRemoveChip(chip);
        }
      }
    }
  };

  // Section-targeted task creation handler
  const handleCreateTaskForSection = (sectionId: string, e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = sectionTaskTitle.trim();
    if (!trimmed) return;

    onAddTask({
      title: trimmed,
      priority: sectionTaskPriority,
      folder: activeFolder || (folders.length > 0 ? folders[0].id : "none"),
      list: activeList === "completed" ? "today" : activeList,
      sectionId,
    });

    setSectionTaskTitle("");
    setActiveSectionForNewTask(null);
  };

  // Toggle section collapse
  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Add Section Submit (offline-first: mutate create, REST fallback)
  const handleAddSectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeListId) return;
    const trimmed = newSectionName.trim();
    if (!trimmed) return;

    const optimistic: BackendSection = {
      id: uuidv7(),
      userId: userId ?? "",
      listId: activeListId,
      name: trimmed,
      position: "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 0,
    };

    setIsSectionSubmitting(true);
    setSections((prev) => [...prev, optimistic]);
    setNewSectionName("");
    setIsAddingSection(false);
    try {
      if (userId) {
        await mutate(userId, {
          entity: "sections",
          op: "create",
          entityId: optimistic.id,
          patch: { name: trimmed, listId: activeListId },
        });
      } else {
        const created = await createSection(activeListId, trimmed);
        setSections((prev) => prev.map((s) => (s.id === optimistic.id ? created : s)));
      }
      success(`Created section "${trimmed}"`);
    } catch {
      // mutate failed (unknown local row, etc.) — REST is the fallback
      try {
        const created = await createSection(activeListId, trimmed);
        setSections((prev) => prev.map((s) => (s.id === optimistic.id ? created : s)));
        success(`Created section "${trimmed}"`);
      } catch (restErr) {
        console.error("Failed to create section:", restErr);
        setSections((prev) => prev.filter((s) => s.id !== optimistic.id));
        toast({
          title: "Could not create section",
          message: restErr instanceof Error ? restErr.message : "Please try again",
          type: "error",
        });
      }
    } finally {
      setIsSectionSubmitting(false);
    }
  };

  // Rename Section Submit (offline-first: mutate update, REST fallback)
  const handleRenameSectionSubmit = async (sectionId: string, e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = editSectionName.trim();
    const previous = sections.find((s) => s.id === sectionId);
    if (!trimmed) {
      setEditingSectionId(null);
      return;
    }
    if (!previous || previous.name === trimmed) {
      setEditingSectionId(null);
      return;
    }

    setIsSectionSubmitting(true);
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, name: trimmed } : s)));
    setEditingSectionId(null);
    try {
      if (userId) {
        await mutate(userId, {
          entity: "sections",
          op: "update",
          entityId: sectionId,
          patch: { name: trimmed },
        });
      } else {
        const updated = await updateSection(sectionId, trimmed);
        setSections((prev) => prev.map((s) => (s.id === sectionId ? updated : s)));
      }
    } catch {
      try {
        const updated = await updateSection(sectionId, trimmed);
        setSections((prev) => prev.map((s) => (s.id === sectionId ? updated : s)));
      } catch (restErr) {
        console.error("Failed to rename section:", restErr);
        setSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, name: previous.name } : s))
        );
        toast({
          title: "Could not rename section",
          message: restErr instanceof Error ? restErr.message : "Please try again",
          type: "error",
        });
      }
    } finally {
      setIsSectionSubmitting(false);
    }
  };

  // Delete Section (no confirm — Undo toast restores via mutate/REST)
  const handleDeleteSection = async (section: BackendSection) => {
    const snapshot = sections;
    setSections((prev) => prev.filter((s) => s.id !== section.id));
    setOpenSectionMenuId(null);

    const doRestDelete = async () => {
      await deleteSection(section.id);
    };
    try {
      if (userId) {
        await mutate(userId, { entity: "sections", op: "delete", entityId: section.id });
      } else {
        await doRestDelete();
      }
    } catch {
      try {
        await doRestDelete();
      } catch (restErr) {
        console.error("Failed to delete section:", restErr);
        setSections(snapshot);
        toast({
          title: "Could not delete section",
          message: restErr instanceof Error ? restErr.message : "Please try again",
          type: "error",
        });
        return;
      }
    }

    const restore = async () => {
      setSections(snapshot);
      try {
        if (userId) {
          await mutate(userId, { entity: "sections", op: "restore", entityId: section.id, patch: {} });
        } else {
          await restoreTrash("section", section.id);
        }
      } catch (err) {
        console.error("Failed to restore section:", err);
        try {
          await restoreTrash("section", section.id);
          setSections(snapshot);
        } catch {
          // Leave the optimistic state; the list refetches on next view change.
        }
      }
    };
    toast({
      title: "Section deleted",
      message: `"${section.name}" removed. Its tasks are now unsectioned.`,
      actionLabel: "Undo",
      onAction: () => {
        restore().catch((err) => console.error("Failed to restore section:", err));
      },
    });
  };

  // Nesting depth per task (for the subtle row indent + Tab planning).
  const taskDepthMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tasks) map.set(t.id, depthOfTask(tasks, t.id));
    return map;
  }, [tasks]);

  // Tab / Shift+Tab on a focused row: indent under the row above, or lift
  // back up. Persists through the shared update path (offline-first mutate
  // + REST fallback inside the workspace handler).
  const handleIndentTask = (id: string, direction: "indent" | "outdent", ordered: TaskItem[]) => {
    const task = tasks.find((t) => t.id === id);
    if (!task || !onUpdateTask) return;
    if (direction === "indent") {
      const plan = planIndent(ordered, tasks, id);
      if (!plan.ok) {
        if (plan.reason === "depth") {
          toast({ title: "Cannot indent further", message: copy.tasks.subtaskDepthLimit, type: "error" });
        }
        return;
      }
      onUpdateTask({ ...task, parentId: plan.parentId, updatedAt: "Just now" });
    } else {
      const plan = planOutdent(tasks, id);
      if (!plan.ok) return;
      onUpdateTask({ ...task, parentId: plan.parentId, updatedAt: "Just now" });
    }
    // Keep keyboard focus on the row across the re-render.
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(id)}"]`)?.focus();
    });
  };

  // Context-menu "Move to…" between sections of the current list.
  const handleMoveToSection = (taskId: string, sectionId: string | null) => {
    if (!activeListId) return;
    if (onMoveTask) {
      onMoveTask(taskId, activeListId, sectionId);
      return;
    }
    const task = tasks.find((t) => t.id === taskId);
    if (task && onUpdateTask) {
      onUpdateTask({ ...task, sectionId, updatedAt: "Just now" });
    }
  };

  const handleContextMenuTask = (task: TaskItem, anchor: { x: number; y: number }) => {
    setMenuState({ taskId: task.id, x: anchor.x, y: anchor.y });
  };

  // Shared row renderer. Sortable when the workspace provided onReorderTask
  // (done-group rows stay plain — completed items don't reorder).
  const renderTaskRow = (
    task: TaskItem,
    ordered: TaskItem[],
    containerId?: string,
    wrapperStyle?: React.CSSProperties
  ) => {
    const row = (
      <TaskRow
        key={task.id}
        task={task}
        depth={taskDepthMap.get(task.id) ?? 1}
        isSelected={selectedTaskId === task.id}
        isBulkSelected={selectedTaskIds?.has(task.id)}
        hasBulkSelection={(selectedTaskIds?.size ?? 0) > 0}
        showListName={showListName}
        onSelect={onSelectTask}
        onToggleComplete={onToggleComplete}
        onDelete={onDeleteTask}
        onContextMenuTask={handleContextMenuTask}
        onIndentTask={onUpdateTask ? (id, dir) => handleIndentTask(id, dir, ordered) : undefined}
        onToggleBulkSelect={
          onToggleSelectTask
            ? (id, shiftKey) =>
                onToggleSelectTask(
                  id,
                  shiftKey,
                  filteredTasks.map((t) => t.id)
                )
            : undefined
        }
      />
    );
    if (!onReorderTask || !containerId) return row;
    const mark =
      dropMark && dropMark.containerId === containerId && dropMark.overTaskId === task.id
        ? dropMark.placeBefore
          ? ("before" as const)
          : ("after" as const)
        : null;
    return (
      <SortableTaskRow
        key={task.id}
        task={task}
        depth={taskDepthMap.get(task.id) ?? 1}
        isSelected={selectedTaskId === task.id}
        isBulkSelected={selectedTaskIds?.has(task.id)}
        hasBulkSelection={(selectedTaskIds?.size ?? 0) > 0}
        showListName={showListName}
        onSelect={onSelectTask}
        onToggleComplete={onToggleComplete}
        onDelete={onDeleteTask}
        onContextMenuTask={handleContextMenuTask}
        onIndentTask={onUpdateTask ? (id, dir) => handleIndentTask(id, dir, ordered) : undefined}
        onToggleBulkSelect={
          onToggleSelectTask
            ? (id, shiftKey) =>
                onToggleSelectTask(
                  id,
                  shiftKey,
                  filteredTasks.map((t) => t.id)
                )
            : undefined
        }
        insertion={mark}
        wrapperStyle={wrapperStyle}
      />
    );
  };

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) ?? null : null;

  const menuTask = menuState ? tasks.find((t) => t.id === menuState.taskId) ?? null : null;

  // Collapsed-by-default "Done (n)" group for completed tasks in the current view.
  // Expand animates only when motion is allowed (motion-safe:* = instant otherwise).
  const renderDoneGroup = () => {
    if (!showDoneGroup) return null;
    return (
      <div className="overflow-hidden rounded-xl border border-[#E4E8F2] bg-white shadow-xs dark:border-[#132E74] dark:bg-[#082363]/50">
        <button
          type="button"
          onClick={() => setIsDoneExpanded((v) => !v)}
          aria-expanded={isDoneExpanded}
          aria-label={isDoneExpanded ? `Collapse ${doneTasks.length} completed tasks` : `Expand ${doneTasks.length} completed tasks`}
          className="flex w-full cursor-pointer items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[#F2F5FC]/70 dark:hover:bg-[#051A4D]/60"
        >
          {isDoneExpanded ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-[#5B6478] dark:text-[#9BB0D3]" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-[#5B6478] dark:text-[#9BB0D3]" />
          )}
          <span className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
            Done
          </span>
          <span className="rounded-full bg-[#F2F5FC] px-2 py-0.5 font-mono text-[10px] font-semibold text-[#5B6478] dark:bg-[#051A4D] dark:text-[#9BB0D3]">
            {doneTasks.length} {doneTasks.length === 1 ? "task" : "tasks"}
          </span>
        </button>
        {isDoneExpanded && (
          <div className="border-t border-[#E4E8F2] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-200 dark:border-[#132E74]">
            {doneTasks.map((task) => renderTaskRow(task, doneTasks))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={scrollRef} className="flex flex-1 flex-col overflow-y-auto bg-[#F2F5FC]/40 dark:bg-[#051A4D]/40">
      {/* Workspace Header Toolbar */}
      <div className="border-b border-[#E4E8F2] bg-white px-4 py-4 sm:px-6 dark:border-[#132E74] dark:bg-[#051A4D]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0B1220] dark:text-white">
                {resolvedTitle}
              </h1>
              {activeFolder && (
                <Badge variant="accent" className="capitalize text-[11px]">
                  {activeFolder}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
              {filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"} showing
              {effectiveSections.length > 0 && ` • ${effectiveSections.length} ${effectiveSections.length === 1 ? "section" : "sections"}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Add Section Action Button (shown when viewing a specific list) */}
            {activeListId && !isAddingSection && (
              <button
                type="button"
                onClick={() => setIsAddingSection(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#5B6478] hover:border-[#09318D] hover:text-[#09318D] transition-colors focus-ring-pink dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3] dark:hover:border-[#FD91CC] dark:hover:text-[#FFA8D7] cursor-pointer shrink-0"
                title="Add Section"
              >
                <Layers className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Add Section</span>
                <span className="sm:hidden">Section</span>
              </button>
            )}

            {/* Search Input Bar */}
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search tasks or tags..."
                className="w-full rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/60 py-1.5 pl-8 pr-3 text-xs placeholder:text-[#5B6478]/60 focus:border-[#09318D] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white dark:focus:bg-[#051A4D]"
              />
            </div>
          </div>
        </div>

        {/* Filter Controls Row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E4E8F2]/60 pt-3 dark:border-[#132E74]/60">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 rounded-lg border border-[#E4E8F2] bg-[#F2F5FC] p-0.5 dark:border-[#132E74] dark:bg-[#082363]">
            {(["all", "active", "completed"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-semibold capitalize transition-all cursor-pointer",
                  statusFilter === s
                    ? "bg-white text-[#09318D] shadow-xs dark:bg-[#0D41B4] dark:text-white"
                    : "text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
                )}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Priority Quick Filter */}
          <div className="flex items-center gap-1.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
            <Filter className="h-3 w-3" />
            <span>Priority:</span>
            {[
              { id: "all" as const, label: "All" },
              { id: "high" as const, label: "High" },
              { id: "med" as const, label: "Medium" },
              { id: "low" as const, label: "Low" },
            ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriorityFilter(p.id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                    priorityFilter === p.id
                      ? "bg-[#09318D] text-white font-semibold dark:bg-[#FD91CC] dark:text-[#051A4D]"
                      : "hover:bg-[#E4E8F2] text-[#5B6478] dark:hover:bg-[#082363] dark:text-[#9BB0D3]"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>

      {/* Main Workspace Body */}
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto w-full">
        {/* Sleek Single-Line Quick Add (Things 3 / Todoist style) */}
        <div
          ref={quickAddContainerRef}
          className={cn(
            "rounded-xl border bg-white transition-all duration-200 dark:bg-[#082363]",
            isQuickAddFocused || newTitle.trim().length > 0
              ? "border-[#09318D] p-3 shadow-soft-blue ring-2 ring-[#FD91CC]/40 dark:border-[#FD91CC]/60"
              : "border-[#E4E8F2] px-3.5 py-2 hover:border-[#CAD5E8] shadow-xs dark:border-[#132E74] dark:hover:border-[#1F459E]"
          )}
        >
          {/* Top Line: Input prompt with Plus icon and Enter badge */}
          <div className="relative flex items-center gap-2">
            <Plus
              className={cn(
                "h-4 w-4 shrink-0 transition-colors",
                isQuickAddFocused || newTitle.trim().length > 0
                  ? "text-[#09318D] dark:text-[#FD91CC]"
                  : "text-[#5B6478] dark:text-[#9BB0D3]"
              )}
            />
            <input
              ref={quickAddInputRef}
              type="text"
              value={newTitle}
              onFocus={() => setIsQuickAddFocused(true)}
              onChange={(e) => {
                const val = e.target.value;
                setNewTitle(val);
                if (!val.trim()) {
                  setParsedPreview(null);
                  setDismissedTokens(new Set());
                }
                updateSuggest(val, e.target.selectionStart);
              }}
              onSelect={(e) => updateSuggest(e.currentTarget.value, e.currentTarget.selectionStart)}
              onClick={(e) => updateSuggest(e.currentTarget.value, e.currentTarget.selectionStart)}
              onKeyDown={handleInputKeyDown}
              placeholder={quickAddPlaceholder}
              className="flex-1 bg-transparent py-0.5 text-xs sm:text-sm font-medium text-[#0B1220] placeholder:text-[#5B6478]/60 focus:outline-none dark:text-white dark:placeholder:text-[#9BB0D3]/60"
            />
            {!isQuickAddFocused && newTitle.trim().length === 0 && (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-[#E4E8F2] bg-[#F2F5FC] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#5B6478] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3]">
                ↵ Enter
              </kbd>
            )}
            {onOpenTemplates && (
              <button
                type="button"
                onClick={onOpenTemplates}
                title="New from template"
                aria-label="New from template"
                className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/60 px-2 py-1 text-[11px] font-semibold text-[#5B6478] transition-colors hover:border-[#09318D]/40 hover:text-[#09318D] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3] dark:hover:border-[#FD91CC]/50 dark:hover:text-[#FFA8D7] cursor-pointer"
              >
                <Bookmark className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Template</span>
              </button>
            )}
            {smartOn && suggest && suggestItems.length > 0 && (
              <div className="absolute inset-x-0 top-full z-30 mt-1">
                <SuggestMenu
                  items={suggestItems}
                  activeIndex={clampedSuggestIndex}
                  onSelect={handleSelectSuggestion}
                  onHover={(i) => setSuggest((s) => (s ? { ...s, index: i } : s))}
                />
              </div>
            )}
          </div>

          {/* Smart chips + one-time tip (additive display, submit-safe) */}
          {smartOn &&
            (smartParse.chips.length > 0 ||
              smartParse.unknownListQuery ||
              smartParse.ambiguousHour) && (
              <div className="mt-2">
                <ParsedChips
                  chips={smartParse.chips}
                  unknownListQuery={smartParse.unknownListQuery}
                  ambiguousHour={smartParse.ambiguousHour}
                  onRemoveChip={handleRemoveChip}
                  onResolveHour={handleResolveHour}
                />
              </div>
            )}
          {smartOn && !tipSeen && newTitle.trim().length > 0 && smartParse.chips.length > 0 && (
            <div className="mt-1.5">
              <FirstTip
                summary={summarizeChips(smartParse.chips)}
                onDismiss={handleDismissTip}
              />
            </div>
          )}

          {/* Natural Language Token Preview Badges */}
          {newTitle.trim().length > 0 && parsedPreview && (parsedPreview.tags?.length > 0 || parsedPreview.dueAt || parsedPreview.estimateMin || parsedPreview.recurrence || (parsedPreview.priority && parsedPreview.priority > 1) || parsedPreview.list) && (
            <div data-testid="quick-add-preview" className="mt-2 flex flex-wrap items-center gap-1.5 animate-in fade-in duration-150">
              <span className="text-[10px] font-mono font-medium text-[#5B6478]/80 dark:text-[#9BB0D3]/80">
                Parsed:
              </span>
              {parsedPreview.tags?.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded bg-[#09318D]/10 px-1.5 py-0.5 text-[10px] font-mono text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]">
                  <Tag className="h-2.5 w-2.5" />
                  <span>#{t}</span>
                </span>
              ))}
              {Boolean(parsedPreview.dueAt) && (
                <span className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-mono text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                  <Calendar className="h-2.5 w-2.5" />
                  <span>{formatDueDate(parsedPreview.dueAt) || "Scheduled"}</span>
                </span>
              )}
              {Boolean(parsedPreview.estimateMin) && (
                <span className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-mono text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                  <Clock className="h-2.5 w-2.5" />
                  <span>~{formatEstimate(parsedPreview.estimateMin)}</span>
                </span>
              )}
              {Boolean(parsedPreview.recurrence) && (
                <span className="inline-flex items-center gap-1 rounded bg-[#FD91CC]/20 px-1.5 py-0.5 text-[10px] font-mono text-[#09318D] dark:text-[#FD91CC]">
                  <Repeat className="h-2.5 w-2.5" />
                  <span>Repeat</span>
                </span>
              )}
              {Boolean(parsedPreview.priority && parsedPreview.priority >= 3) && (
                <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-mono text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                  <Flag className="h-2.5 w-2.5" />
                  <span>Priority: {parsedPreview.priority >= 4 ? "Urgent" : "High"}</span>
                </span>
              )}
              {Boolean(parsedPreview.list) && (
                <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  <span>@{parsedPreview.list?.name}</span>
                </span>
              )}
            </div>
          )}

          {/* Focused State: Gently reveals subtle inline chips below the input */}
          {(isQuickAddFocused || newTitle.trim().length > 0) && (
            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-[#E4E8F2]/70 pt-2 dark:border-[#132E74]/70">
              <div className="flex flex-wrap items-center gap-1.5">
                {/* 1. Due Date Chip */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenPicker(openPicker === "due" ? null : "due")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                      effectiveDueDate
                        ? "border-[#09318D]/30 bg-[#09318D]/5 text-[#09318D] dark:border-[#FD91CC]/30 dark:bg-[#FD91CC]/10 dark:text-[#FFA8D7]"
                        : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3]"
                    )}
                  >
                    <Calendar className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
                    <span>{effectiveDueDate || "Due date"}</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                  {openPicker === "due" && (
                    <div className="absolute left-0 top-full mt-1 z-30 min-w-[150px] rounded-lg border border-[#E4E8F2] bg-white p-1 shadow-md dark:border-[#132E74] dark:bg-[#051A4D]">
                      {[
                        { label: "No due date", value: "" },
                        { label: "Today", value: "Today" },
                        { label: "Tomorrow", value: "Tomorrow" },
                        { label: "Next week", value: "Next week" },
                      ].map((opt) => (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => {
                            setSelectedDueDateOverride(opt.value);
                            setOpenPicker(null);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs text-left cursor-pointer",
                            effectiveDueDate === opt.value
                              ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                              : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                          )}
                        >
                          <span>{opt.label}</span>
                          {effectiveDueDate === opt.value && <Check className="h-3.5 w-3.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 2. Priority Chip */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenPicker(openPicker === "priority" ? null : "priority")}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                      newPriority === "high"
                        ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
                        : newPriority === "med"
                        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400"
                        : "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-400"
                    )}
                  >
                    <Flag className="h-3.5 w-3.5" />
                    <span className="capitalize">{newPriority} priority</span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                  {openPicker === "priority" && (
                    <div className="absolute left-0 top-full mt-1 z-30 min-w-[130px] rounded-lg border border-[#E4E8F2] bg-white p-1 shadow-md dark:border-[#132E74] dark:bg-[#051A4D]">
                      {[
                        { id: "low" as const, label: "Low", dot: "bg-blue-500" },
                        { id: "med" as const, label: "Medium", dot: "bg-amber-500" },
                        { id: "high" as const, label: "High", dot: "bg-rose-500" },
                      ].map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setNewPriority(p.id);
                            setOpenPicker(null);
                          }}
                          className={cn(
                            "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-left cursor-pointer",
                            newPriority === p.id
                              ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                              : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                          )}
                        >
                          <span className={cn("h-2 w-2 rounded-full shrink-0", p.dot)} />
                          <span className="flex-1">{p.label}</span>
                          {newPriority === p.id && <Check className="h-3.5 w-3.5" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* 3. Folder Chip (Dynamic User Folders) */}
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setOpenPicker(openPicker === "folder" ? null : "folder")}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#E4E8F2] bg-white px-2 py-1 text-xs font-medium text-[#5B6478] hover:bg-[#F2F5FC] transition-all cursor-pointer focus-ring-pink dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3]"
                  >
                    <Folder className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: selectedFolderObj?.color || "#94A3B8" }}
                    />
                    <span className="truncate max-w-[120px]">
                      {selectedFolderObj ? selectedFolderObj.name : effectiveFolder && effectiveFolder !== "none" ? effectiveFolder : "No folder"}
                    </span>
                    <ChevronDown className="h-3 w-3 opacity-60" />
                  </button>
                  {openPicker === "folder" && (
                    <div className="absolute left-0 top-full mt-1 z-30 min-w-[170px] max-h-52 overflow-y-auto rounded-lg border border-[#E4E8F2] bg-white p-1 shadow-md dark:border-[#132E74] dark:bg-[#051A4D]">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFolderOverride("none");
                          setOpenPicker(null);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-left cursor-pointer",
                          !effectiveFolder || effectiveFolder === "none"
                            ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                            : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                        )}
                      >
                        <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                        <span className="flex-1">No folder</span>
                        {(!effectiveFolder || effectiveFolder === "none") && <Check className="h-3.5 w-3.5" />}
                      </button>
                      {folders.map((f) => {
                        const isSelected = effectiveFolder === f.id || effectiveFolder.toLowerCase() === f.name.toLowerCase();
                        return (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => {
                              setSelectedFolderOverride(f.id);
                              setOpenPicker(null);
                            }}
                            className={cn(
                              "flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-xs text-left cursor-pointer",
                              isSelected
                                ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                                : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                            )}
                          >
                            <span
                              className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: f.color || "#09318D" }}
                            />
                            <span className="flex-1 truncate">{f.name}</span>
                            {isSelected && <Check className="h-3.5 w-3.5" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Right Side: Esc hint + Add Button */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={smartOn}
                  aria-label="Toggle smart typing"
                  title="Smart typing: detect dates, tags and estimates as you type"
                  onClick={handleToggleSmart}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors cursor-pointer focus-ring-pink",
                    smartOn
                      ? "border-[#09318D]/30 bg-[#09318D]/5 text-[#09318D] dark:border-[#FD91CC]/40 dark:bg-[#FD91CC]/10 dark:text-[#FFA8D7]"
                      : "border-[#E4E8F2] text-[#5B6478]/60 dark:border-[#132E74] dark:text-[#9BB0D3]/50"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      smartOn ? "bg-current" : "bg-current opacity-40"
                    )}
                  />
                  Smart
                </button>
                <span className="hidden sm:inline text-[11px] text-[#5B6478]/70 dark:text-[#9BB0D3]/60 font-mono">
                  Esc to cancel
                </span>
                <button
                  type="button"
                  onClick={() => handleCreateTask()}
                  disabled={!newTitle.trim()}
                  className="btn-primary-depth inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-xs disabled:opacity-40 cursor-pointer focus-ring-pink"
                >
                  <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                  <span>Add Task</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Inline Add Section Form (Top) */}
        {isAddingSection && (
          <form
            onSubmit={handleAddSectionSubmit}
            className="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#09318D]/40 bg-[#09318D]/5 p-3 dark:border-[#FD91CC]/40 dark:bg-[#FD91CC]/5"
          >
            <Layers className="h-4 w-4 text-[#09318D] dark:text-[#FD91CC]" />
            <input
              ref={newSectionInputRef}
              type="text"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Section Name (e.g., In Progress, Backlog, Ready for Review)..."
              disabled={isSectionSubmitting}
              className="flex-1 bg-transparent text-sm font-semibold text-[#0B1220] placeholder:text-[#5B6478]/70 focus:outline-none dark:text-white dark:placeholder:text-[#9BB0D3]/60"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                disabled={isSectionSubmitting || !newSectionName.trim()}
                className="btn-primary-depth inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-xs disabled:opacity-40 cursor-pointer focus-ring-pink"
              >
                {isSectionSubmitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span>Save Section</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingSection(false);
                  setNewSectionName("");
                }}
                disabled={isSectionSubmitting}
                className="rounded-lg border border-[#E4E8F2] bg-white p-1.5 text-xs text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* Task Rows List with Optional Section Grouping */}
        <DndContext
          sensors={dndSensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
        {isLoading ? (
          <TaskRowSkeletonList count={5} />
        ) : filteredTasks.length === 0 ? (
          searchQuery.trim().length > 0 ? (
            <EmptyState
              type="search"
              searchQuery={searchQuery}
              onAction={() => setSearchQuery("")}
              actionLabel="Clear search"
              secondaryAction={
                statusFilter !== "all" || priorityFilter !== "all"
                  ? () => {
                      setStatusFilter("all");
                      setPriorityFilter("all");
                    }
                  : undefined
              }
              secondaryActionLabel="Reset filters"
            />
          ) : statusFilter !== "all" || priorityFilter !== "all" ? (
            <EmptyState
              type="filter"
              onAction={() => {
                setStatusFilter("all");
                setPriorityFilter("all");
              }}
              actionLabel="Reset filters"
            />
          ) : (
            <>
              {smartOn &&
                !searchQuery.trim() &&
                statusFilter === "all" &&
                priorityFilter === "all" && (
                  <InboxExamples examples={EMPTY_INBOX_EXAMPLES} onFill={handleFillExample} />
                )}
              <EmptyState
                activeList={activeList}
                activeFolder={activeFolder}
                onAction={() => {
                const input = document.querySelector<HTMLInputElement>(
                  "input[placeholder*='Add task']"
                );
                input?.focus();
              }}
              actionLabel={
                activeList === "completed"
                  ? "View active tasks"
                  : activeFolder
                  ? `Create task in ${activeFolder}`
                  : "Create a task"
              }
            />
            </>
          )
        ) : effectiveSections.length === 0 ? (
          /* Render Flat Task List when no sections exist */
          <div className="space-y-3">
            {tasksForGrouping.length > 0 && (
              <EndDropZone
                containerId={FLAT_CONTAINER}
                className="rounded-xl border border-[#E4E8F2] bg-white shadow-xs dark:border-[#132E74] dark:bg-[#082363]/50 overflow-hidden"
              >
                <SortableContext
                  items={tasksForGrouping.map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {shouldVirtualize ? (
                    <div
                      style={{
                        height: rowVirtualizer.getTotalSize(),
                        position: "relative",
                      }}
                    >
                      {rowVirtualizer.getVirtualItems().map((vi) => {
                        const task = tasksForGrouping[vi.index];
                        if (!task) return null;
                        return renderTaskRow(task, tasksForGrouping, FLAT_CONTAINER, {
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vi.start}px)`,
                        });
                      })}
                      {dropMark?.containerId === FLAT_CONTAINER && !dropMark.overTaskId && (
                        <InsertionLine />
                      )}
                    </div>
                  ) : (
                    <>
                      {tasksForGrouping.map((task) =>
                        renderTaskRow(task, tasksForGrouping, FLAT_CONTAINER)
                      )}
                      {dropMark?.containerId === FLAT_CONTAINER && !dropMark.overTaskId && (
                        <InsertionLine />
                      )}
                    </>
                  )}
                </SortableContext>
              </EndDropZone>
            )}
            {renderDoneGroup()}
          </div>
        ) : (
          /* Render Collapsible Sections Grouping */
          <div className="space-y-6">
            {/* 1. Unsectioned Tasks First */}
            {unsectionedTasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                  <span>Unsectioned Tasks</span>
                  <span className="rounded-full bg-[#F2F5FC] px-2 py-0.5 font-mono text-[10px] text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]">
                    {unsectionedTasks.length}
                  </span>
                </div>
                <EndDropZone
                  containerId={UNSECTIONED_CONTAINER}
                  className="rounded-xl border border-[#E4E8F2] bg-white shadow-xs dark:border-[#132E74] dark:bg-[#082363]/50 overflow-hidden"
                >
                  <SortableContext
                    items={unsectionedTasks.map((t) => t.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    {unsectionedTasks.map((task) =>
                      renderTaskRow(task, unsectionedTasks, UNSECTIONED_CONTAINER)
                    )}
                    {dropMark?.containerId === UNSECTIONED_CONTAINER && !dropMark.overTaskId && (
                      <InsertionLine />
                    )}
                  </SortableContext>
                </EndDropZone>
              </div>
            )}

            {/* 2. Sectioned Tasks */}
            {effectiveSections.map((section) => {
              const sectionTasks = sectionTasksMap.get(section.id) || [];
              const isCollapsed = collapsedSectionIds.has(section.id);
              const isEditing = editingSectionId === section.id;
              const isAddingTaskHere = activeSectionForNewTask === section.id;

              return (
                <EndDropZone
                  key={section.id}
                  containerId={sectionContainerId(section.id)}
                  className="rounded-xl border border-[#E4E8F2] bg-white/70 p-3 shadow-xs dark:border-[#132E74] dark:bg-[#082363]/60 transition-all motion-reduce:transition-none"
                >
                  {/* Collapsible Section Header */}
                  <div className="flex items-center justify-between gap-2 pb-2">
                    {/* Left: Collapse Toggle + Section Name */}
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapse(section.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] cursor-pointer"
                        aria-label={isCollapsed ? `Expand section ${section.name}` : `Collapse section ${section.name}`}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {isEditing ? (
                        <form
                          onSubmit={(e) => handleRenameSectionSubmit(section.id, e)}
                          className="flex items-center gap-1.5 flex-1 max-w-sm"
                        >
                          <input
                            ref={editSectionInputRef}
                            type="text"
                            value={editSectionName}
                            onChange={(e) => setEditSectionName(e.target.value)}
                            disabled={isSectionSubmitting}
                            className="flex-1 rounded border border-[#09318D] bg-white px-2 py-0.5 text-xs font-bold text-[#0B1220] focus:outline-none dark:border-[#FD91CC] dark:bg-[#051A4D] dark:text-white"
                          />
                          <button
                            type="submit"
                            disabled={isSectionSubmitting || !editSectionName.trim()}
                            className="rounded p-1 text-[#09318D] hover:bg-[#E4E8F2] dark:text-[#FD91CC] cursor-pointer"
                            title="Save"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSectionId(null)}
                            disabled={isSectionSubmitting}
                            className="rounded p-1 text-[#5B6478] hover:bg-[#E4E8F2] dark:text-[#9BB0D3] cursor-pointer"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      ) : (
                        <div
                          onDoubleClick={() => {
                            setEditingSectionId(section.id);
                            setEditSectionName(section.name);
                          }}
                          className="flex items-center gap-2 cursor-pointer select-none truncate"
                          title="Double-click to rename"
                        >
                          <span className="text-xs sm:text-sm font-bold text-[#0B1220] dark:text-white truncate">
                            {section.name}
                          </span>
                          {/* Task count pill */}
                          <span className="rounded-full bg-[#F2F5FC] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#5B6478] dark:bg-[#051A4D] dark:text-[#9BB0D3]">
                            {sectionTasks.length} {sectionTasks.length === 1 ? "task" : "tasks"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right: Section Actions Toolbar */}
                    <div className="flex items-center gap-1">
                      {/* [+ Add Task to Section] */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isCollapsed) {
                            toggleSectionCollapse(section.id);
                          }
                          setActiveSectionForNewTask(
                            activeSectionForNewTask === section.id ? null : section.id
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#09318D] hover:bg-[#09318D]/10 transition-colors dark:text-[#FFA8D7] dark:hover:bg-[#FD91CC]/20 cursor-pointer"
                        title="Add task to this section"
                      >
                        <Plus className="h-3 w-3" />
                        <span className="hidden sm:inline">Add task</span>
                      </button>

                      {/* Section Options Menu (rename / delete) */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() =>
                            setOpenSectionMenuId(openSectionMenuId === section.id ? null : section.id)
                          }
                          aria-label={`Section options for ${section.name}`}
                          aria-expanded={openSectionMenuId === section.id}
                          aria-haspopup="menu"
                          className="flex h-7 w-7 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] cursor-pointer"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                        {openSectionMenuId === section.id && (
                          <>
                            <button
                              type="button"
                              aria-hidden="true"
                              tabIndex={-1}
                              onClick={() => setOpenSectionMenuId(null)}
                              className="fixed inset-0 z-40 cursor-default"
                            />
                            <div
                              role="menu"
                              aria-label={`Section options for ${section.name}`}
                              className="absolute right-0 top-full z-50 mt-1 w-44 rounded-xl border border-[#E4E8F2] bg-white p-1 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D] animate-in fade-in zoom-in-95 duration-100"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenSectionMenuId(null);
                                  setEditingSectionId(section.id);
                                  setEditSectionName(section.name);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#0B1220] hover:bg-[#F2F5FC] transition-colors cursor-pointer dark:text-[#E4E8F2] dark:hover:bg-[#082363]"
                              >
                                <Pencil className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
                                <span>Rename section</span>
                              </button>
                              <hr className="my-1 border-[#E4E8F2] dark:border-[#132E74]" />
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleDeleteSection(section)}
                                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer dark:text-rose-400 dark:hover:bg-rose-950/40"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                                <span>Delete section</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Collapsible Section Body */}
                  {!isCollapsed && (
                    <div className="mt-2 space-y-2">
                      {/* Inline Quick Add Task for this Section */}
                      {isAddingTaskHere && (
                        <form
                          onSubmit={(e) => handleCreateTaskForSection(section.id, e)}
                          className="flex items-center gap-2 rounded-lg border border-[#09318D]/30 bg-white p-2 shadow-xs dark:border-[#FD91CC]/30 dark:bg-[#051A4D]"
                        >
                          <input
                            ref={sectionTaskInputRef}
                            type="text"
                            value={sectionTaskTitle}
                            onChange={(e) => setSectionTaskTitle(e.target.value)}
                            placeholder={`Task in "${section.name}"...`}
                            className="flex-1 bg-transparent px-1 text-xs font-medium text-[#0B1220] placeholder:text-[#5B6478]/60 focus:outline-none dark:text-white"
                          />
                          {/* Priority Picker */}
                          <div className="flex items-center gap-1">
                            {[
                              { id: "high" as const, label: "High" },
                              { id: "med" as const, label: "Medium" },
                              { id: "low" as const, label: "Low" },
                            ].map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setSectionTaskPriority(p.id)}
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors",
                                  sectionTaskPriority === p.id
                                    ? "bg-[#09318D] text-white font-semibold dark:bg-[#FD91CC] dark:text-[#051A4D]"
                                    : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3]"
                                )}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          <button
                            type="submit"
                            disabled={!sectionTaskTitle.trim()}
                            className="btn-primary-depth inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40 cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                            <span>Add</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSectionForNewTask(null);
                              setSectionTaskTitle("");
                            }}
                            className="rounded p-1 text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </form>
                      )}

                      {/* Section Tasks */}
                      {sectionTasks.length === 0 ? (
                        <div className="py-3 text-center text-xs text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic">
                          No tasks in this section yet. Click &quot;Add task&quot; to create one.
                          {dropMark?.containerId === sectionContainerId(section.id) && (
                            <InsertionLine />
                          )}
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[#E4E8F2] bg-white shadow-xs dark:border-[#132E74] dark:bg-[#082363]/50 overflow-hidden">
                          <SortableContext
                            items={sectionTasks.map((t) => t.id)}
                            strategy={verticalListSortingStrategy}
                          >
                            {sectionTasks.map((task) =>
                              renderTaskRow(task, sectionTasks, sectionContainerId(section.id))
                            )}
                            {dropMark?.containerId === sectionContainerId(section.id) &&
                              !dropMark.overTaskId && <InsertionLine />}
                          </SortableContext>
                        </div>
                      )}
                    </div>
                  )}
                </EndDropZone>
              );
            })}
            {renderDoneGroup()}
          </div>
        )}
          <DragOverlay dropAnimation={null}>
            {activeTask && (
              <div
                aria-hidden="true"
                className="pointer-events-none rounded-xl bg-white shadow-[0_8px_24px_rgba(9,49,141,0.28)] ring-1 ring-[#09318D]/30 motion-safe:transition-shadow motion-safe:duration-150 motion-reduce:transition-none dark:bg-[#082363] dark:ring-[#FD91CC]/40"
              >
                <TaskRow
                  task={activeTask}
                  depth={taskDepthMap.get(activeTask.id) ?? 1}
                  onSelect={() => {}}
                  onToggleComplete={() => {}}
                  onDelete={() => {}}
                />
              </div>
            )}
          </DragOverlay>
          <div role="status" aria-live="polite" className="sr-only">
            {announcement}
          </div>
        </DndContext>

        {/* Bottom [+ Add Section] Button (When viewing a specific backend list) */}
        {activeListId && !isAddingSection && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsAddingSection(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#E4E8F2] bg-white/40 py-3 text-xs font-semibold text-[#5B6478] hover:border-[#09318D] hover:bg-white hover:text-[#09318D] transition-all dark:border-[#132E74] dark:bg-[#082363]/40 dark:text-[#9BB0D3] dark:hover:border-[#FD91CC] dark:hover:text-[#FFA8D7] cursor-pointer"
            >
              <FolderPlus className="h-4 w-4" />
              <span>Add New Section</span>
            </button>
          </div>
        )}

        {hasMore && (
          <div className="pt-2 flex justify-center">
            <button
              type="button"
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="rounded-lg border border-[#E4E8F2] bg-white px-4 py-2 text-xs font-semibold text-[#09318D] hover:bg-[#F2F5FC] transition-colors dark:border-[#132E74] dark:bg-[#082363] dark:text-[#FFA8D7] cursor-pointer disabled:opacity-50"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </div>

      {/* Right-click / Shift+F10 task context menu */}
      {menuTask && menuState && (
        <TaskContextMenu
          task={menuTask}
          anchor={{ x: menuState.x, y: menuState.y }}
          sections={effectiveSections}
          userId={userId}
          onClose={() => setMenuState(null)}
          onOpen={(t) => onSelectTask(t)}
          onDuplicate={onDuplicateTask}
          onArchive={onArchiveTask}
          onDelete={onDeleteTask}
          onUpdateTask={onUpdateTask}
          onMoveToSection={
            activeListId ? (taskId, sectionId) => handleMoveToSection(taskId, sectionId) : undefined
          }
        />
      )}
    </div>
  );
}
