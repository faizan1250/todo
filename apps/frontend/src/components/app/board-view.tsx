"use client";

import * as React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { BackendBoardColumn, BackendViewTask } from "@/lib/api";

export interface BoardViewProps {
  columns?: BackendBoardColumn[];
  isLoading?: boolean;
  groupBy?: string;
  onGroupByChange?: (groupBy: string) => void;
  onMoveTask?: (
    taskId: string,
    column: string,
    afterId?: string,
    beforeId?: string
  ) => Promise<void> | void;
  onSelectTask?: (taskId: string) => void;
  className?: string;
}

const GROUP_OPTIONS = ["section", "status", "priority"];

function priorityColor(priority: number): string {
  switch (priority) {
    case 4:
      return "bg-red-500";
    case 3:
      return "bg-orange-500";
    case 2:
      return "bg-blue-500";
    case 1:
      return "bg-slate-400";
    default:
      return "bg-slate-300";
  }
}

function priorityLabel(priority: number): string {
  switch (priority) {
    case 4:
      return "Urgent";
    case 3:
      return "High";
    case 2:
      return "Med";
    case 1:
      return "Low";
    default:
      return "None";
  }
}

export function BoardView({
  columns = [],
  isLoading = false,
  groupBy = "section",
  onGroupByChange,
  onMoveTask,
  onSelectTask,
  className,
}: BoardViewProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropColumn, setDropColumn] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggingId(taskId);
    e.dataTransfer.setData("text/plain", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragEnd = () => {
    setDraggingId(null);
    setDropColumn(null);
  };

  const handleColumnDragOver = (e: React.DragEvent, key: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropColumn(key);
  };

  const handleColumnDrop = async (e: React.DragEvent, key: string) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("text/plain") || draggingId;
    setDropColumn(null);
    setDraggingId(null);
    if (!taskId || !onMoveTask) return;
    await onMoveTask(taskId, key);
  };

  const handleCardDrop = async (e: React.DragEvent, columnKey: string, beforeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const taskId = e.dataTransfer.getData("text/plain") || draggingId;
    setDropColumn(null);
    setDraggingId(null);
    if (!taskId || taskId === beforeId || !onMoveTask) return;
    await onMoveTask(taskId, columnKey, undefined, beforeId);
  };

  if (isLoading && columns.length === 0) {
    return (
      <div className={cn("flex h-full gap-4 overflow-x-auto p-4", className)}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="w-72 shrink-0 space-y-3 rounded-lg border border-[#E4E8F2] p-3 dark:border-[#132E74]">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col bg-white dark:bg-[#051A4D]", className)}>
      <div className="flex items-center justify-between gap-2 border-b border-[#E4E8F2] px-4 py-3 dark:border-[#132E74]">
        <h2 className="text-lg font-semibold text-[#051A4D] dark:text-white">Board</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-[#5B6478] dark:text-[#9BB0D3]">Group by</span>
          <select
            value={groupBy}
            onChange={(e) => onGroupByChange?.(e.target.value)}
            className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white"
          >
            {GROUP_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        <div className="flex h-full gap-4">
          {columns.map((col) => (
            <div
              key={col.key}
              onDragOver={(e) => handleColumnDragOver(e, col.key)}
              onDragLeave={() => setDropColumn((prev) => (prev === col.key ? null : prev))}
              onDrop={(e) => handleColumnDrop(e, col.key)}
              className={cn(
                "flex w-72 shrink-0 flex-col rounded-lg border bg-[#F4F6FB] p-3 dark:bg-[#0A2A6B]",
                dropColumn === col.key
                  ? "border-[#09318D] dark:border-[#FD91CC]"
                  : "border-[#E4E8F2] dark:border-[#132E74]"
              )}
            >
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-[#051A4D] dark:text-white">{col.title}</h3>
                <span className="rounded-full bg-white px-2 py-0.5 text-xs text-[#5B6478] dark:bg-[#051A4D] dark:text-[#9BB0D3]">
                  {col.count}
                </span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto">
                {isLoading ? (
                  Array.from({ length: 2 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                  ))
                ) : col.tasks.length === 0 ? (
                  <div className="rounded-md border border-dashed border-[#E4E8F2] p-4 text-center text-xs text-[#5B6478] dark:border-[#132E74] dark:text-[#9BB0D3]">
                    Empty
                  </div>
                ) : (
                  col.tasks.map((task: BackendViewTask) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => handleDragStart(e, task.id)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      onDrop={(e) => handleCardDrop(e, col.key, task.id)}
                      onClick={() => onSelectTask?.(task.id)}
                      className={cn(
                        "cursor-grab rounded-md border border-[#E4E8F2] bg-white p-3 shadow-sm transition hover:shadow-md dark:border-[#132E74] dark:bg-[#051A4D]",
                        draggingId === task.id && "opacity-50"
                      )}
                      style={
                        task.listColor ? { borderLeftWidth: 4, borderLeftColor: task.listColor } : undefined
                      }
                    >
                      <div className="mb-1 flex items-center gap-2">
                        <span className={cn("inline-block h-2 w-2 rounded-full", priorityColor(task.priority))} />
                        <span className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">{priorityLabel(task.priority)}</span>
                        {task.status && (
                          <span className="ml-auto text-xs text-[#5B6478] dark:text-[#9BB0D3]">{task.status}</span>
                        )}
                      </div>
                      <div className="text-sm font-medium text-[#051A4D] dark:text-white">{task.title}</div>
                      {typeof task.subtaskTotal === "number" && task.subtaskTotal > 0 && (
                        <div className="mt-2 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                          Subtasks: {task.subtaskDone ?? 0}/{task.subtaskTotal}
                        </div>
                      )}
                      {task.listName && (
                        <div className="mt-1 text-xs text-[#5B6478] dark:text-[#9BB0D3]">{task.listName}</div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}