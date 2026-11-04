"use client";

import * as React from "react";
import { useState } from "react";
import { Check, Plus, Trash2, CornerDownRight, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { HierarchicalSubtask, Priority } from "./types";

interface SubtaskTreeSectionProps {
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

interface SubtaskNodeProps {
  node: HierarchicalSubtask;
  onToggle: (id: string, completed: boolean) => void;
  onAddChild: (title: string, parentId: string) => void;
  onDelete: (id: string) => void;
  disabled?: boolean;
}

function SubtaskNode({
  node,
  onToggle,
  onAddChild,
  onDelete,
  disabled,
}: SubtaskNodeProps) {
  const [isAddingChild, setIsAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState("");

  const depth = node.depth ?? 2;
  const isMaxDepth = depth >= 3;

  const handleAddChildSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = childTitle.trim();
    if (!trimmed || isMaxDepth || disabled) return;
    onAddChild(trimmed, node.id);
    setChildTitle("");
    setIsAddingChild(false);
  };

  const priorityColor = (p?: Priority) => {
    switch (p) {
      case "high":
        return "bg-rose-500";
      case "med":
        return "bg-amber-500";
      case "low":
        return "bg-blue-500";
      default:
        return "bg-blue-500/60";
    }
  };

  return (
    <div className="space-y-1">
      {/* Node Row */}
      <div className="group flex items-center justify-between gap-2 rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/50 px-2.5 py-1.5 text-xs transition-colors hover:border-[#CAD5E8] dark:border-[#132E74] dark:bg-[#082363]/40 dark:hover:border-[#1F459E]">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Checkbox */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onToggle(node.id, node.completed)}
            aria-label={node.completed ? `Mark "${node.title}" incomplete` : `Mark "${node.title}" complete`}
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all cursor-pointer focus-ring-pink",
              node.completed
                ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D]"
                : "border-[#CAD5E8] bg-white hover:border-[#09318D] dark:border-[#1F459E] dark:bg-[#051A4D]"
            )}
          >
            {node.completed && <Check className="h-3 w-3 stroke-[3]" />}
          </button>

          {/* Priority Dot */}
          <span
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", priorityColor(node.priority))}
            title={`Priority: ${node.priority ?? "low"}`}
          />

          {/* Depth Badge */}
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.2 font-mono text-[10px] font-bold leading-tight",
              depth === 2
                ? "bg-[#E4E8F2] text-[#09318D] dark:bg-[#132E74] dark:text-[#FFA8D7]"
                : "bg-[#CAD5E8]/60 text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]"
            )}
          >
            L{depth}
          </span>

          {/* Title */}
          <span
            className={cn(
              "truncate transition-all text-[#0B1220] dark:text-white",
              node.completed && "line-through text-[#5B6478]/70 dark:text-[#9BB0D3]/60"
            )}
          >
            {node.title}
          </span>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-1">
          {/* Nested Subtask Add / Max Depth Badge */}
          {isMaxDepth ? (
            <span
              title="Maximum nesting depth of 3 levels reached"
              className="text-[10px] font-medium text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic cursor-default"
            >
              Max depth (3) reached
            </span>
          ) : (
            <button
              type="button"
              disabled={disabled}
              onClick={() => setIsAddingChild((prev) => !prev)}
              aria-label={`Add nested subtask to ${node.title}`}
              className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[11px] font-medium text-[#09318D] hover:underline dark:text-[#FFA8D7] transition-opacity px-1 py-0.5 rounded cursor-pointer"
            >
              + Subtask
            </button>
          )}

          {/* Delete Node */}
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
      {isAddingChild && !isMaxDepth && (
        <form
          onSubmit={handleAddChildSubmit}
          className="ml-4 flex items-center gap-1.5 border-l-2 border-[#FD91CC]/60 pl-2.5 py-1"
        >
          <CornerDownRight className="h-3 w-3 text-[#FD91CC] shrink-0" />
          <input
            type="text"
            autoFocus
            value={childTitle}
            onChange={(e) => setChildTitle(e.target.value)}
            placeholder={`Add L${depth + 1} subtask...`}
            className="flex-1 rounded-md border border-[#E4E8F2] bg-white px-2 py-0.5 text-xs placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
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
            className="text-[#5B6478] hover:text-rose-500 p-0.5 cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </form>
      )}

      {/* Nested Children Tree */}
      {node.subtasks && node.subtasks.length > 0 && (
        <div className="ml-3 border-l-2 border-[#E4E8F2] pl-2.5 space-y-1 my-1 dark:border-[#132E74]">
          {node.subtasks.map((child) => (
            <SubtaskNode
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

export function SubtaskTreeSection({
  rootTaskId,
  subtasks,
  onToggleSubtask,
  onAddSubtask,
  onDeleteSubtask,
  disabled = false,
}: SubtaskTreeSectionProps) {
  const [newSubtaskTitle, setNewSubtaskTitle] = useState("");

  const { total, completed } = countSubtasks(subtasks);

  const handleRootSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed || disabled) return;
    onAddSubtask(trimmed, rootTaskId);
    setNewSubtaskTitle("");
  };

  return (
    <div className="space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          Subtasks (Tree)
        </label>
        <span className="text-[11px] font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
          {completed}/{total}
        </span>
      </div>

      {/* Subtask Tree List */}
      {subtasks.length > 0 && (
        <div className="space-y-1.5 pt-0.5">
          {subtasks.map((st) => (
            <SubtaskNode
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

      {/* Add Top-Level Subtask Form */}
      <form onSubmit={handleRootSubmit} className="flex gap-1.5 pt-0.5">
        <input
          type="text"
          value={newSubtaskTitle}
          onChange={(e) => setNewSubtaskTitle(e.target.value)}
          placeholder="Add subtask (L2)..."
          disabled={disabled}
          className="flex-1 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1 text-xs placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white dark:placeholder:text-[#9BB0D3]/50"
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
