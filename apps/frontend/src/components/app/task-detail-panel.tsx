"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import {
  X,
  Check,
  Trash2,
  Flag,
  Folder,
  FolderInput,
  ChevronDown,
  Repeat,
  Clock,
  MapPin,
  Bell,
  Plus,
  Search,
  ArrowLeft,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEstimate } from "@/lib/adapters";
import { formatWhen } from "@/lib/dates/formatWhen";
import { DateChip, DatePopover, type DateSelection } from "@/components/dates";
import { v7 as uuidv7 } from "uuid";
import { mutate } from "@/lib/data/mutate";
import {
  getPlaces,
  getSections,
  moveTask,
  createTaskReminder,
  deleteTaskReminder,
  snoozeReminder,
  dismissReminder,
  type BackendFolder,
  type BackendList,
  type BackendPlace,
  type BackendSection,
} from "@/lib/api";
import type {
  TaskItem,
  Priority,
  FolderId,
  HierarchicalSubtask,
  ReminderItem,
} from "./types";
import { TaskSubtasksSection } from "./task-subtasks-section";
import { TagPickerPopover } from "./tag-picker-popover";
import {
  ReminderBanner,
  ReminderList,
  ReminderPicker,
  REMINDER_CAP_MESSAGE,
  REMINDER_LIMIT,
} from "@/components/reminders";
import { MarkdownNotesEditor } from "./markdown-notes-editor";
import { TaskActionsMenu } from "./task-actions-menu";
import { SaveTemplateModal } from "./save-template-modal";

interface TaskDetailPanelProps {
  task: TaskItem | null;
  isOpen: boolean;
  folders?: BackendFolder[];
  lists?: BackendList[];
  onClose: () => void;
  onUpdateTask: (updated: TaskItem) => void;
  onDeleteTask: (id: string) => void;
  onMoveTask?: (taskId: string, listId: string, sectionId: string | null) => void;
  onDuplicateTask?: (id: string) => void;
  onArchiveTask?: (id: string) => void;
  onSkipTask?: (id: string) => void;
  onSaveAsTemplate?: (id: string, name: string) => Promise<void> | void;
  onToggleSubtask?: (subtaskId: string, completed: boolean) => void;
  onAddSubtask?: (title: string, parentId: string) => void;
  onDeleteSubtask?: (subtaskId: string) => void;
  onToggleChecklistItem?: (itemId: string, done: boolean) => void;
  onAddChecklistItem?: (text: string) => void;
  onDeleteChecklistItem?: (itemId: string) => void;
  onUpdateTags?: (tagNames: string[], tagIds?: string[]) => void;
  userId?: string | null;
}

function updateSubtaskInTree(
  list: HierarchicalSubtask[],
  targetId: string,
  updater: (st: HierarchicalSubtask) => HierarchicalSubtask
): HierarchicalSubtask[] {
  return list.map((st) => {
    if (st.id === targetId) {
      return updater(st);
    }
    if (st.subtasks && st.subtasks.length > 0) {
      return {
        ...st,
        subtasks: updateSubtaskInTree(st.subtasks, targetId, updater),
      };
    }
    return st;
  });
}

function addSubtaskToTree(
  list: HierarchicalSubtask[],
  parentId: string,
  rootTaskId: string,
  newSubtask: HierarchicalSubtask
): HierarchicalSubtask[] {
  if (parentId === rootTaskId) {
    return [...list, newSubtask];
  }
  return list.map((st) => {
    if (st.id === parentId) {
      const childDepth = Math.min(3, (st.depth ?? 2) + 1);
      return {
        ...st,
        subtasks: [
          ...(st.subtasks || []),
          { ...newSubtask, depth: childDepth, parentId: st.id },
        ],
      };
    }
    if (st.subtasks && st.subtasks.length > 0) {
      return {
        ...st,
        subtasks: addSubtaskToTree(st.subtasks, parentId, rootTaskId, newSubtask),
      };
    }
    return st;
  });
}

function removeSubtaskFromTree(
  list: HierarchicalSubtask[],
  targetId: string
): HierarchicalSubtask[] {
  return list
    .filter((st) => st.id !== targetId)
    .map((st) => {
      if (st.subtasks && st.subtasks.length > 0) {
        return {
          ...st,
          subtasks: removeSubtaskFromTree(st.subtasks, targetId),
        };
      }
      return st;
    });
}

function getRecurrenceLabel(rrule?: string | null): string {
  if (!rrule) return "None";
  if (rrule.includes("FREQ=DAILY")) return "Daily";
  if (rrule.includes("BYDAY=MO,TU,WE,TH,FR")) return "Weekdays";
  if (rrule.includes("FREQ=WEEKLY")) return "Weekly";
  if (rrule.includes("FREQ=MONTHLY")) return "Monthly";
  return "Custom";
}

// TaskItem.createdAt is a pre-formatted display string ("Just now", "5m ago",
// "Yesterday", "Oct 24") — not a raw date. Derive a friendly "Created …"
// label from it without needing new props.
function friendlyCreatedLabel(createdAt: string): string {
  const c = (createdAt || "").trim();
  if (!c) return "recently";
  if (/yesterday/i.test(c)) return "yesterday";
  if (/just now|ago|[AP]M/i.test(c)) return "today";
  const parsed = new Date(`${c} ${new Date().getFullYear()}`);
  if (!isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
  }
  return c;
}

