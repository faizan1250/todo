"use client";

import * as React from "react";
import { Check, Trash2, Calendar, Tag, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TaskItem } from "./types";

interface TaskRowProps {
  task: TaskItem;
  isSelected?: boolean;
  onToggleComplete: (id: string) => void;
  onSelect: (task: TaskItem) => void;
  onDelete: (id: string) => void;
}

export function TaskRow({
  task,
  isSelected = false,
  onToggleComplete,
  onSelect,
  onDelete,
}: TaskRowProps) {
  const priorityConfig = {
    high: {
      label: "P1 High",
      dotClass: "bg-rose-500",
      chipClass:
        "bg-rose-50 text-rose-700 border-rose-200/80 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/40",
    },
    med: {
      label: "P2 Med",
      dotClass: "bg-amber-500",
      chipClass:
        "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40",
    },
    low: {
      label: "P3 Low",
      dotClass: "bg-[#09318D] dark:bg-[#9BB0D3]",
      chipClass:
        "bg-[#F2F5FC] text-[#09318D] border-[#D1DCF0] dark:bg-[#082363] dark:text-[#9BB0D3] dark:border-[#16367F]",
    },
  }[task.priority];

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const totalSubtasks = task.subtasks.length;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}`}
      onClick={() => onSelect(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSelect(task);
        } else if (e.key === " ") {
          e.preventDefault();
          onToggleComplete(task.id);
        }
      }}
      className={cn(
        "group relative flex items-center justify-between gap-3 rounded-xl border p-3.5 sm:px-4 sm:py-3 transition-all duration-150 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#FD91CC] focus:ring-offset-1 dark:focus:ring-offset-[#051A4D]",
        isSelected
          ? "border-[#09318D] bg-[#F2F5FC] shadow-sm dark:border-[#FD91CC] dark:bg-[#082363]"
          : "border-[#E4E8F2] bg-white hover:border-[#CAD5E8] hover:shadow-2xs dark:border-[#132E74] dark:bg-[#082363]/50 dark:hover:border-[#1E4396]",
        task.completed && "opacity-75 bg-[#FAFAFC] dark:bg-[#061D52]/40"
      )}
    >
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        {/* Custom Animated Checkbox with Bubblegum Accent */}
        <button
          type="button"
          role="checkbox"
          aria-checked={task.completed}
          aria-label={task.completed ? "Mark task incomplete" : "Mark task complete"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleComplete(task.id);
          }}
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#FD91CC]",
            task.completed
              ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D] scale-105 shadow-xs"
              : "border-[#CAD5E8] bg-white hover:border-[#09318D] dark:border-[#1F459E] dark:bg-[#051A4D] dark:hover:border-[#FD91CC]"
          )}
        >
          {task.completed && (
            <Check className="h-3.5 w-3.5 stroke-[3] animate-in zoom-in-50 duration-150" />
          )}
        </button>

        {/* Priority Color Dot */}
        <span
          className={cn("h-2 w-2 shrink-0 rounded-full", priorityConfig.dotClass)}
          title={priorityConfig.label}
        />

        {/* Task Title & Meta Info */}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "truncate text-sm font-medium transition-all duration-150",
              task.completed
                ? "line-through text-[#5B6478]/70 dark:text-[#9BB0D3]/60"
                : "text-[#0B1220] dark:text-[#F8FAFC]"
            )}
          >
            {task.title}
          </p>

          {/* Subtitle Details: Due Date, Subtask Count, Folder */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
            {task.dueDate && (
              <span className="flex items-center gap-1 font-mono">
                <Calendar className="h-3 w-3" />
                <span>{task.dueDate}</span>
              </span>
            )}

            {totalSubtasks > 0 && (
              <span className="flex items-center gap-1 font-mono">
                <CheckSquare className="h-3 w-3" />
                <span>
                  {completedSubtasks}/{totalSubtasks}
                </span>
              </span>
            )}

            <span className="capitalize font-mono text-[10px] text-[#5B6478]/80 dark:text-[#9BB0D3]/80">
              • {task.folder}
            </span>
          </div>
        </div>
      </div>

      {/* Right Side: Tags, Priority Badge & Delete Button */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Tag Chips */}
        {task.tags.slice(0, 2).map((tag) => (
          <span
            key={tag}
            className="hidden sm:inline-flex items-center gap-1 rounded-md border border-[#E4E8F2] bg-[#F2F5FC] px-2 py-0.5 text-[10px] font-medium text-[#5B6478] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3]"
          >
            <Tag className="h-2.5 w-2.5" />
            <span>{tag}</span>
          </span>
        ))}

        {/* Priority Badge */}
        <span
          className={cn(
            "rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider",
            priorityConfig.chipClass
          )}
        >
          {priorityConfig.label.split(" ")[1]}
        </span>

        {/* Quick Delete Action */}
        <button
          type="button"
          aria-label={`Delete ${task.title}`}
          onClick={(e) => {
            e.stopPropagation();
            onDelete(task.id);
          }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 flex h-7 w-7 items-center justify-center rounded-md text-[#5B6478] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-all cursor-pointer focus-ring-pink"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
