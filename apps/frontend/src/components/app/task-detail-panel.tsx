"use client";

import * as React from "react";
import { useState } from "react";
import {
  X,
  Check,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskItem, Priority, FolderId, Subtask } from "./types";

interface TaskDetailPanelProps {
  task: TaskItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateTask: (updated: TaskItem) => void;
  onDeleteTask: (id: string) => void;
}

export function TaskDetailPanel({
  task,
  isOpen,
  onClose,
  onUpdateTask,
  onDeleteTask,
}: TaskDetailPanelProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");
  const [newTagInput, setNewTagInput] = useState("");

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

  const handleToggleSubtask = (subtaskId: string) => {
    const updated = task.subtasks.map((st) =>
      st.id === subtaskId ? { ...st, completed: !st.completed } : st
    );
    onUpdateTask({ ...task, subtasks: updated, updatedAt: "Just now" });
  };

  const handleAddSubtask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    const newSt: Subtask = {
      id: `st-${Date.now()}`,
      title: trimmed,
      completed: false,
      depth: 2,
      subtasks: [],
    };
    onUpdateTask({
      ...task,
      subtasks: [...task.subtasks, newSt],
      updatedAt: "Just now",
    });
    setNewSubtaskTitle("");
  };

  const handleDeleteSubtask = (subtaskId: string) => {
    onUpdateTask({
      ...task,
      subtasks: task.subtasks.filter((st) => st.id !== subtaskId),
      updatedAt: "Just now",
    });
  };

  const handleAddTag = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTagInput.trim().toLowerCase();
    if (!trimmed || task.tags.includes(trimmed)) return;
    onUpdateTask({
      ...task,
      tags: [...task.tags, trimmed],
      updatedAt: "Just now",
    });
    setNewTagInput("");
  };

  const handleRemoveTag = (tagToRemove: string) => {
    onUpdateTask({
      ...task,
      tags: task.tags.filter((t) => t !== tagToRemove),
      updatedAt: "Just now",
    });
  };

  return (
    <aside
      aria-label="Task Details"
      className="relative flex w-full md:w-80 lg:w-96 flex-col border-l border-[#E4E8F2] bg-white transition-all select-none dark:border-[#132E74] dark:bg-[#051A4D]"
    >
      {/* Detail Header */}
      <div className="flex h-16 items-center justify-between border-b border-[#E4E8F2] px-4 dark:border-[#132E74]">
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

        <button
          type="button"
          onClick={onClose}
          aria-label="Close task details panel"
          className="flex h-8 w-8 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
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
            {(["high", "med", "low"] as const).map((p) => {
              const isSelected = task.priority === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePriorityChange(p)}
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
                      p === "high" && "bg-rose-500",
                      p === "med" && "bg-amber-500",
                      p === "low" && "bg-blue-500"
                    )}
                  />
                  <span>{p}</span>
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

        {/* Subtasks Checklist */}
        <div>
          <div className="flex items-center justify-between pb-1">
            <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
              Checklist ({task.subtasks.filter((s) => s.completed).length}/
              {task.subtasks.length})
            </label>
          </div>

          <div className="space-y-1.5 mt-2">
            {task.subtasks.map((st) => (
              <div
                key={st.id}
                className="group flex items-center justify-between gap-2 rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/50 px-2.5 py-1.5 text-xs dark:border-[#132E74] dark:bg-[#082363]/40"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => handleToggleSubtask(st.id)}
                    className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors cursor-pointer",
                      st.completed
                        ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D]"
                        : "border-[#CAD5E8] bg-white dark:border-[#1F459E] dark:bg-[#051A4D]"
                    )}
                  >
                    {st.completed && <Check className="h-3 w-3 stroke-[3]" />}
                  </button>
                  <span
                    className={cn(
                      "truncate transition-all",
                      st.completed && "line-through text-[#5B6478]/70 dark:text-[#9BB0D3]/60"
                    )}
                  >
                    {st.title}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => handleDeleteSubtask(st.id)}
                  className="opacity-0 group-hover:opacity-100 text-[#5B6478] hover:text-rose-500 transition-opacity p-0.5"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}

            {/* Add Subtask Input */}
            <form onSubmit={handleAddSubtask} className="flex gap-1.5 pt-1">
              <input
                type="text"
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                placeholder="Add checklist sub-item..."
                className="flex-1 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1 text-xs placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363]"
              />
              <button
                type="submit"
                disabled={!newSubtaskTitle.trim()}
                className="rounded-lg bg-[#09318D] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0D41B4] disabled:opacity-40 transition-colors dark:bg-[#0D41B4]"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </form>
          </div>
        </div>

        {/* Tags Section */}
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
            Tags
          </label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {task.tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#F2F5FC] px-2 py-0.5 text-xs font-medium text-[#5B6478] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
              >
                <span>{t}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveTag(t)}
                  className="hover:text-rose-600 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>

          <form onSubmit={handleAddTag} className="flex gap-1.5 pt-2">
            <input
              type="text"
              value={newTagInput}
              onChange={(e) => setNewTagInput(e.target.value)}
              placeholder="Add tag (e.g. backend, ui)..."
              className="flex-1 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1 text-xs placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363]"
            />
            <button
              type="submit"
              disabled={!newTagInput.trim()}
              className="rounded-lg border border-[#E4E8F2] bg-[#F2F5FC] px-2.5 py-1 text-xs font-semibold text-[#09318D] hover:bg-[#E4E8F2] disabled:opacity-40 transition-colors dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
            >
              Add
            </button>
          </form>
        </div>

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
    </aside>
  );
}
