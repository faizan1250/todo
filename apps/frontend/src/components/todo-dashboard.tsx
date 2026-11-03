"use client";

import { useState, useId, type FormEvent } from "react";
import {
  CheckIcon,
  PlusIcon,
  TrashIcon,
  ListTodoIcon,
  SparklesIcon,
} from "./icons";

export type Priority = "p1" | "p2" | "p3";

export interface TodoItem {
  id: string;
  title: string;
  completed: boolean;
  priority: Priority;
  createdAt: string;
}

const INITIAL_TODOS: TodoItem[] = [
  {
    id: "task-1",
    title: "Verify ElysiaJS healthcheck endpoint contracts",
    completed: true,
    priority: "p1",
    createdAt: "Scaffold phase",
  },
  {
    id: "task-2",
    title: "Implement frontend Next.js App Router architecture",
    completed: true,
    priority: "p1",
    createdAt: "Scaffold phase",
  },
  {
    id: "task-3",
    title: "Configure shared workspace scripts and typecheck pipeline",
    completed: false,
    priority: "p2",
    createdAt: "Today",
  },
  {
    id: "task-4",
    title: "Integrate full CRUD state with backend REST API",
    completed: false,
    priority: "p3",
    createdAt: "Upcoming",
  },
];

const PRIORITY_CONFIG: Record<
  Priority,
  { label: string; badgeClass: string; indicatorClass: string }
> = {
  p1: {
    label: "High",
    badgeClass:
      "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-900/50",
    indicatorClass: "bg-rose-500",
  },
  p2: {
    label: "Medium",
    badgeClass:
      "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/50",
    indicatorClass: "bg-amber-500",
  },
  p3: {
    label: "Low",
    badgeClass:
      "bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:border-zinc-700",
    indicatorClass: "bg-zinc-400",
  },
};

