"use client";

import * as React from "react";
import { useState } from "react";
import { Check, Plus, Trash2, X, CornerDownRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HierarchicalSubtask, Priority } from "./types";

export interface TaskSubtasksSectionProps {
  rootTaskId: string;
  subtasks: HierarchicalSubtask[];
  onToggleSubtask: (subtaskId: string, completed: boolean) => void;
  onAddSubtask: (title: string, parentId: string) => void;
  onDeleteSubtask: (subtaskId: string) => void;
  disabled?: boolean;
}

function countSubtasks(list: HierarchicalSubtask[]): { total: number; completed: number } {
  let total = 0;
  let completed = 0;
  for (const st of list) {
    total += 1;
    if (st.completed) completed += 1;
    if (st.subtasks && st.subtasks.length > 0) {
      const nested = countSubtasks(st.subtasks);
      total += nested.total;
      completed += nested.completed;
    }
  }
  return { total, completed };
}

interface SubtaskItemProps {
  node: HierarchicalSubtask;
  onToggle: (id: string, completed: boolean) => void;
  onAddChild: (title: string, parentId: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

function SubtaskItem({
  node,
  onToggle,
  onAddChild,
  onDelete,
  disabled,
}: SubtaskItemProps) {
  const [isAddingChild, setIsAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState("");

  const depth = node.depth ?? 2;
  const canNest = depth < 3;

  const handleAddChildSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = childTitle.trim();
    if (!trimmed || !canNest || disabled) return;
    onAddChild(trimmed, node.id);
    setChildTitle("");
    setIsAddingChild(false);
  };

  const priorityDot = (p?: Priority) => {
    if (p === "high") return "bg-rose-500";
    if (p === "med") return "bg-amber-500";
    return null;
  };

  const dotColorClass = priorityDot(node.priority);

  return (
    <div className="space-y-1">
      {/* Subtask Row */}
      <div className="group flex items-center justify-between gap-2 rounded-lg border border-[#E4E8F2]/70 bg-[#F2F5FC]/40 px-2.5 py-1.5 text-xs transition-colors hover:border-[#CAD5E8] hover:bg-[#F2F5FC]/80 dark:border-[#132E74]/60 dark:bg-[#082363]/30 dark:hover:border-[#1F459E] dark:hover:bg-[#082363]/60">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Round completion circle */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onToggle(node.id, node.completed)}
            aria-label={
              node.completed
                ? `Mark "${node.title}" incomplete`
                : `Mark "${node.title}" complete`
            }
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-all cursor-pointer focus-ring-pink",
              node.completed
                ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D]"
                : "border-[#CAD5E8] bg-white hover:border-[#09318D] dark:border-[#1F459E] dark:bg-[#051A4D]"
            )}
          >
            {node.completed && <Check className="h-2.5 w-2.5 stroke-[3]" />}
          </button>

          {/* Subtle priority dot if set */}
          {dotColorClass && (
            <span
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotColorClass)}
              title={`Priority: ${node.priority}`}
            />
          )}

          {/* Title with natural strike-through on complete */}
          <span
            className={cn(
              "truncate transition-colors text-[#0B1220] dark:text-white font-medium",
              node.completed && "line-through text-[#5B6478]/70 dark:text-[#9BB0D3]/60"
            )}
          >
            {node.title}
          </span>
        </div>

        {/* Quiet Hover Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Add child subtask button */}
          {canNest && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsAddingChild((prev) => !prev)}
              aria-label={`Add subtask to ${node.title}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[11px] font-medium text-[#09318D] hover:underline dark:text-[#FFA8D7] transition-opacity px-1 py-0.5 rounded cursor-pointer"
            >
              + Subtask
            </button>
          )}

          {/* Gentle hover delete button */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onDelete(node.id)}
            aria-label={`Delete subtask "${node.title}"`}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[#5B6478] hover:text-rose-500 transition-opacity p-0.5 rounded cursor-pointer"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Inline Child Subtask Form */}
      {isAddingChild && canNest && (
        <form
          onSubmit={handleAddChildSubmit}
          className="ml-3.5 flex items-center gap-1.5 border-l border-[#FD91CC]/60 pl-2.5 py-1"
        >
          <CornerDownRight className="h-3 w-3 text-[#FD91CC] shrink-0" />
          <input
            type="text"
            autoFocus
            value={childTitle}
            onChange={(e) => setChildTitle(e.target.value)}
            placeholder="+ Add subtask..."
            className="flex-1 rounded-md border border-[#E4E8F2] bg-white px-2 py-0.5 text-xs text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
          />
          <button
            type="submit"
            disabled={!childTitle.trim()}
            className="rounded-md bg-[#09318D] px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#0D41B4] disabled:opacity-40 transition-colors cursor-pointer dark:bg-[#0D41B4]"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAddingChild(false);
              setChildTitle("");
            }}
            aria-label="Cancel subtask addition"
            className="text-[#5B6478] hover:text-rose-500 p-0.5 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      )}

      {/* Natural Child Subtasks with quiet left guide border (no depth badges) */}
      {node.subtasks && node.subtasks.length > 0 && (
        <div className="ml-3.5 border-l border-[#E4E8F2] pl-2.5 space-y-1 my-1 dark:border-[#132E74]/70">
          {node.subtasks.map((child) => (
            <SubtaskItem
              key={child.id}
              node={child}
              onToggle={onToggle}
              onAddChild={onAddChild}
              onDelete={onDelete}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function TaskSubtasksSection({
  rootTaskId,
  subtasks,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  disabled = false,
}: TaskSubtasksSectionProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const { total, completed } = countSubtasks(subtasks);
  const percentage = total === 0 ? 0 : Math.round((completed / total) * 100);

  const handleRootSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed || disabled) return;
    onAddSubtask(trimmed, rootTaskId);
    setNewSubtaskTitle("");
  };

  return (
    <div className="space-y-2.5">
      {/* Calm Header with progress counter */}
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          Subtasks
        </label>
        {total > 0 && (
          <span className="text-[11px] font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
            {completed}/{total} completed
          </span>
        )}
      </div>

      {/* Hair-thin animated Bubblegum Pink progress bar */}
      {total > 0 && (
        <div
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Subtasks progress"
          className="h-1 w-full overflow-hidden rounded-full bg-[#E4E8F2] dark:bg-[#132E74]"
        >
          <div
            className="h-full rounded-full bg-[#FD91CC] transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      {/* Subtasks List */}
      {subtasks.length > 0 && (
        <div className="space-y-1.5 pt-0.5">
          {subtasks.map((st) => (
            <SubtaskItem
              key={st.id}
              node={st}
              onToggle={onToggleSubtask}
              onAddChild={onAddSubtask}
              onDelete={onDeleteSubtask}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {/* Rapid inline addition input */}
      <form onSubmit={handleRootSubmit} className="flex gap-1.5 pt-0.5">
        <input
          type="text"
          value={newSubtaskTitle}
          onChange={(e) => setNewSubtaskTitle(e.target.value)}
          placeholder="+ Add subtask..."
          disabled={disabled}
          className="flex-1 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1 text-xs text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white dark:placeholder:text-[#9BB0D3]/50"
        />
        <button
          type="submit"
          disabled={!newSubtaskTitle.trim() || disabled}
          aria-label="Add subtask"
          className="flex items-center justify-center rounded-lg bg-[#09318D] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0D41B4] disabled:opacity-40 transition-colors cursor-pointer focus-ring-pink dark:bg-[#0D41B4] dark:hover:bg-[#134EC9]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
