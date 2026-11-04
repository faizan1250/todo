"use client";

import * as React from "react";
import { useState, useMemo } from "react";
import {
  Search,
  Plus,
  Filter,
  CheckCircle2,
  Calendar,
  Layers,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { TaskRow } from "./task-row";
import type { TaskItem, ListId, FolderId, Priority } from "./types";

interface TaskPaneProps {
  tasks: TaskItem[];
  activeList: ListId;
  activeFolder: FolderId | null;
  selectedTaskId: string | null;
  onSelectTask: (task: TaskItem) => void;
  onToggleComplete: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onAddTask: (newTask: {
    title: string;
    priority: Priority;
    folder: FolderId;
    list: ListId;
  }) => void;
  isLoading?: boolean;
}

export function TaskPane({
  tasks,
  activeList,
  activeFolder,
  selectedTaskId,
  onSelectTask,
  onToggleComplete,
  onDeleteTask,
  onAddTask,
  isLoading = false,
}: TaskPaneProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");

  // New Task form state
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("med");
  const [newFolder, setNewFolder] = useState<FolderId>(activeFolder || "engineering");

  const listTitles: Record<ListId, string> = {
    today: "Today's Milestones",
    upcoming: "Upcoming Sprints",
    backlog: "Engineering Backlog",
    completed: "Completed Archive",
  };

  // Filter tasks based on active list, active folder, search query, status, and priority
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 1. List filter (unless in completed view where all completed show)
      if (activeList === "completed") {
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
  }, [tasks, activeList, activeFolder, statusFilter, priorityFilter, searchQuery]);

  const handleCreateTask = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newTitle.trim();
    if (!trimmed) return;

    onAddTask({
      title: trimmed,
      priority: newPriority,
      folder: newFolder,
      list: activeList === "completed" ? "today" : activeList,
    });

    setNewTitle("");
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[#F2F5FC]/40 dark:bg-[#051A4D]/40">
      {/* Workspace Header Toolbar */}
      <div className="border-b border-[#E4E8F2] bg-white px-4 py-4 sm:px-6 dark:border-[#132E74] dark:bg-[#051A4D]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0B1220] dark:text-white">
                {listTitles[activeList]}
              </h1>
              {activeFolder && (
                <Badge variant="accent" className="capitalize text-[11px]">
                  {activeFolder}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
              {filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"} showing
            </p>
          </div>

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
            {(["all", "high", "med", "low"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriorityFilter(p)}
                className={cn(
                  "rounded px-2 py-0.5 text-[11px] font-mono capitalize transition-colors cursor-pointer",
                  priorityFilter === p
                    ? "bg-[#09318D] text-white font-bold dark:bg-[#FD91CC] dark:text-[#051A4D]"
                    : "hover:bg-[#E4E8F2] dark:hover:bg-[#082363]"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="p-4 sm:p-6 space-y-4 max-w-5xl mx-auto w-full">
        {/* Quick Add Task Input Card */}
        <form
          onSubmit={handleCreateTask}
          className="rounded-xl border border-[#E4E8F2] bg-white p-3 shadow-soft-blue transition-all focus-within:border-[#09318D] focus-within:ring-2 focus-within:ring-[#FD91CC]/50 dark:border-[#132E74] dark:bg-[#082363]"
        >
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={`Add task to ${listTitles[activeList]}... (Press Enter)`}
              className="flex-1 bg-transparent px-2 py-1 text-sm font-medium text-[#0B1220] placeholder:text-[#5B6478]/60 focus:outline-none dark:text-white dark:placeholder:text-[#9BB0D3]/60"
            />

            <div className="flex items-center justify-between sm:justify-end gap-2 border-t border-[#E4E8F2] pt-2 sm:border-t-0 sm:pt-0 dark:border-[#132E74]">
              {/* Priority Choice */}
              <div className="flex items-center gap-1">
                {(["high", "med", "low"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setNewPriority(p)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[10px] font-mono font-semibold uppercase transition-colors cursor-pointer",
                      newPriority === p
                        ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                        : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D]"
                    )}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Folder Choice */}
              <select
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value as FolderId)}
                className="rounded border border-[#E4E8F2] bg-white px-2 py-1 text-[11px] font-medium text-[#5B6478] focus:outline-none dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3]"
              >
                <option value="engineering">Engineering</option>
                <option value="design">Design</option>
                <option value="personal">Personal</option>
              </select>

              {/* Add Button */}
              <button
                type="submit"
                disabled={!newTitle.trim()}
                className="btn-primary-depth inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-xs disabled:opacity-40 cursor-pointer focus-ring-pink"
              >
                <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">Add</span>
              </button>
            </div>
          </div>
        </form>

        {/* Task Rows List */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-14 w-full animate-pulse rounded-xl border border-[#E4E8F2] bg-white dark:border-[#132E74] dark:bg-[#082363]"
              />
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#E4E8F2] bg-white/60 py-16 text-center dark:border-[#132E74] dark:bg-[#082363]/30">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#F2F5FC] text-[#09318D] dark:bg-[#051A4D] dark:text-[#FD91CC]">
              <CheckCircle2 className="h-6 w-6 stroke-[1.5]" />
            </div>
            <h3 className="mt-4 text-base font-bold text-[#0B1220] dark:text-white">
              No tasks found in this view
            </h3>
            <p className="mt-1 max-w-sm text-xs text-[#5B6478] dark:text-[#9BB0D3]">
              {searchQuery
                ? `No tasks matched your query "${searchQuery}". Try clearing search.`
                : "You're all caught up! Create a new task above or switch folders."}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isSelected={selectedTaskId === task.id}
                onSelect={onSelectTask}
                onToggleComplete={onToggleComplete}
                onDelete={onDeleteTask}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
