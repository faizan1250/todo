"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { X, Check, Trash2, Calendar, Flag, Folder, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackendFolder } from "@/lib/api";
import type { TaskItem, Priority, FolderId, HierarchicalSubtask } from "./types";
import { TaskSubtasksSection } from "./task-subtasks-section";
import { TagPickerPopover } from "./tag-picker-popover";
import { MarkdownNotesEditor } from "./markdown-notes-editor";
import { TaskActionsMenu } from "./task-actions-menu";
import { SaveTemplateModal } from "./save-template-modal";

interface TaskDetailPanelProps {
  task: TaskItem | null;
  isOpen: boolean;
  folders?: BackendFolder[];
  onClose: () => void;
  onUpdateTask: (updated: TaskItem) => void;
  onDeleteTask: (id: string) => void;
  onDuplicateTask?: (id: string) => void;
  onArchiveTask?: (id: string) => void;
  onSaveAsTemplate?: (id: string, name: string) => Promise<void> | void;
  onToggleSubtask?: (subtaskId: string, completed: boolean) => void;
  onAddSubtask?: (title: string, parentId: string) => void;
  onDeleteSubtask?: (subtaskId: string) => void;
  onToggleChecklistItem?: (itemId: string, done: boolean) => void;
  onAddChecklistItem?: (text: string) => void;
  onDeleteChecklistItem?: (itemId: string) => void;
  onUpdateTags?: (tagNames: string[], tagIds?: string[]) => void;
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

export function TaskDetailPanel({
  task,
  isOpen,
  folders = [],
  onClose,
  onUpdateTask,
  onDeleteTask,
  onDuplicateTask,
  onArchiveTask,
  onSaveAsTemplate,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  onUpdateTags,
}: TaskDetailPanelProps) {
  const [isSaveTemplateOpen, setIsSaveTemplateOpen] = useState(false);
  const [openPicker, setOpenPicker] = useState<"due" | "priority" | "folder" | null>(null);
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

  const handleDueDateChange = (newDueDate?: string) => {
    let dueAt: string | null = null;
    if (newDueDate === "Today") {
      dueAt = new Date().toISOString();
    } else if (newDueDate === "Tomorrow") {
      const tmr = new Date();
      tmr.setDate(tmr.getDate() + 1);
      dueAt = tmr.toISOString();
    } else if (newDueDate === "Next week") {
      const nw = new Date();
      nw.setDate(nw.getDate() + 7);
      dueAt = nw.toISOString();
    } else if (newDueDate) {
      const parsed = new Date(newDueDate);
      if (!isNaN(parsed.getTime())) {
        dueAt = parsed.toISOString();
      }
    }

    onUpdateTask({
      ...task,
      dueDate: newDueDate || undefined,
      dueAt,
      updatedAt: "Just now",
    });
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
      id: `st-${Date.now()}`,
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
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
            Task Title
          </label>
          <input
            type="text"
            value={task.title}
            onChange={(e) => handleTitleChange(e.target.value)}
            className="mt-1 w-full rounded-lg border border-[#E4E8F2] bg-white px-3 py-2 text-sm font-semibold text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
          />
        </div>

        {/* Horizontal Attribute Pills Bar */}
        <div className="space-y-2">
          <div ref={pillsBarRef} className="flex flex-wrap items-center gap-2">
            {/* 1. Due Date Pill */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setOpenPicker(openPicker === "due" ? null : "due")}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all cursor-pointer focus-ring-pink",
                  task.dueDate
                    ? "border-[#09318D]/30 bg-[#09318D]/5 text-[#09318D] dark:border-[#FD91CC]/30 dark:bg-[#FD91CC]/10 dark:text-[#FFA8D7]"
                    : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                )}
                title="Change Due Date"
              >
                <Calendar className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
                <span>Due: <span className="font-semibold">{task.dueDate || "None"}</span></span>
                <ChevronDown className="h-3 w-3 opacity-60" />
              </button>
              {openPicker === "due" && (
                <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[170px] rounded-xl border border-[#E4E8F2] bg-white p-1.5 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D]">
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
                        handleDueDateChange(opt.value);
                        setOpenPicker(null);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
                        (task.dueDate || "") === opt.value
                          ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                          : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
                      )}
                    >
                      <span>{opt.label}</span>
                      {(task.dueDate || "") === opt.value && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                  <div className="mt-1 border-t border-[#E4E8F2] pt-1.5 px-2 pb-1 dark:border-[#132E74]">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                      Pick Date
                    </label>
                    <input
                      type="date"
                      onChange={(e) => {
                        if (e.target.value) {
                          handleDueDateChange(e.target.value);
                          setOpenPicker(null);
                        }
                      }}
                      className="mt-1 w-full rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* 2. Priority Pill */}
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

            {/* 4. Tags Pill */}
            <TagPickerPopover
              taskId={task.id}
              activeTags={task.tags}
              activeTagIds={task.tagIds}
              onTagsUpdated={handleTagsUpdated}
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

      {/* Detail Footer Delete */}
      <div className="border-t border-[#E4E8F2] p-4 dark:border-[#132E74]">
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
