"use client";

import * as React from "react";
import { useState } from "react";
import { X, Check, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskItem, Priority, FolderId, HierarchicalSubtask } from "./types";
import { TaskSubtasksSection } from "./task-subtasks-section";
import { TagPickerPopover } from "./tag-picker-popover";
import { MarkdownNotesEditor } from "./markdown-notes-editor";
import { TaskActionsMenu } from "./task-actions-menu";
import { SaveTemplateModal } from "./save-template-modal";

interface TaskDetailPanelProps {
  task: TaskItem | null;
  isOpen: boolean;
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

        {/* Priority Selector */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
            Priority Level
          </label>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {[
              { id: "high" as const, label: "High" },
              { id: "med" as const, label: "Medium" },
              { id: "low" as const, label: "Low" },
            ].map((p) => {
              const isSelected = task.priority === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePriorityChange(p.id)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg border py-1.5 text-xs font-semibold capitalize transition-all cursor-pointer focus-ring-pink",
                    isSelected
                      ? "border-[#09318D] bg-[#09318D] text-white shadow-xs dark:border-[#FD91CC] dark:bg-[#FD91CC] dark:text-[#051A4D]"
                      : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      p.id === "high" && "bg-rose-500",
                      p.id === "med" && "bg-amber-500",
                      p.id === "low" && "bg-blue-500"
                    )}
                  />
                  <span>{p.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Folder / Project Selector */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
            Folder
          </label>
          <div className="mt-1.5 grid grid-cols-3 gap-2">
            {(["engineering", "design", "personal"] as const).map((f) => {
              const isSelected = task.folder === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => handleFolderChange(f)}
                  className={cn(
                    "rounded-lg border py-1.5 text-xs font-medium capitalize transition-all cursor-pointer focus-ring-pink",
                    isSelected
                      ? "border-[#09318D] bg-[#F2F5FC] text-[#09318D] font-bold dark:border-[#FD91CC] dark:bg-[#082363] dark:text-[#FFA8D7]"
                      : "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                  )}
                >
                  {f}
                </button>
              );
            })}
          </div>
        </div>

        {/* Unified Subtasks Section with Animated Mini Progress Bar */}
        <TaskSubtasksSection
          rootTaskId={task.id}
          subtasks={task.subtasks}
          onToggleSubtask={handleToggleSubtask}
          onAddSubtask={handleAddSubtask}
          onDeleteSubtask={handleDeleteSubtask}
        />

        {/* 3. Tags Section with TagPickerPopover */}
        <div>
          <div className="flex items-center justify-between pb-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
              Tags ({task.tags.length})
            </label>
            <TagPickerPopover
              taskId={task.id}
              activeTags={task.tags}
              activeTagIds={task.tagIds}
              onTagsUpdated={handleTagsUpdated}
            />
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.tags.length === 0 ? (
              <span className="text-xs italic text-[#5B6478]/70 dark:text-[#9BB0D3]/60">
                No tags assigned. Click Tag to add.
              </span>
            ) : (
              task.tags.map((t) => (
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
              ))
            )}
          </div>
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