export function TaskDetailPanel({
  task,
  isOpen,
  folders = [],
  lists = [],
  onClose,
  onUpdateTask,
  onDeleteTask,
  onMoveTask,
  onDuplicateTask,
  onArchiveTask,
  onSkipTask,
  onSaveAsTemplate,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onUpdateTags,
  userId = null,
}: TaskDetailPanelProps) {
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState<
    "due" | "priority" | "folder" | "move" | "recurrence" | "estimate" | "location" | null
  >(null);
  const [places, setPlaces] = useState<BackendPlace[]>([]);
  // Move-to menu state (list search + per-list section step)
  const [moveSearch, setMoveSearch] = useState("");
  const [moveListId, setMoveListId] = useState<string | null>(null);
  const [moveSections, setMoveSections] = useState<BackendSection[]>([]);
  const [isMoveSectionsLoading, setIsMoveSectionsLoading] = useState(false);
  // Quiet footer save indicator: stamped whenever the task's updatedAt flips
  // (every panel edit persists immediately through onUpdateTask).
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const didMountRef = useRef(true);
  const [customRrule, setCustomRrule] = useState("");
  const [customMinutes, setCustomMinutes] = useState("");
  const [isAddingReminder, setIsAddingReminder] = useState(false);
  const pillsBarRef = useRef<HTMLDivElement>(null);

  // Close open picker on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pillsBarRef.current && !pillsBarRef.current.contains(e.target as Node)) {
        setOpenPicker(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Fetch saved places when opening location picker
  useEffect(() => {
    if (openPicker === "location") {
      getPlaces().then(setPlaces).catch(() => setPlaces([]));
    }
  }, [openPicker]);

  const taskUpdatedAt = task?.updatedAt;
  useEffect(() => {
    if (didMountRef.current) {
      didMountRef.current = false;
      return;
    }
    setLastSavedAt(Date.now());
  }, [taskUpdatedAt]);

  const currentFolderObj =
    !task?.folder || task.folder === "none"
      ? null
      : folders.find(
          (f) => f.id === task.folder || f.name.toLowerCase() === task.folder.toLowerCase()
        ) || null;

  const folderDisplayName =
    !task?.folder || task.folder === "none"
      ? "None"
      : currentFolderObj
      ? currentFolderObj.name
      : task.folder.charAt(0).toUpperCase() + task.folder.slice(1);

  const folderDisplayColor =
    currentFolderObj?.color || (task?.folder && task.folder !== "none" ? "#09318D" : "#94A3B8");

  if (!isOpen || !task) return null;

  const handleTitleChange = (newTitle: string) => {
    onUpdateTask({ ...task, title: newTitle, updatedAt: "Just now" });
  };

  const handlePriorityChange = (priority: Priority) => {
    onUpdateTask({ ...task, priority, updatedAt: "Just now" });
  };

  const handleFolderChange = (folder: FolderId) => {
    onUpdateTask({ ...task, folder, updatedAt: "Just now" });
  };

  // Move-to-list (+section) handler. Prefers the workspace callback so the
  // list view stays in sync; falls back to a direct offline-first move with
  // REST fallback (mirrors the bulk-bar move behavior).
  const handleMoveSelect = async (listId: string, sectionId: string | null) => {
    if (onMoveTask) {
      onMoveTask(task.id, listId, sectionId);
    } else {
      onUpdateTask({ ...task, listId, sectionId, updatedAt: "Just now" });
      const isBackendId = !task.id.startsWith("temp-") && !task.id.startsWith("task-");
      if (isBackendId) {
        const patch = { listId, sectionId };
        const doRestMove = () => {
          moveTask(task.id, patch).catch((err) => {
            console.error("Failed to move task on backend:", err);
          });
        };
        if (userId) {
          try {
            await mutate(userId, { entity: "tasks", op: "move", entityId: task.id, patch });
          } catch {
            doRestMove();
          }
        } else {
          doRestMove();
        }
      }
    }
    setMoveSearch("");
    setMoveListId(null);
    setMoveSections([]);
    setOpenPicker(null);
  };

  const handlePickMoveList = (listId: string) => {
    setMoveListId(listId);
    setIsMoveSectionsLoading(true);
    getSections(listId)
      .then((sections) => setMoveSections(sections))
      .catch(() => setMoveSections([]))
      .finally(() => setIsMoveSectionsLoading(false));
  };

  const moveFilteredLists = (() => {
    const q = moveSearch.trim().toLowerCase();
    const pool = q
      ? lists.filter((l) => l.name.toLowerCase().includes(q))
      : lists;
    return pool;
  })();

  const movePickedList = moveListId ? lists.find((l) => l.id === moveListId) || null : null;

  const handleDatesApply = (dates: DateSelection) => {
    // Same persistence as every other panel edit: onUpdateTask carries the
    // full TaskItem, and the workspace persists it offline-first (mutate
    // op:update) with a REST fallback. dueDate stays in sync as the display
    // label so older readers of that field keep working.
    const dueDate =
      dates.dueAt != null
        ? formatWhen(dates.dueAt, { allDay: dates.allDay }) ?? undefined
        : undefined;
    onUpdateTask({
      ...task,
      dueAt: dates.dueAt,
      allDay: dates.allDay,
      startAt: dates.startAt ?? null,
      deadlineAt: dates.deadlineAt ?? null,
      dueDate,
      updatedAt: "Just now",
    });
  };

  const toIsoOrNull = (
    value: string | number | null | undefined
  ): string | null => {
    if (value === null || value === undefined) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };

  // Recurrence Handlers
  const handleSetRecurrencePreset = (preset: "none" | "daily" | "weekdays" | "weekly" | "monthly") => {
    if (preset === "none") {
      onUpdateTask({
        ...task,
        recurrenceId: null,
        recurrenceRule: null,
        updatedAt: "Just now",
      });
      return;
    }

    let rrule = "FREQ=DAILY;INTERVAL=1";
    if (preset === "weekdays") rrule = "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR";
    else if (preset === "weekly") rrule = "FREQ=WEEKLY;INTERVAL=1";
    else if (preset === "monthly") rrule = "FREQ=MONTHLY;INTERVAL=1";

    const mode = task.recurrenceRule?.mode || "fixed";
    onUpdateTask({
      ...task,
      recurrenceId: task.recurrenceId || `rec-${new Date().getTime()}`,
      recurrenceRule: { rrule, mode },
      updatedAt: "Just now",
    });
  };

  const handleSetRecurrenceMode = (mode: "fixed" | "after_completion") => {
    const currentRule = task.recurrenceRule?.rrule || "FREQ=DAILY;INTERVAL=1";
    onUpdateTask({
      ...task,
      recurrenceId: task.recurrenceId || `rec-${new Date().getTime()}`,
      recurrenceRule: { rrule: currentRule, mode },
      updatedAt: "Just now",
    });
  };

  const handleSetCustomRRule = (customRule: string) => {
    const mode = task.recurrenceRule?.mode || "fixed";
    onUpdateTask({
      ...task,
      recurrenceId: task.recurrenceId || `rec-${new Date().getTime()}`,
      recurrenceRule: { rrule: customRule, mode },
      updatedAt: "Just now",
    });
  };

  // Estimate Handlers
  const handleEstimateChange = (minutes: number | null) => {
    onUpdateTask({
      ...task,
      estimateMin: minutes,
      updatedAt: "Just now",
    });
  };

  // Location Handlers
  const handleSelectPlace = (place: BackendPlace) => {
    onUpdateTask({
      ...task,
      placeId: place.id,
      locationName: place.name,
      lat: place.lat,
      lng: place.lng,
      radiusM: place.radiusM,
      locationTrigger: task.locationTrigger || "arrive",
      updatedAt: "Just now",
    });
  };

  const handleManualLocationChange = (name: string, lat?: number | null, lng?: number | null) => {
    onUpdateTask({
      ...task,
      placeId: null,
      locationName: name || null,
      lat: lat ?? task.lat ?? null,
      lng: lng ?? task.lng ?? null,
      radiusM: task.radiusM ?? 200,
      locationTrigger: task.locationTrigger || "arrive",
      updatedAt: "Just now",
    });
  };

  const handleLocationTriggerChange = (trigger: "arrive" | "leave" | null) => {
    onUpdateTask({
      ...task,
      locationTrigger: trigger,
      updatedAt: "Just now",
    });
  };

  const handleClearLocation = () => {
    onUpdateTask({
      ...task,
      placeId: null,
      locationName: null,
      lat: null,
      lng: null,
      radiusM: null,
      locationTrigger: null,
      updatedAt: "Just now",
    });
  };

  // Reminders Handlers
  // Phase 5 follow-up: reminders persist via the reminders sync entity
  // (offline-first mutate, REST fallback) — not via the task update, which
  // has no reminders field server-side. FIELD_MAP whitelist: taskId, kind,
  // relativeTo, offsetMin, remindAt, firedAt. Snooze = update remindAt +
  // clear firedAt; dismiss = update firedAt (mirrors the REST sub-ops).
  // There is no generic reminder-update REST endpoint, so plain updates
  // only exist as snooze/dismiss with their sub-op as the fallback.
  // Local-only tasks and `rem-` optimistic ids never left the device, so
  // they skip server persistence.
  const isBackendTaskId =
    !task.id.startsWith("temp-") && !task.id.startsWith("task-");
  const isLocalReminderId = (id: string) => id.startsWith("rem-");

  const handleAddReminder = (reminder: {
    kind: "absolute" | "relative";
    relativeTo?: "due" | "start" | "deadline" | null;
    offsetMin?: number | null;
    remindAt?: string | null;
  }) => {
    const remindAt =
      reminder.remindAt ||
      (task.dueAt ? new Date(task.dueAt).toISOString() : new Date().toISOString());
    const kind = reminder.kind;
    const relativeTo = reminder.relativeTo ?? "due";
    const offsetMin = reminder.offsetMin ?? 0;
    const newId =
      userId && isBackendTaskId ? uuidv7() : `rem-${new Date().getTime()}`;
    const newReminderItem: ReminderItem = {
      id: newId,
      taskId: task.id,
      kind,
      relativeTo,
      offsetMin,
      remindAt,
      firedAt: null,
    };
    const currentReminders = task.reminders || [];
    onUpdateTask({
      ...task,
      reminders: [...currentReminders, newReminderItem],
      updatedAt: "Just now",
    });
    setIsAddingReminder(false);

    if (!isBackendTaskId) return;
    const doRestCreate = () => {
      createTaskReminder(task.id, { kind, relativeTo, offsetMin, remindAt })
        .then((created) => {
          onUpdateTask({
            ...task,
            reminders: [
              ...currentReminders,
              { ...newReminderItem, id: created.id },
            ],
            updatedAt: "Just now",
          });
        })
        .catch((err) => {
          console.error("Failed to create reminder on backend:", err);
        });
    };
    if (userId) {
      mutate(userId, {
        entity: "reminders",
        op: "create",
        entityId: newId,
        patch: { taskId: task.id, kind, relativeTo, offsetMin, remindAt },
      }).catch(doRestCreate);
    } else {
      doRestCreate();
    }
  };

  const handleDeleteReminder = (reminderId: string) => {
    const currentReminders = task.reminders || [];
    onUpdateTask({
      ...task,
      reminders: currentReminders.filter((r) => r.id !== reminderId),
      updatedAt: "Just now",
    });

    if (!isBackendTaskId || isLocalReminderId(reminderId)) return;
    const doRestDelete = () => {
      deleteTaskReminder(reminderId).catch((err) => {
        console.error("Failed to delete reminder on backend:", err);
      });
    };
    if (userId) {
      mutate(userId, {
        entity: "reminders",
        op: "delete",
        entityId: reminderId,
      }).catch(doRestDelete);
    } else {
      doRestDelete();
    }
  };

  const handleSnoozeReminder = (reminderId: string, minutes = 15) => {
    const currentReminders = task.reminders || [];
    const targetTime = new Date(new Date().getTime() + minutes * 60 * 1000);
    const targetIso = targetTime.toISOString();
    onUpdateTask({
      ...task,
      reminders: currentReminders.map((r) =>
        r.id === reminderId ? { ...r, remindAt: targetIso, firedAt: null } : r
      ),
      updatedAt: "Just now",
    });

    if (!isBackendTaskId || isLocalReminderId(reminderId)) return;
    const doRestSnooze = () => {
      snoozeReminder(reminderId, targetTime.getTime()).catch((err) => {
        console.error("Failed to snooze reminder on backend:", err);
      });
    };
    if (userId) {
      mutate(userId, {
        entity: "reminders",
        op: "update",
        entityId: reminderId,
        patch: { remindAt: targetIso, firedAt: null },
      }).catch(doRestSnooze);
    } else {
      doRestSnooze();
    }
  };

  // Absolute-time snooze (SnoozeSheet tomorrow-9AM / pick-a-time).
  // Same persist path as the minute presets: optimistic mutate + REST fallback.
  const handleSnoozeReminderToTime = (reminderId: string, time: Date) => {
    const currentReminders = task.reminders || [];
    const targetIso = time.toISOString();
    onUpdateTask({
      ...task,
      reminders: currentReminders.map((r) =>
        r.id === reminderId ? { ...r, remindAt: targetIso, firedAt: null } : r
      ),
      updatedAt: "Just now",
    });

    if (!isBackendTaskId || isLocalReminderId(reminderId)) return;
    const doRestSnooze = () => {
      snoozeReminder(reminderId, time.getTime()).catch((err) => {
        console.error("Failed to snooze reminder on backend:", err);
      });
    };
    if (userId) {
      mutate(userId, {
        entity: "reminders",
        op: "update",
        entityId: reminderId,
        patch: { remindAt: targetIso, firedAt: null },
      }).catch(doRestSnooze);
    } else {
      doRestSnooze();
    }
  };

  const handleDismissReminder = (reminderId: string) => {
    const currentReminders = task.reminders || [];
    const nowIso = new Date().toISOString();
    onUpdateTask({
      ...task,
      reminders: currentReminders.map((r) =>
        r.id === reminderId ? { ...r, firedAt: nowIso } : r
      ),
      updatedAt: "Just now",
    });

    if (!isBackendTaskId || isLocalReminderId(reminderId)) return;
    const doRestDismiss = () => {
      dismissReminder(reminderId).catch((err) => {
        console.error("Failed to dismiss reminder on backend:", err);
      });
    };
    if (userId) {
      mutate(userId, {
        entity: "reminders",
        op: "update",
        entityId: reminderId,
        patch: { firedAt: nowIso },
      }).catch(doRestDismiss);
    } else {
      doRestDismiss();
    }
  };

  // Subtask Handlers
  const handleToggleSubtask = (subtaskId: string, currentCompleted: boolean) => {
    if (onToggleSubtask) {
      onToggleSubtask(subtaskId, !currentCompleted);
    }
    const updatedTree = updateSubtaskInTree(task.subtasks, subtaskId, (st) => ({
      ...st,
      completed: !st.completed,
    }));
    onUpdateTask({ ...task, subtasks: updatedTree, updatedAt: "Just now" });
  };

  const handleAddSubtask = (title: string, parentId: string) => {
    if (onAddSubtask) {
      onAddSubtask(title, parentId);
    }
    const childDepth = parentId === task.id ? 2 : 3;
    const newSt: HierarchicalSubtask = {
      id: `st-${new Date().getTime()}`,
      parentId: parentId === task.id ? null : parentId,
      title,
      completed: false,
      depth: childDepth,
      priority: "med",
      subtasks: [],
    };
    const updatedTree = addSubtaskToTree(
      task.subtasks,
      parentId,
      task.id,
      newSt
    );
    onUpdateTask({ ...task, subtasks: updatedTree, updatedAt: "Just now" });
  };

  const handleDeleteSubtask = (subtaskId: string) => {
    if (onDeleteSubtask) {
      onDeleteSubtask(subtaskId);
    }
    const updatedTree = removeSubtaskFromTree(task.subtasks, subtaskId);
    onUpdateTask({ ...task, subtasks: updatedTree, updatedAt: "Just now" });
  };

  // Tag Handlers
  const handleTagsUpdated = (updatedNames: string[], updatedIds: string[]) => {
    if (onUpdateTags) {
      onUpdateTags(updatedNames, updatedIds);
    }
    onUpdateTask({
      ...task,
      tags: updatedNames,
      tagIds: updatedIds,
      updatedAt: "Just now",
    });
  };

  const handleRemoveTag = (tagToRemove: string) => {
    const nextTags = task.tags.filter((t) => t !== tagToRemove);
    const nextIds = task.tagIds
      ? task.tagIds.filter((_, idx) => task.tags[idx] !== tagToRemove)
      : undefined;
    handleTagsUpdated(nextTags, nextIds || []);
  };

  // Notes Handler
  const handleNotesSave = (notes: string) => {
    onUpdateTask({
      ...task,
      notes,
      description: notes || undefined,
      updatedAt: "Just now",
    });
  };

  // Template Save Handler
  const handleSaveTemplate = async (templateName: string) => {
    if (onSaveAsTemplate) {
      await onSaveAsTemplate(task.id, templateName);
    }
  };

  return (
    <aside
      aria-label="Task Details"
      className="relative flex w-full md:w-80 lg:w-96 flex-col border-l border-[#E4E8F2] bg-white transition-all select-none dark:border-[#132E74] dark:bg-[#051A4D]"
    >
      {/* Detail Header */}
      <div className="flex h-16 items-center justify-between border-b border-[#E4E8F2] px-4 dark:border-[#132E74]">
        {/* Status Checkbox */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={task.completed ? "Mark task as active" : "Mark task complete"}
            onClick={() =>
              onUpdateTask({
                ...task,
                completed: !task.completed,
                updatedAt: "Just now",
              })
            }
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md border text-xs transition-colors cursor-pointer focus-ring-pink",
              task.completed
                ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D]"
                : "border-[#CAD5E8] bg-white hover:border-[#09318D] dark:border-[#1F459E] dark:bg-[#082363]"
            )}
          >
            {task.completed && <Check className="h-4 w-4 stroke-[3]" />}
          </button>
          <span className="text-xs font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
            {task.completed ? "Completed" : "Active Task"}
          </span>
        </div>

        {/* Header Right Actions */}
        <div className="flex items-center gap-1">
          <TaskActionsMenu
            onDuplicate={() => onDuplicateTask?.(task.id)}
            onSaveAsTemplate={() => setIsSaveTemplateOpen(true)}
            onArchive={() => onArchiveTask?.(task.id)}
            onDelete={() => onDeleteTask(task.id)}
            isRecurring={Boolean(task.recurrenceId || task.recurrenceRule)}
            onSkip={onSkipTask ? () => onSkipTask(task.id) : undefined}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close task details panel"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Detail Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
        {/* Task Title (Editable) */}
        <div>
          <label
            htmlFor="task-detail-title-input"
            className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]"
          >
            Task Title
          </label>
          <input
            id="task-detail-title-input"
            type="text"
            value={task.title}
            maxLength={500}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#E4E8F2] bg-white px-3 py-2 text-sm font-semibold text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
          />
          {task.title.length > 450 && (
            <div className="mt-1 text-right text-[11px] font-mono text-[#5B6478] dark:text-[#9BB0D3]">
              {task.title.length} / 500
            </div>
          )}
        </div>

        {/* Horizontal Attribute Pills Bar */}
        <div className="space-y-2">
          <div ref={pillsBarRef} className="flex flex-wrap items-center gap-2">
            {/* 1. Dates Pill & Premium Popover (Due, Start, Deadline, All-Day) */}
            <div className="relative">
              <DateChip
                dueAt={task.dueAt ?? task.dueDate ?? null}
                allDay={task.allDay}
                hasRepeat={Boolean(task.recurrenceId || task.recurrenceRule)}
                hasBell={(task.reminders?.length ?? 0) > 0}
                expanded={openPicker === "due"}
                onOpen={() => setOpenPicker(openPicker === "due" ? null : "due")}
              />
              {openPicker === "due" && (
                <DatePopover
                  initial={{
                    dueAt: toIsoOrNull(task.dueAt),
                    allDay: Boolean(task.allDay),
                    startAt: toIsoOrNull(task.startAt),
                    deadlineAt: toIsoOrNull(task.deadlineAt),
                  }}
                  weekStart={1}
                  onApply={(dates) => {
                    handleDatesApply(dates);
                    setOpenPicker(null);
                  }}
                  onClose={() => setOpenPicker(null)}
                />
              )}
            </div>

            {/* 2. Recurrence Pill & Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenPicker(openPicker === "recurrence" ? null : "recurrence")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                  task.recurrenceId || task.recurrenceRule
                    ? "border-[#09318D]/30 bg-[#09318D]/5 text-[#09318D] dark:border-[#FD91CC]/30 dark:bg-[#FD91CC]/10 dark:text-[#FFA8D7]"
                    : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                )}
                title="Set Recurrence"
              >
                <Repeat className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
                <span>
                  Repeat:{" "}
                  <span className="font-semibold">
                    {getRecurrenceLabel(task.recurrenceRule?.rrule || (task.recurrenceId ? "Active" : null))}
                  </span>
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {openPicker === "recurrence" && (
                <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[210px] rounded-xl border border-[#E4E8F2] bg-white p-2.5 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D] space-y-2.5">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Repeat Cadence
                    </label>
                    <div className="mt-1 space-y-1">
                      {[
                        { id: "none" as const, label: "Does not repeat" },
                        { id: "daily" as const, label: "Daily" },
                        { id: "weekdays" as const, label: "Weekdays (Mon-Fri)" },
                        { id: "weekly" as const, label: "Weekly" },
                        { id: "monthly" as const, label: "Monthly" },
                      ].map((preset) => {
                        const currentLabel = getRecurrenceLabel(task.recurrenceRule?.rrule);
                        const isMatch =
                          (preset.id === "none" && !task.recurrenceId && !task.recurrenceRule) ||
                          (preset.id === "daily" && currentLabel === "Daily") ||
                          (preset.id === "weekdays" && currentLabel === "Weekdays") ||
                          (preset.id === "weekly" && currentLabel === "Weekly") ||
                          (preset.id === "monthly" && currentLabel === "Monthly");
                        return (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              handleSetRecurrencePreset(preset.id);
                              setOpenPicker(null);
                            }}
                            className={cn(
                              "flex w-full items-center justify-between rounded px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
                              isMatch
                                ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                                : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                            )}
                          >
                            <span>{preset.label}</span>
                            {isMatch && <Check className="h-3.5 w-3.5" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Mode Selector */}
                  <div className="border-t border-[#E4E8F2] pt-2 dark:border-[#132E74]">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Series Mode
                    </label>
                    <div className="mt-1 flex gap-1">
                      <button
                        type="button"
                        onClick={() => handleSetRecurrenceMode("fixed")}
                        className={cn(
                          "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                          (task.recurrenceRule?.mode || "fixed") === "fixed"
                            ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                            : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                        )}
                      >
                        Fixed
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSetRecurrenceMode("after_completion")}
                        className={cn(
                          "flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                          task.recurrenceRule?.mode === "after_completion"
                            ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                            : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                        )}
                      >
                        After Done
                      </button>
                    </div>
                  </div>

                  {/* Custom RRULE input */}
                  <div className="border-t border-[#E4E8F2] pt-2 dark:border-[#132E74]">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Custom RRULE
                    </label>
                    <div className="mt-1 flex gap-1">
                      <input
                        type="text"
                        placeholder="e.g. FREQ=DAILY;INTERVAL=2"
                        value={customRrule}
                        onChange={(e) => setCustomRrule(e.target.value)}
                        className="flex-1 rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (customRrule.trim()) {
                            handleSetCustomRRule(customRrule.trim());
                            setCustomRrule("");
                            setOpenPicker(null);
                          }
                        }}
                        className="rounded bg-[#09318D] px-2 py-1 text-xs font-semibold text-white hover:bg-[#0B3EA8] dark:bg-[#FD91CC] dark:text-[#051A4D] cursor-pointer"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Estimate Pill & Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenPicker(openPicker === "estimate" ? null : "estimate")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                  task.estimateMin
                    ? "border-amber-300 bg-amber-50/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400"
                    : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                )}
                title="Change Estimate"
              >
                <Clock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                <span>
                  Est:{" "}
                  <span className="font-semibold">{formatEstimate(task.estimateMin) || "None"}</span>
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {openPicker === "estimate" && (
                <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[190px] rounded-xl border border-[#E4E8F2] bg-white p-2.5 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D] space-y-2.5">
                  <div>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Quick Estimates
                    </label>
                    <div className="mt-1 grid grid-cols-3 gap-1">
                      {[
                        { label: "None", value: null },
                        { label: "15m", value: 15 },
                        { label: "30m", value: 30 },
                        { label: "45m", value: 45 },
                        { label: "1h", value: 60 },
                        { label: "2h", value: 120 },
                      ].map((chip) => (
                        <button
                          key={chip.label}
                          type="button"
                          onClick={() => {
                            handleEstimateChange(chip.value);
                            setOpenPicker(null);
                          }}
                          className={cn(
                            "rounded px-1.5 py-1 text-xs text-center cursor-pointer transition-colors",
                            task.estimateMin === chip.value
                              ? "bg-amber-500 font-bold text-white dark:bg-amber-400 dark:text-[#051A4D]"
                              : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                          )}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-[#E4E8F2] pt-2 dark:border-[#132E74]">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Custom Minutes
                    </label>
                    <div className="mt-1 flex gap-1">
                      <input
                        type="number"
                        min="1"
                        placeholder="Minutes"
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(e.target.value)}
                        className="flex-1 rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const val = parseInt(customMinutes, 10);
                          if (!isNaN(val) && val > 0) {
                            handleEstimateChange(val);
                            setCustomMinutes("");
                            setOpenPicker(null);
                          }
                        }}
                        className="rounded bg-[#09318D] px-2 py-1 text-xs font-semibold text-white hover:bg-[#0B3EA8] dark:bg-[#FD91CC] dark:text-[#051A4D] cursor-pointer"
                      >
                        Set
                      </button>
                    </div>
                  </div>

                  {Boolean(task.estimateTotal && task.estimateTotal !== task.estimateMin) && (
                    <div className="border-t border-[#E4E8F2] pt-1.5 text-[11px] font-mono text-[#5B6478] dark:border-[#132E74] dark:text-[#9BB0D3]">
                      Total: <span className="font-bold text-[#09318D] dark:text-[#FD91CC]">{formatEstimate(task.estimateTotal)}</span> with subtasks
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 4. Location Pill & Popover */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenPicker(openPicker === "location" ? null : "location")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                  task.locationName
                    ? "border-emerald-300 bg-emerald-50/80 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-400"
                    : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                )}
                title="Geofence & Location"
              >
                <MapPin className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>
                  Loc:{" "}
                  <span className="font-semibold max-w-[80px] truncate inline-block align-bottom">
                    {task.locationName || "None"}
                  </span>
                </span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {openPicker === "location" && (
                <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[220px] rounded-xl border border-[#E4E8F2] bg-white p-2.5 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D] space-y-2.5">
                  {places.length > 0 && (
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                        Saved Places
                      </label>
                      <div className="mt-1 space-y-1 max-h-28 overflow-y-auto">
                        {places.map((place) => (
                          <button
                            key={place.id}
                            type="button"
                            onClick={() => {
                              handleSelectPlace(place);
                              setOpenPicker(null);
                            }}
                            className={cn(
                              "flex w-full items-center justify-between rounded px-2 py-1 text-xs text-left cursor-pointer transition-colors",
                              task.placeId === place.id
                                ? "bg-emerald-500 font-bold text-white"
                                : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                            )}
                          >
                            <span className="truncate">{place.name}</span>
                            {task.placeId === place.id && <Check className="h-3.5 w-3.5" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-[#E4E8F2] pt-2 dark:border-[#132E74] space-y-1.5">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Location Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Office, Grocery Store"
                      value={task.locationName || ""}
                      onChange={(e) => handleManualLocationChange(e.target.value)}
                      className="w-full rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                    />

                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => handleLocationTriggerChange("arrive")}
                        className={cn(
                          "rounded px-2 py-1 text-xs text-center cursor-pointer transition-colors",
                          task.locationTrigger === "arrive"
                            ? "bg-emerald-600 font-bold text-white dark:bg-emerald-500"
                            : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                        )}
                      >
                        On Arrival
                      </button>
                      <button
                        type="button"
                        onClick={() => handleLocationTriggerChange("leave")}
                        className={cn(
                          "rounded px-2 py-1 text-xs text-center cursor-pointer transition-colors",
                          task.locationTrigger === "leave"
                            ? "bg-emerald-600 font-bold text-white dark:bg-emerald-500"
                            : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                        )}
                      >
                        On Leave
                      </button>
                    </div>

                    {Boolean(task.locationName) && (
                      <button
                        type="button"
                        onClick={() => {
                          handleClearLocation();
                          setOpenPicker(null);
                        }}
                        className="w-full mt-1 rounded text-center py-1 text-[11px] font-medium text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer dark:text-rose-400 dark:hover:bg-rose-950/40"
                      >
                        Remove Location
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* 5. Priority Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenPicker(openPicker === "priority" ? null : "priority")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                  task.priority === "high"
                    ? "border-rose-300 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400"
                    : task.priority === "med"
                    ? "border-amber-300 bg-amber-50/80 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-400"
                    : "border-blue-300 bg-blue-50/80 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/40 dark:text-blue-400"
                )}
                title="Change Priority"
              >
                <Flag className="h-3.5 w-3.5" />
                <span>Priority: <span className="capitalize font-semibold">{task.priority || "None"}</span></span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {openPicker === "priority" && (
                <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[140px] rounded-xl border border-[#E4E8F2] bg-white p-1 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D]">
                  {[
                    { id: "low" as const, label: "Low", dot: "bg-blue-500" },
                    { id: "med" as const, label: "Medium", dot: "bg-amber-500" },
                    { id: "high" as const, label: "High", dot: "bg-rose-500" },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        handlePriorityChange(p.id);
                        setOpenPicker(null);
                      }}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
                        task.priority === p.id
                          ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                          : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                      )}
                    >
                      <span className={cn("h-2 w-2 rounded-full shrink-0", p.dot)} />
                      <span className="flex-1">{p.label}</span>
                      {task.priority === p.id && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Folder Pill (Connected to Real Dynamic Folders) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenPicker(openPicker === "folder" ? null : "folder")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                  task.folder && task.folder !== "none"
                    ? "border-[#09318D]/30 bg-[#09318D]/5 text-[#09318D] dark:border-[#FD91CC]/30 dark:bg-[#FD91CC]/10 dark:text-[#FFA8D7]"
                    : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                )}
                title="Change Folder"
              >
                <Folder className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
                <span
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{ backgroundColor: folderDisplayColor }}
                />
                <span>Folder: <span className="font-semibold truncate max-w-[110px] inline-block align-bottom">{folderDisplayName}</span></span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {openPicker === "folder" && (
                <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[170px] max-h-52 overflow-y-auto rounded-xl border border-[#E4E8F2] bg-white p-1 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D]">
                  <button
                    type="button"
                    onClick={() => {
                      handleFolderChange("none");
                      setOpenPicker(null);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
                      !task.folder || task.folder === "none"
                        ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                        : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                    )}
                  >
                    <span className="h-2 w-2 rounded-full bg-slate-400 shrink-0" />
                    <span className="flex-1">No folder</span>
                    {(!task.folder || task.folder === "none") && <Check className="h-3.5 w-3.5" />}
                  </button>
                  {folders.map((f) => {
                    const isSelected = task.folder === f.id || task.folder.toLowerCase() === f.name.toLowerCase();
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => {
                          handleFolderChange(f.id);
                          setOpenPicker(null);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
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

            {/* 3b. Move-to Pill (list search + section step, mirrors bulk-bar move) */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setMoveSearch("");
                  setMoveListId(null);
                  setMoveSections([]);
                  setOpenPicker(openPicker === "move" ? null : "move");
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                  "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                )}
                title="Move to list"
              >
                <FolderInput className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
                <span>Move to…</span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {openPicker === "move" && (
                <div className="absolute left-0 top-full mt-1.5 z-30 w-56 rounded-xl border border-[#E4E8F2] bg-white p-2 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D]">
                  {!movePickedList ? (
                    <>
                      <div className="relative flex items-center">
                        <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
                        <input
                          type="text"
                          value={moveSearch}
                          onChange={(e) => setMoveSearch(e.target.value)}
                          placeholder="Search lists..."
                          className="w-full rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/50 py-1 pl-8 pr-2 text-xs text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                        />
                      </div>
                      <div className="mt-1.5 max-h-48 space-y-0.5 overflow-y-auto">
                        {moveFilteredLists.length === 0 && (
                          <div className="px-2 py-2 text-center text-[11px] italic text-[#5B6478]/70 dark:text-[#9BB0D3]/60">
                            No lists found
                          </div>
                        )}
                        {moveFilteredLists.map((l) => {
                          const isCurrent = task.listId === l.id;
                          return (
                            <button
                              key={l.id}
                              type="button"
                              onClick={() => handlePickMoveList(l.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                                isCurrent
                                  ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                                  : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                              )}
                            >
                              <span
                                className="h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: l.color || "#09318D" }}
                              />
                              <span className="flex-1 truncate">{l.name}</span>
                              {isCurrent && <Check className="h-3.5 w-3.5" />}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setMoveListId(null);
                          setMoveSections([]);
                        }}
                        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363] cursor-pointer"
                      >
                        <ArrowLeft className="h-3 w-3" />
                        <span className="truncate">{movePickedList.name}</span>
                      </button>
                      <div className="mt-1 max-h-48 space-y-0.5 overflow-y-auto">
                        <button
                          type="button"
                          onClick={() => handleMoveSelect(movePickedList.id, null)}
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-[#5B6478] transition-colors hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363] cursor-pointer"
                        >
                          <span className="flex-1">No section</span>
                          {(task.listId === movePickedList.id && !task.sectionId) && (
                            <Check className="h-3.5 w-3.5" />
                          )}
                        </button>
                        {isMoveSectionsLoading && (
                          <div className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>Loading sections...</span>
                          </div>
                        )}
                        {!isMoveSectionsLoading &&
                          moveSections.map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => handleMoveSelect(movePickedList.id, s.id)}
                              className={cn(
                                "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                                task.listId === movePickedList.id && task.sectionId === s.id
                                  ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                                  : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                              )}
                            >
                              <span className="flex-1 truncate">{s.name}</span>
                              {task.listId === movePickedList.id && task.sectionId === s.id && (
                                <Check className="h-3.5 w-3.5" />
                              )}
                            </button>
                          ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 4. Tags Pill */}
            <TagPickerPopover
              taskId={task.id}
              activeTags={task.tags}
              activeTagIds={task.tagIds}
              onTagsUpdated={handleTagsUpdated}
              userId={userId}
              label={task.tags.length > 0 ? `Tags (${task.tags.length})` : "Tags"}
              triggerClassName="inline-flex items-center gap-1.5 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1 text-xs font-medium text-[#5B6478] hover:bg-[#F2F5FC] transition-all cursor-pointer focus-ring-pink dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
            />
          </div>

          {/* Assigned Tag Chips */}
          {task.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {task.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#F2F5FC] px-2 py-0.5 text-xs font-medium text-[#09318D] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#FFA8D7]"
                >
                  <span>{t}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    aria-label={`Remove tag ${t}`}
                    className="hover:text-rose-600 transition-colors cursor-pointer"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Unified Subtasks Section with Animated Mini Progress Bar */}
        <TaskSubtasksSection
          rootTaskId={task.id}
          subtasks={task.subtasks}
          onToggleSubtask={handleToggleSubtask}
          onAddSubtask={handleAddSubtask}
          onDeleteSubtask={handleDeleteSubtask}
        />

        {/* Reminders Section */}
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
              <Bell className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
              <span>Reminders {task.reminders && task.reminders.length > 0 && `(${task.reminders.length})`}</span>
            </div>
            <button
              type="button"
              onClick={() => setIsAddingReminder((prev) => !prev)}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#09318D] hover:underline dark:text-[#FD91CC] cursor-pointer"
            >
              <Plus className="h-3 w-3" />
              <span>Add reminder</span>
            </button>
          </div>

          {/* Add Reminder Menu */}
          {isAddingReminder && (
            <>
              <ReminderPicker
                hasDueDate={Boolean(task.dueAt)}
                atCap={(task.reminders?.length ?? 0) >= REMINDER_LIMIT}
                onAdd={handleAddReminder}
              />
              {(task.reminders?.length ?? 0) >= REMINDER_LIMIT && (
                <p className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                  {REMINDER_CAP_MESSAGE}
                </p>
              )}
            </>
          )}

          <ReminderBanner reminderCount={task.reminders?.length ?? 0} />

          {/* Active Reminders List */}
          <ReminderList
            reminders={task.reminders ?? []}
            dueAt={task.dueAt}
            startAt={task.startAt}
            deadlineAt={task.deadlineAt}
            onSnooze={handleSnoozeReminder}
            onSnoozeAt={handleSnoozeReminderToTime}
            onDismiss={handleDismissReminder}
            onDelete={handleDeleteReminder}
          />
        </div>

        {/* 4. Markdown Notes Editor */}
        <MarkdownNotesEditor
          initialNotes={task.notes}
          onSave={handleNotesSave}
        />

        {/* Timestamps */}
        <div className="border-t border-[#E4E8F2] pt-4 text-[11px] font-mono text-[#5B6478] dark:border-[#132E74] dark:text-[#9BB0D3] space-y-1">
          <div className="flex items-center justify-between">
            <span>Created</span>
            <span>{task.createdAt}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Last Activity</span>
            <span>{task.updatedAt}</span>
          </div>
        </div>
      </div>

      {/* Detail Footer: save status + created stamp, then delete */}
      <div className="border-t border-[#E4E8F2] p-4 dark:border-[#132E74] space-y-3">
        <div className="flex items-center justify-between text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
          <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
            <Check className="h-3 w-3 stroke-[3]" />
            <span>
              Saved
              {lastSavedAt !== null &&
                ` · ${new Date(lastSavedAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}`}
            </span>
          </span>
          <span>Created {friendlyCreatedLabel(task.createdAt)}</span>
        </div>
        <button
          type="button"
          onClick={() => onDeleteTask(task.id)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50/50 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 hover:text-rose-800 transition-colors dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-400 dark:hover:bg-rose-950/50 cursor-pointer focus-ring-pink"
        >
          <Trash2 className="h-4 w-4" />
          <span>Delete Task</span>
        </button>
      </div>

      {/* Save Template Modal */}
      <SaveTemplateModal
        isOpen={isSaveTemplateOpen}
        defaultName={task.title}
        onClose={() => setIsSaveTemplateOpen(false)}
        onSave={handleSaveTemplate}
      />
    </aside>
  );
}
