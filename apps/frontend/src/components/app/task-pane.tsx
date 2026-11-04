"use client";

import * as React from "react";
import { useState, useMemo, useEffect, useRef } from "react";
import {
  Search,
  Plus,
  Filter,
  ChevronDown,
  ChevronRight,
  Pencil,
  Trash2,
  Check,
  X,
  FolderPlus,
  Loader2,
  Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  getSections,
  createSection,
  updateSection,
  deleteSection,
  type BackendSection,
} from "@/lib/api";
import { TaskRow } from "./task-row";
import { TaskRowSkeletonList } from "./task-skeleton";
import { EmptyState } from "./empty-state";
import type { TaskItem, ListId, FolderId, Priority } from "./types";

interface TaskPaneProps {
  tasks: TaskItem[];
  activeList: ListId;
  activeListId?: string | null;
  activeListName?: string;
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
    sectionId?: string | null;
  }) => void;
  isLoading?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleSelectTask?: (id: string, shiftKey?: boolean, visibleTaskIds?: string[]) => void;
}

export function TaskPane({
  tasks,
  activeList,
  activeListId = null,
  activeListName,
  activeFolder,
  selectedTaskId,
  onSelectTask,
  onToggleComplete,
  onDeleteTask,
  onAddTask,
  isLoading = false,
  selectedTaskIds,
  onToggleSelectTask,
}: TaskPaneProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "completed">("all");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "all">("all");

  // Sections State
  const [sections, setSections] = useState<BackendSection[]>([]);
  const [collapsedSectionIds, setCollapsedSectionIds] = useState<Set<string>>(() => new Set());
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null);
  const [editSectionName, setEditSectionName] = useState("");
  const [isAddingSection, setIsAddingSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [isSectionSubmitting, setIsSectionSubmitting] = useState(false);

  // Section-targeted quick add state
  const [activeSectionForNewTask, setActiveSectionForNewTask] = useState<string | null>(null);
  const [sectionTaskTitle, setSectionTaskTitle] = useState("");
  const [sectionTaskPriority, setSectionTaskPriority] = useState<Priority>("med");

  // Main New Task form state
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("med");
  const [newFolder, setNewFolder] = useState<FolderId>(activeFolder || "engineering");

  const newSectionInputRef = useRef<HTMLInputElement>(null);
  const editSectionInputRef = useRef<HTMLInputElement>(null);
  const sectionTaskInputRef = useRef<HTMLInputElement>(null);

  const listTitles: Record<string, string> = {
    today: "Today",
    upcoming: "Upcoming",
    backlog: "Backlog",
    completed: "Completed",
  };

  const resolvedTitle =
    activeListName ||
    listTitles[activeList] ||
    (activeList === "today"
      ? "Today"
      : activeList === "upcoming"
      ? "Upcoming"
      : activeList === "completed"
      ? "Completed"
      : "Tasks");

  // Fetch sections whenever activeListId changes
  useEffect(() => {
    if (!activeListId) return;

    let isMounted = true;

    getSections(activeListId)
      .then((data) => {
        if (isMounted) {
          setSections(data);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error("Failed to load sections for list:", err);
          setSections([]);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [activeListId]);

  const effectiveSections = useMemo(() => {
    return activeListId ? sections : [];
  }, [activeListId, sections]);

  // Focus input when adding section
  useEffect(() => {
    if (isAddingSection) {
      newSectionInputRef.current?.focus();
    }
  }, [isAddingSection]);

  // Focus input when editing section
  useEffect(() => {
    if (editingSectionId) {
      editSectionInputRef.current?.focus();
    }
  }, [editingSectionId]);

  // Focus input when adding task to section
  useEffect(() => {
    if (activeSectionForNewTask) {
      sectionTaskInputRef.current?.focus();
    }
  }, [activeSectionForNewTask]);

  // Filter tasks based on active list, active folder, search query, status, and priority
  const filteredTasks = useMemo(() => {
    return tasks.filter((task) => {
      // 1. List filter
      if (activeListId) {
        // If viewing a specific backend list, match task.listId
        if (task.listId && task.listId !== activeListId) {
          return false;
        }
      } else if (activeList === "completed") {
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
  }, [tasks, activeList, activeListId, activeFolder, statusFilter, priorityFilter, searchQuery]);

  // Group tasks into unsectioned vs sectioned
  const { unsectionedTasks, sectionTasksMap } = useMemo(() => {
    if (effectiveSections.length === 0) {
      return { unsectionedTasks: filteredTasks, sectionTasksMap: new Map<string, TaskItem[]>() };
    }

    const map = new Map<string, TaskItem[]>();
    for (const s of effectiveSections) {
      map.set(s.id, []);
    }

    const unsectioned: TaskItem[] = [];

    for (const task of filteredTasks) {
      if (task.sectionId && map.has(task.sectionId)) {
        map.get(task.sectionId)!.push(task);
      } else {
        unsectioned.push(task);
      }
    }

    return { unsectionedTasks: unsectioned, sectionTasksMap: map };
  }, [filteredTasks, effectiveSections]);

  // Main task creation handler
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

  // Section-targeted task creation handler
  const handleCreateTaskForSection = (sectionId: string, e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = sectionTaskTitle.trim();
    if (!trimmed) return;

    onAddTask({
      title: trimmed,
      priority: sectionTaskPriority,
      folder: activeFolder || "engineering",
      list: activeList === "completed" ? "today" : activeList,
      sectionId,
    });

    setSectionTaskTitle("");
    setActiveSectionForNewTask(null);
  };

  // Toggle section collapse
  const toggleSectionCollapse = (sectionId: string) => {
    setCollapsedSectionIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  // Add Section Submit
  const handleAddSectionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeListId) return;
    const trimmed = newSectionName.trim();
    if (!trimmed) return;

    setIsSectionSubmitting(true);
    try {
      const created = await createSection(activeListId, trimmed);
      setSections((prev) => [...prev, created]);
      setNewSectionName("");
      setIsAddingSection(false);
    } catch (err) {
      console.error("Failed to create section:", err);
    } finally {
      setIsSectionSubmitting(false);
    }
  };

  // Rename Section Submit
  const handleRenameSectionSubmit = async (sectionId: string, e?: React.FormEvent) => {
    e?.preventDefault();
    const trimmed = editSectionName.trim();
    if (!trimmed) {
      setEditingSectionId(null);
      return;
    }

    setIsSectionSubmitting(true);
    try {
      const updated = await updateSection(sectionId, trimmed);
      setSections((prev) => prev.map((s) => (s.id === sectionId ? updated : s)));
      setEditingSectionId(null);
    } catch (err) {
      console.error("Failed to rename section:", err);
    } finally {
      setIsSectionSubmitting(false);
    }
  };

  // Delete Section Handler
  const handleDeleteSection = async (section: BackendSection) => {
    if (
      !window.confirm(
        `Delete section "${section.name}"? Tasks inside will become unsectioned.`
      )
    ) {
      return;
    }

    try {
      await deleteSection(section.id);
      setSections((prev) => prev.filter((s) => s.id !== section.id));
    } catch (err) {
      console.error("Failed to delete section:", err);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[#F2F5FC]/40 dark:bg-[#051A4D]/40">
      {/* Workspace Header Toolbar */}
      <div className="border-b border-[#E4E8F2] bg-white px-4 py-4 sm:px-6 dark:border-[#132E74] dark:bg-[#051A4D]">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#0B1220] dark:text-white">
                {resolvedTitle}
              </h1>
              {activeFolder && (
                <Badge variant="accent" className="capitalize text-[11px]">
                  {activeFolder}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
              {filteredTasks.length} {filteredTasks.length === 1 ? "task" : "tasks"} showing
              {effectiveSections.length > 0 && ` • ${effectiveSections.length} ${effectiveSections.length === 1 ? "section" : "sections"}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Add Section Action Button (shown when viewing a specific list) */}
            {activeListId && !isAddingSection && (
              <button
                type="button"
                onClick={() => setIsAddingSection(true)}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[#E4E8F2] bg-white px-3 py-1.5 text-xs font-semibold text-[#5B6478] hover:border-[#09318D] hover:text-[#09318D] transition-colors focus-ring-pink dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3] dark:hover:border-[#FD91CC] dark:hover:text-[#FFA8D7] cursor-pointer"
              >
                <Layers className="h-3.5 w-3.5" />
                <span>Add Section</span>
              </button>
            )}

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

          {/* Priority Quick Filter & Mobile Add Section */}
          <div className="flex items-center gap-3">
            {activeListId && !isAddingSection && (
              <button
                type="button"
                onClick={() => setIsAddingSection(true)}
                className="sm:hidden inline-flex items-center gap-1 text-xs font-semibold text-[#09318D] dark:text-[#FFA8D7] cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Section</span>
              </button>
            )}

            <div className="flex items-center gap-1.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
              <Filter className="h-3 w-3" />
              <span>Priority:</span>
              {[
                { id: "all" as const, label: "All" },
                { id: "high" as const, label: "High" },
                { id: "med" as const, label: "Medium" },
                { id: "low" as const, label: "Low" },
              ].map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPriorityFilter(p.id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors cursor-pointer",
                    priorityFilter === p.id
                      ? "bg-[#09318D] text-white font-semibold dark:bg-[#FD91CC] dark:text-[#051A4D]"
                      : "hover:bg-[#E4E8F2] text-[#5B6478] dark:hover:bg-[#082363] dark:text-[#9BB0D3]"
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Main Workspace Body */}
      <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto w-full">
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
              placeholder={`Add task to ${resolvedTitle}... (Press Enter)`}
              className="flex-1 bg-transparent px-2 py-1 text-sm font-medium text-[#0B1220] placeholder:text-[#5B6478]/60 focus:outline-none dark:text-white dark:placeholder:text-[#9BB0D3]/60"
            />

            <div className="flex items-center justify-between sm:justify-end gap-2 border-t border-[#E4E8F2] pt-2 sm:border-t-0 sm:pt-0 dark:border-[#132E74]">
              {/* Priority Choice */}
              <div className="flex items-center gap-1">
                {[
                  { id: "high" as const, label: "High" },
                  { id: "med" as const, label: "Medium" },
                  { id: "low" as const, label: "Low" },
                ].map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setNewPriority(p.id)}
                    className={cn(
                      "rounded px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer",
                      newPriority === p.id
                        ? "bg-[#09318D] text-white font-semibold dark:bg-[#FD91CC] dark:text-[#051A4D]"
                        : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D]"
                    )}
                  >
                    {p.label}
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

        {/* Inline Add Section Form (Top) */}
        {isAddingSection && (
          <form
            onSubmit={handleAddSectionSubmit}
            className="flex items-center gap-2 rounded-xl border-2 border-dashed border-[#09318D]/40 bg-[#09318D]/5 p-3 dark:border-[#FD91CC]/40 dark:bg-[#FD91CC]/5"
          >
            <Layers className="h-4 w-4 text-[#09318D] dark:text-[#FD91CC]" />
            <input
              ref={newSectionInputRef}
              type="text"
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              placeholder="Section Name (e.g., In Progress, Backlog, Ready for Review)..."
              disabled={isSectionSubmitting}
              className="flex-1 bg-transparent text-sm font-semibold text-[#0B1220] placeholder:text-[#5B6478]/70 focus:outline-none dark:text-white dark:placeholder:text-[#9BB0D3]/60"
            />
            <div className="flex items-center gap-1.5">
              <button
                type="submit"
                disabled={isSectionSubmitting || !newSectionName.trim()}
                className="btn-primary-depth inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-xs disabled:opacity-40 cursor-pointer focus-ring-pink"
              >
                {isSectionSubmitting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                <span>Save Section</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsAddingSection(false);
                  setNewSectionName("");
                }}
                disabled={isSectionSubmitting}
                className="rounded-lg border border-[#E4E8F2] bg-white p-1.5 text-xs text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* Task Rows List with Optional Section Grouping */}
        {isLoading ? (
          <TaskRowSkeletonList count={5} />
        ) : filteredTasks.length === 0 ? (
          searchQuery.trim().length > 0 ? (
            <EmptyState
              type="search"
              searchQuery={searchQuery}
              onAction={() => setSearchQuery("")}
              actionLabel="Clear search"
              secondaryAction={
                statusFilter !== "all" || priorityFilter !== "all"
                  ? () => {
                      setStatusFilter("all");
                      setPriorityFilter("all");
                    }
                  : undefined
              }
              secondaryActionLabel="Reset filters"
            />
          ) : statusFilter !== "all" || priorityFilter !== "all" ? (
            <EmptyState
              type="filter"
              onAction={() => {
                setStatusFilter("all");
                setPriorityFilter("all");
              }}
              actionLabel="Reset filters"
            />
          ) : (
            <EmptyState
              activeList={activeList}
              activeFolder={activeFolder}
              onAction={() => {
                const input = document.querySelector<HTMLInputElement>(
                  "input[placeholder*='Add task']"
                );
                input?.focus();
              }}
              actionLabel={
                activeList === "completed"
                  ? "View active tasks"
                  : activeFolder
                  ? `Create task in ${activeFolder}`
                  : "Create a task"
              }
            />
          )
        ) : effectiveSections.length === 0 ? (
          /* Render Flat Task List when no sections exist */
          <div className="rounded-xl border border-[#E4E8F2] bg-white shadow-xs dark:border-[#132E74] dark:bg-[#082363]/50 overflow-hidden">
            {filteredTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                isSelected={selectedTaskId === task.id}
                isBulkSelected={selectedTaskIds?.has(task.id)}
                hasBulkSelection={(selectedTaskIds?.size ?? 0) > 0}
                onSelect={onSelectTask}
                onToggleComplete={onToggleComplete}
                onDelete={onDeleteTask}
                onToggleBulkSelect={
                  onToggleSelectTask
                    ? (id, shiftKey) =>
                        onToggleSelectTask(
                          id,
                          shiftKey,
                          filteredTasks.map((t) => t.id)
                        )
                    : undefined
                }
              />
            ))}
          </div>
        ) : (
          /* Render Collapsible Sections Grouping */
          <div className="space-y-6">
            {/* 1. Unsectioned Tasks First */}
            {unsectionedTasks.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between px-1 text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                  <span>Unsectioned Tasks</span>
                  <span className="rounded-full bg-[#F2F5FC] px-2 py-0.5 font-mono text-[10px] text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]">
                    {unsectionedTasks.length}
                  </span>
                </div>
                <div className="rounded-xl border border-[#E4E8F2] bg-white shadow-xs dark:border-[#132E74] dark:bg-[#082363]/50 overflow-hidden">
                  {unsectionedTasks.map((task) => (
                    <TaskRow
                      key={task.id}
                      task={task}
                      isSelected={selectedTaskId === task.id}
                      isBulkSelected={selectedTaskIds?.has(task.id)}
                      hasBulkSelection={(selectedTaskIds?.size ?? 0) > 0}
                      onSelect={onSelectTask}
                      onToggleComplete={onToggleComplete}
                      onDelete={onDeleteTask}
                      onToggleBulkSelect={
                        onToggleSelectTask
                          ? (id, shiftKey) =>
                              onToggleSelectTask(
                                id,
                                shiftKey,
                                filteredTasks.map((t) => t.id)
                              )
                          : undefined
                      }
                    />
                  ))}
                </div>
              </div>
            )}

            {/* 2. Sectioned Tasks */}
            {effectiveSections.map((section) => {
              const sectionTasks = sectionTasksMap.get(section.id) || [];
              const isCollapsed = collapsedSectionIds.has(section.id);
              const isEditing = editingSectionId === section.id;
              const isAddingTaskHere = activeSectionForNewTask === section.id;

              return (
                <div
                  key={section.id}
                  className="rounded-xl border border-[#E4E8F2] bg-white/70 p-3 shadow-xs dark:border-[#132E74] dark:bg-[#082363]/60 transition-all"
                >
                  {/* Collapsible Section Header */}
                  <div className="flex items-center justify-between gap-2 pb-2">
                    {/* Left: Collapse Toggle + Section Name */}
                    <div className="flex flex-1 items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleSectionCollapse(section.id)}
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] cursor-pointer"
                        aria-label={isCollapsed ? `Expand section ${section.name}` : `Collapse section ${section.name}`}
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>

                      {isEditing ? (
                        <form
                          onSubmit={(e) => handleRenameSectionSubmit(section.id, e)}
                          className="flex items-center gap-1.5 flex-1 max-w-sm"
                        >
                          <input
                            ref={editSectionInputRef}
                            type="text"
                            value={editSectionName}
                            onChange={(e) => setEditSectionName(e.target.value)}
                            disabled={isSectionSubmitting}
                            className="flex-1 rounded border border-[#09318D] bg-white px-2 py-0.5 text-xs font-bold text-[#0B1220] focus:outline-none dark:border-[#FD91CC] dark:bg-[#051A4D] dark:text-white"
                          />
                          <button
                            type="submit"
                            disabled={isSectionSubmitting || !editSectionName.trim()}
                            className="rounded p-1 text-[#09318D] hover:bg-[#E4E8F2] dark:text-[#FD91CC] cursor-pointer"
                            title="Save"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingSectionId(null)}
                            disabled={isSectionSubmitting}
                            className="rounded p-1 text-[#5B6478] hover:bg-[#E4E8F2] dark:text-[#9BB0D3] cursor-pointer"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </form>
                      ) : (
                        <div
                          onDoubleClick={() => {
                            setEditingSectionId(section.id);
                            setEditSectionName(section.name);
                          }}
                          className="flex items-center gap-2 cursor-pointer select-none truncate"
                          title="Double-click to rename"
                        >
                          <span className="text-xs sm:text-sm font-bold text-[#0B1220] dark:text-white truncate">
                            {section.name}
                          </span>
                          {/* Task count pill */}
                          <span className="rounded-full bg-[#F2F5FC] px-2 py-0.5 text-[10px] font-mono font-semibold text-[#5B6478] dark:bg-[#051A4D] dark:text-[#9BB0D3]">
                            {sectionTasks.length} {sectionTasks.length === 1 ? "task" : "tasks"}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Right: Section Actions Toolbar */}
                    <div className="flex items-center gap-1">
                      {/* [+ Add Task to Section] */}
                      <button
                        type="button"
                        onClick={() => {
                          if (isCollapsed) {
                            toggleSectionCollapse(section.id);
                          }
                          setActiveSectionForNewTask(
                            activeSectionForNewTask === section.id ? null : section.id
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-[#09318D] hover:bg-[#09318D]/10 transition-colors dark:text-[#FFA8D7] dark:hover:bg-[#FD91CC]/20 cursor-pointer"
                        title="Add task to this section"
                      >
                        <Plus className="h-3 w-3" />
                        <span className="hidden sm:inline">Add task</span>
                      </button>

                      {/* Rename Section Button */}
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSectionId(section.id);
                          setEditSectionName(section.name);
                        }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] cursor-pointer"
                        title="Rename section"
                        aria-label={`Rename section ${section.name}`}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>

                      {/* Delete Section Button */}
                      <button
                        type="button"
                        onClick={() => handleDeleteSection(section)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-red-500 hover:bg-red-50 transition-colors dark:hover:bg-red-950/40 cursor-pointer"
                        title="Delete section"
                        aria-label={`Delete section ${section.name}`}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>

                  {/* Collapsible Section Body */}
                  {!isCollapsed && (
                    <div className="mt-2 space-y-2">
                      {/* Inline Quick Add Task for this Section */}
                      {isAddingTaskHere && (
                        <form
                          onSubmit={(e) => handleCreateTaskForSection(section.id, e)}
                          className="flex items-center gap-2 rounded-lg border border-[#09318D]/30 bg-white p-2 shadow-xs dark:border-[#FD91CC]/30 dark:bg-[#051A4D]"
                        >
                          <input
                            ref={sectionTaskInputRef}
                            type="text"
                            value={sectionTaskTitle}
                            onChange={(e) => setSectionTaskTitle(e.target.value)}
                            placeholder={`Task in "${section.name}"...`}
                            className="flex-1 bg-transparent px-1 text-xs font-medium text-[#0B1220] placeholder:text-[#5B6478]/60 focus:outline-none dark:text-white"
                          />
                          {/* Priority Picker */}
                          <div className="flex items-center gap-1">
                            {[
                              { id: "high" as const, label: "High" },
                              { id: "med" as const, label: "Medium" },
                              { id: "low" as const, label: "Low" },
                            ].map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setSectionTaskPriority(p.id)}
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[10px] font-medium cursor-pointer transition-colors",
                                  sectionTaskPriority === p.id
                                    ? "bg-[#09318D] text-white font-semibold dark:bg-[#FD91CC] dark:text-[#051A4D]"
                                    : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3]"
                                )}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                          <button
                            type="submit"
                            disabled={!sectionTaskTitle.trim()}
                            className="btn-primary-depth inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-40 cursor-pointer"
                          >
                            <Plus className="h-3 w-3" />
                            <span>Add</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setActiveSectionForNewTask(null);
                              setSectionTaskTitle("");
                            }}
                            className="rounded p-1 text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </form>
                      )}

                      {/* Section Tasks */}
                      {sectionTasks.length === 0 ? (
                        <div className="py-3 text-center text-xs text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic">
                          No tasks in this section yet. Click &quot;Add task&quot; to create one.
                        </div>
                      ) : (
                        <div className="rounded-xl border border-[#E4E8F2] bg-white shadow-xs dark:border-[#132E74] dark:bg-[#082363]/50 overflow-hidden">
                          {sectionTasks.map((task) => (
                            <TaskRow
                              key={task.id}
                              task={task}
                              isSelected={selectedTaskId === task.id}
                              isBulkSelected={selectedTaskIds?.has(task.id)}
                              hasBulkSelection={(selectedTaskIds?.size ?? 0) > 0}
                              onSelect={onSelectTask}
                              onToggleComplete={onToggleComplete}
                              onDelete={onDeleteTask}
                              onToggleBulkSelect={
                                onToggleSelectTask
                                  ? (id, shiftKey) =>
                                      onToggleSelectTask(
                                        id,
                                        shiftKey,
                                        filteredTasks.map((t) => t.id)
                                      )
                                  : undefined
                              }
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom [+ Add Section] Button (When viewing a specific backend list) */}
        {activeListId && !isAddingSection && (
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setIsAddingSection(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#E4E8F2] bg-white/40 py-3 text-xs font-semibold text-[#5B6478] hover:border-[#09318D] hover:bg-white hover:text-[#09318D] transition-all dark:border-[#132E74] dark:bg-[#082363]/40 dark:text-[#9BB0D3] dark:hover:border-[#FD91CC] dark:hover:text-[#FFA8D7] cursor-pointer"
            >
              <FolderPlus className="h-4 w-4" />
              <span>Add New Section</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