export function TodoDashboard() {
  const [todos, setTodos] = useState<TodoItem[]>(INITIAL_TODOS);
  const [inputTitle, setInputTitle] = useState("");
  const [selectedPriority, setSelectedPriority] = useState<Priority>("p2");
  const [filter, setFilter] = useState<"all" | "active" | "completed">("all");
  const inputId = useId();

  const handleAddTodo = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = inputTitle.trim();
    if (!trimmed) return;

    const newTodo: TodoItem = {
      id: `task-${Date.now()}`,
      title: trimmed,
      completed: false,
      priority: selectedPriority,
      createdAt: "Just now",
    };

    setTodos((prev) => [newTodo, ...prev]);
    setInputTitle("");
  };

  const toggleTodo = (id: string) => {
    setTodos((prev) =>
      prev.map((todo) =>
        todo.id === id ? { ...todo, completed: !todo.completed } : todo
      )
    );
  };

  const deleteTodo = (id: string) => {
    setTodos((prev) => prev.filter((todo) => todo.id !== id));
  };

  const filteredTodos = todos.filter((todo) => {
    if (filter === "active") return !todo.completed;
    if (filter === "completed") return todo.completed;
    return true;
  });

  const activeCount = todos.filter((t) => !t.completed).length;
  const completedCount = todos.filter((t) => t.completed).length;

  return (
    <div className="w-full space-y-6">
      {/* Input Form UI */}
      <form
        onSubmit={handleAddTodo}
        className="group relative rounded-xl border border-zinc-200/80 bg-white p-3 shadow-xs transition-all focus-within:border-zinc-400 focus-within:shadow-md dark:border-zinc-800 dark:bg-zinc-900/80 dark:focus-within:border-zinc-600"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <label htmlFor={inputId} className="sr-only">
              Add new engineering task
            </label>
            <input
              id={inputId}
              type="text"
              value={inputTitle}
              onChange={(e) => setInputTitle(e.target.value)}
              placeholder="What needs to be engineered today?"
              className="w-full bg-transparent px-3 py-2 text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-hidden dark:text-zinc-100 dark:placeholder:text-zinc-500"
              autoComplete="off"
            />
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-zinc-100 pt-2 sm:border-t-0 sm:pt-0 dark:border-zinc-800">
            {/* Priority Selectors */}
            <div className="flex items-center gap-1">
              {(["p1", "p2", "p3"] as const).map((p) => {
                const config = PRIORITY_CONFIG[p];
                const isSelected = selectedPriority === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSelectedPriority(p)}
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all ${
                      isSelected
                        ? "bg-zinc-900 text-white shadow-xs dark:bg-zinc-100 dark:text-zinc-950"
                        : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        isSelected ? "bg-current" : config.indicatorClass
                      }`}
                    />
                    {config.label}
                  </button>
                );
              })}
            </div>

            {/* 3D-ish CTA Button */}
            <button
              type="submit"
              disabled={!inputTitle.trim()}
              className="btn-primary-3d inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white transition-all disabled:pointer-events-none disabled:opacity-40"
            >
              <PlusIcon className="h-3.5 w-3.5" />
              <span>Add Task</span>
            </button>
          </div>
        </div>
      </form>

      {/* Filter and Metrics Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 pb-3 dark:border-zinc-800">
        <div className="flex items-center gap-1 rounded-lg bg-zinc-100/80 p-1 dark:bg-zinc-900">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              filter === "all"
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            All ({todos.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("active")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              filter === "active"
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            Active ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setFilter("completed")}
            className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
              filter === "completed"
                ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-white"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
            }`}
          >
            Completed ({completedCount})
          </button>
        </div>

        <div className="text-xs text-zinc-500 dark:text-zinc-400">
          <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">
            {completedCount}
          </span>{" "}
          of{" "}
          <span className="font-mono font-medium text-zinc-700 dark:text-zinc-300">
            {todos.length}
          </span>{" "}
          completed
        </div>
      </div>

      {/* Todo Items List */}
      <div className="space-y-2">
        {filteredTodos.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 py-12 text-center dark:border-zinc-800">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
              <ListTodoIcon className="h-5 w-5" />
            </div>
            <p className="mt-3 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {filter === "completed"
                ? "No completed tasks yet"
                : filter === "active"
                  ? "All caught up! Zero active tasks"
                  : "No tasks created yet"}
            </p>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Add your next high-impact engineering milestone above.
            </p>
          </div>
        ) : (
          filteredTodos.map((todo) => {
            const priorityConfig = PRIORITY_CONFIG[todo.priority];
            return (
              <div
                key={todo.id}
                className="group flex items-center justify-between gap-3 rounded-lg border border-zinc-200/70 bg-white p-3.5 transition-all hover:border-zinc-300 hover:shadow-xs dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:hover:border-zinc-700"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Custom Checkbox */}
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={todo.completed}
                    onClick={() => toggleTodo(todo.id)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                      todo.completed
                        ? "border-emerald-600 bg-emerald-600 text-white dark:border-emerald-500 dark:bg-emerald-500"
                        : "border-zinc-300 bg-white hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600"
                    }`}
                  >
                    {todo.completed && <CheckIcon className="h-3.5 w-3.5" />}
                  </button>

                  <div className="min-w-0">
                    <p
                      className={`truncate text-sm font-medium transition-all ${
                        todo.completed
                          ? "text-zinc-400 line-through dark:text-zinc-500"
                          : "text-zinc-800 dark:text-zinc-200"
                      }`}
                    >
                      {todo.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${priorityConfig.badgeClass}`}
                  >
                    {priorityConfig.label}
                  </span>

                  <button
                    type="button"
                    onClick={() => deleteTodo(todo.id)}
                    className="opacity-0 transition-opacity group-hover:opacity-100 p-1 rounded-md text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                    title="Delete task"
                    aria-label={`Delete task ${todo.title}`}
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer System Status Banner */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50/50 px-4 py-2.5 text-xs text-zinc-500 dark:border-zinc-800/50 dark:bg-zinc-900/30 dark:text-zinc-400">
        <div className="flex items-center gap-2">
          <SparklesIcon className="h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
          <span>Local bun workspace architecture synced</span>
        </div>
        <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
          Next.js App Router • ElysiaJS
        </span>
      </div>
    </div>
  );
}
