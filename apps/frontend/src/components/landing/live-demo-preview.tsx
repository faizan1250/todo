"use client";

import * as React from "react";
import { useState } from "react";
import { Check, Sparkles, Flame, ArrowRight, ShieldCheck, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DemoTask {
  id: string;
  title: string;
  tag: string;
  priority: "high" | "med" | "low";
  completed: boolean;
}

const INITIAL_DEMO_TASKS: DemoTask[] = [
  {
    id: "demo-1",
    title: "Verify ElysiaJS sub-millisecond route benchmarks",
    tag: "Core Backend",
    priority: "high",
    completed: true,
  },
  {
    id: "demo-2",
    title: "Review cryptographic invite token validation logic",
    tag: "Security",
    priority: "high",
    completed: false,
  },
  {
    id: "demo-3",
    title: "Configure Cmd+K command palette keyboard triggers",
    tag: "Frontend",
    priority: "med",
    completed: false,
  },
  {
    id: "demo-4",
    title: "Run automated E2E auth flow with session cookies",
    tag: "DevOps",
    priority: "low",
    completed: false,
  },
];

interface LiveDemoPreviewProps {
  onOpenAuth?: () => void;
  onExploreApp?: () => void;
}

export function LiveDemoPreview({ onOpenAuth, onExploreApp }: LiveDemoPreviewProps) {
  const [tasks, setTasks] = useState<DemoTask[]>(INITIAL_DEMO_TASKS);
  const [streak, setStreak] = useState(4);
  const [celebrating, setCelebrating] = useState(false);
  const [lastCompletedId, setLastCompletedId] = useState<string | null>(null);

  const toggleTask = (id: string) => {
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === id) {
          const nextCompleted = !t.completed;
          if (nextCompleted) {
            setStreak((s) => s + 1);
            setCelebrating(true);
            setLastCompletedId(id);
            setTimeout(() => setCelebrating(false), 2000);
          } else {
            setStreak((s) => Math.max(1, s - 1));
          }
          return { ...t, completed: nextCompleted };
        }
        return t;
      })
    );
  };

  const completedCount = tasks.filter((t) => t.completed).length;
  const progressPercent = Math.round((completedCount / tasks.length) * 100);

  return (
    <div className="relative mx-auto w-full max-w-4xl select-none">
      {/* Restrained Bubblegum Pink Glow Behind Mockup (5-10% accent presence, soft blur) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -inset-2 rounded-3xl bg-[#FD91CC]/15 blur-2xl transition-opacity duration-500"
      />

      {/* Main Mockup Surface */}
      <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-[#051A4D]/90 p-1 shadow-2xl backdrop-blur-xl ring-1 ring-white/10 sm:p-2">
        {/* Mock Window Title Bar */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-xs text-white/70">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-rose-500/80" />
            <span className="h-3 w-3 rounded-full bg-amber-500/80" />
            <span className="h-3 w-3 rounded-full bg-emerald-500/80" />
            <span className="ml-2 font-mono text-[11px] font-medium tracking-tight text-white/50">
              todo-studio-app.internal
            </span>
          </div>

          <div className="flex items-center gap-3">
            {/* Interactive Streak Counter */}
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-medium transition-all duration-300",
                celebrating
                  ? "scale-105 bg-[#FFE8F5] text-[#051A4D] shadow-[0_0_12px_rgba(253,145,204,0.4)]"
                  : "bg-white/10 text-white/90"
              )}
            >
              <Flame
                className={cn(
                  "h-3.5 w-3.5 transition-colors",
                  celebrating ? "text-[#051A4D] fill-[#FD91CC]" : "text-[#FD91CC]"
                )}
              />
              <span className="text-[11px] font-semibold">{streak} Day Streak</span>
            </div>

            <div className="hidden sm:flex items-center gap-1 text-[11px] text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>ElysiaJS :3001 Active</span>
            </div>
          </div>
        </div>

        {/* Mockup Workspace Area */}
        <div className="bg-[#07256C]/60 p-4 sm:p-6 rounded-b-xl space-y-4">
          {/* Header Row */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white sm:text-lg">
                  Sprint Milestone #4: Production Cut
                </h3>
                <Badge variant="accent" className="text-[10px] py-0 px-2">
                  Interactive Demo
                </Badge>
              </div>
              <p className="text-xs text-white/60">
                Click any task checkbox to feel instant optimistic updates & celebration.
              </p>
            </div>

            {/* Micro Progress Bar */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <div className="h-2 w-28 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-[#0D41B4] to-[#FD91CC] transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="font-mono text-xs font-semibold text-white/80">
                {progressPercent}%
              </span>
            </div>
          </div>

          {/* Task Rows */}
          <div className="space-y-2">
            {tasks.map((task) => {
              const isJustFinished = lastCompletedId === task.id && celebrating;
              return (
                <div
                  key={task.id}
                  onClick={() => toggleTask(task.id)}
                  className={cn(
                    "group flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition-all duration-150",
                    task.completed
                      ? "border-white/5 bg-white/[0.03] text-white/40"
                      : "border-white/10 bg-white/[0.07] hover:border-white/20 hover:bg-white/[0.1] text-white",
                    isJustFinished && "ring-1 ring-[#FD91CC]/80 bg-[#FD91CC]/10"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Custom Animated Checkbox with Bubblegum Accent */}
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={task.completed}
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[#FD91CC]",
                        task.completed
                          ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D]"
                          : "border-white/30 bg-white/5 group-hover:border-white/50"
                      )}
                    >
                      {task.completed && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                    </button>

                    <span
                      className={cn(
                        "truncate text-sm transition-all duration-150",
                        task.completed && "line-through text-white/40"
                      )}
                    >
                      {task.title}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {/* Priority Dot */}
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        task.priority === "high" && "bg-rose-400",
                        task.priority === "med" && "bg-amber-400",
                        task.priority === "low" && "bg-sky-400"
                      )}
                      title={`Priority: ${task.priority}`}
                    />

                    {/* Tag Chip */}
                    <span className="hidden sm:inline-block rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/70">
                      {task.tag}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Interactive celebration toast moment */}
          {celebrating && (
            <div className="animate-in fade-in slide-in-from-bottom-2 flex items-center justify-between rounded-lg border border-[#FD91CC]/40 bg-[#051A4D] px-3.5 py-2 text-xs text-white shadow-lg">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#FD91CC]" />
                <span className="font-medium text-white">
                  Milestone task completed! Streak increased to {streak} days.
                </span>
              </div>
              <span className="font-mono text-[10px] text-[#FD91CC] font-bold">
                +25 XP
              </span>
            </div>
          )}

          {/* Quick Mockup Footer Callout */}
          <div className="flex flex-col sm:flex-row items-center justify-between pt-2 border-t border-white/10 gap-3 text-xs text-white/60">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5 text-amber-400" />
                <span>Sub-millisecond state updates</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
                <span>Invite cryptographic guard</span>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              {onExploreApp && (
                <button
                  type="button"
                  onClick={onExploreApp}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 transition-all cursor-pointer focus-ring-pink"
                >
                  <span>Open Full Workspace</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
              {onOpenAuth && (
                <button
                  type="button"
                  onClick={onOpenAuth}
                  className="btn-accent-pink inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold cursor-pointer focus-ring-pink"
                >
                  <span>Claim Your Invite</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
