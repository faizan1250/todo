"use client";

import * as React from "react";
import { Check, Trash2, Calendar, Tag, CheckSquare, Repeat, Clock, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatEstimate } from "@/lib/adapters";
import type { TaskItem } from "./types";

interface TaskRowProps {
  task: TaskItem;
  isSelected?: boolean;
  isBulkSelected?: boolean;
  hasBulkSelection?: boolean;
  onToggleComplete: (id: string) => void;
  onSelect: (task: TaskItem) => void;
  onDelete: (id: string) => void;
  onToggleBulkSelect?: (id: string, shiftKey: boolean) => void;
}

export function TaskRow({
  task,
  isSelected = false,
  isBulkSelected = false,
  hasBulkSelection = false,
  onToggleComplete,
  onSelect,
  onDelete,
  onToggleBulkSelect,
}: TaskRowProps) {
  const isSelectionMode = Boolean(hasBulkSelection || isBulkSelected);

  const isHighPriority =
    task.priority === "high" || (task.numericPriority !== undefined && task.numericPriority >= 3);

  const completedSubtasks = task.subtasks.filter((s) => s.completed).length;
  const totalSubtasks = task.subtasks.length;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Task: ${task.title}`}
      onClick={(e) => {
        if (onToggleBulkSelect && (e.shiftKey || e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          onToggleBulkSelect(task.id, e.shiftKey);
        } else {
          onSelect(task);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onSelect(task);
        } else if (e.key === " ") {
          e.preventDefault();
          onToggleComplete(task.id);
        }
      }}
      className={cn(
        "group relative flex items-center justify-between gap-3 border-b border-[#E4E8F2]/60 last:border-b-0 py-3 px-3.5 transition-colors duration-150 cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-[#FD91CC] focus:ring-offset-1 dark:border-[#132E74]/50 dark:focus:ring-offset-[#051A4D]",
        isBulkSelected
          ? "bg-[#F2F5FC] ring-1 ring-[#09318D]/40 dark:bg-[#082363] dark:ring-[#FD91CC]/30"
          : isSelected
          ? "bg-[#F2F5FC] dark:bg-[#082363]"
          : "hover:bg-[#F2F5FC]/60 dark:hover:bg-[#082363]/40",
        task.completed && "opacity-70"
      )}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {/* Multi-Select Checkbox Column - ONLY rendered when selection mode is active */}
        {isSelectionMode && onToggleBulkSelect && (
          <div className="flex items-center justify-center shrink-0">
            <button
              type="button"
              role="checkbox"
              aria-checked={isBulkSelected}
              aria-label={
                isBulkSelected
                  ? `Deselect ${task.title}`
                  : `Select ${task.title} for bulk actions`
              }
              onClick={(e) => {
                e.stopPropagation();
                onToggleBulkSelect(task.id, e.shiftKey);
              }}
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#FD91CC]",
                isBulkSelected
                  ? "border-[#09318D] bg-[#09318D] text-white dark:border-[#FD91CC] dark:bg-[#FD91CC] dark:text-[#051A4D]"
                  : "border-[#CAD5E8] bg-white hover:border-[#09318D] dark:border-[#1F459E] dark:bg-[#051A4D] dark:hover:border-[#FD91CC]"
              )}
            >
              {isBulkSelected && (
                <Check className="h-2.5 w-2.5 stroke-[3] animate-in zoom-in-50 duration-150" />
              )}
            </button>
          </div>
        )}

        {/* Primary Completion Circle - Uncrowded, easy to tap */}
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
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-150 cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#FD91CC]",
            task.completed
              ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D] shadow-xs"
              : "border-[#CAD5E8] bg-white hover:border-[#09318D] dark:border-[#1F459E] dark:bg-[#051A4D] dark:hover:border-[#FD91CC]"
          )}
        >
          {task.completed && (
            <Check className="h-3 w-3 stroke-[3] animate-in zoom-in-50 duration-150" />
          )}
        </button>

        {/* Subtle Priority Indicator: quiet rose dot for High/Urgent, hidden for normal/low */}
        {isHighPriority && (
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-rose-500"
            title="High Priority"
          />
        )}

        {/* Task Title & Quiet Meta Info */}
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

          {/* Subtitle Details: Due Date, Recurrence, Estimate, Location, Subtask Progress, Folder */}
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
            {task.dueDate && (
              <span className="flex items-center gap-1 font-mono">
                <Calendar className="h-3 w-3" />
                <span>{task.dueDate}</span>
              </span>
            )}

            {task.recurrenceId && (
              <span
                data-testid="task-recurrence-badge"
                title="Recurring task"
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium bg-[#09318D]/10 text-[#09318D] dark:bg-[#FD91CC]/15 dark:text-[#FFA8D7]"
              >
                <Repeat className="h-3 w-3" />
                <span>Repeat</span>
              </span>
            )}

            {Boolean(task.estimateMin) && (
              <span
                data-testid="task-estimate-badge"
                title={`Estimated: ${formatEstimate(task.estimateMin)}`}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
              >
                <Clock className="h-3 w-3" />
                <span>{formatEstimate(task.estimateMin)}</span>
              </span>
            )}

            {Boolean(task.locationName) && (
              <span
                data-testid="task-location-badge"
                title={`Location: ${task.locationName}`}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] font-medium max-w-[130px] truncate bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
              >
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{task.locationName}</span>
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

      {/* Right Side: Tags & Hover Delete Action (Redundant uppercase priority badge removed) */}
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

        {/* Quick Delete Action - Revealed only on row hover/focus */}
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
