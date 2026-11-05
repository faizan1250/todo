"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Plus, Trash2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getPlanner,
  createTimeBlock,
  updateTimeBlock,
  deleteTimeBlock,
  type BackendPlannerResponse,
  type BackendTimeBlock,
  type BackendPlannerUnscheduledTask,
} from "@/lib/api";

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(value: string | number): string {
  const d = new Date(value);
  if (isNaN(d.getTime())) return String(value);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export interface PlannerViewProps {
  className?: string;
}

export function PlannerView({ className }: PlannerViewProps) {
  const [date, setDate] = useState<string>(() => toDateKey(new Date()));
  const [data, setData] = useState<BackendPlannerResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // create form
  const [formTaskId, setFormTaskId] = useState<string>("");
  const [formTitle, setFormTitle] = useState<string>("");
  const [formStart, setFormStart] = useState<string>("");
  const [formEnd, setFormEnd] = useState<string>("");
  const [formColor, setFormColor] = useState<string>("");

  const load = useCallback(async (d: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await getPlanner({ date: d });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load planner");
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const shiftDate = (days: number) => {
    const d = new Date(date + "T00:00:00");
    d.setDate(d.getDate() + days);
    setDate(toDateKey(d));
  };

  const validateRange = (start: string, end: string): string | null => {
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return "Invalid date/time";
    if (e <= s) return "End must be after start";
    if (s.toDateString() !== e.toDateString()) return "Block cannot cross midnight";
    return null;
  };

  const resetForm = () => {
    setFormTaskId("");
    setFormTitle("");
    setFormStart("");
    setFormEnd("");
    setFormColor("");
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateRange(formStart, formEnd);
    if (err) {
      setError(err);
      return;
    }
    try {
      await createTimeBlock({
        taskId: formTaskId || undefined,
        title: formTitle || undefined,
        startAt: new Date(formStart).toISOString(),
        endAt: new Date(formEnd).toISOString(),
        color: formColor || undefined,
      });
      setIsCreating(false);
      resetForm();
      await load(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create block");
    }
  };

  const handleUpdate = async (block: BackendTimeBlock, patch: { title?: string; startAt?: string; endAt?: string; color?: string | null }) => {
    if (patch.startAt && patch.endAt) {
      const err = validateRange(patch.startAt, patch.endAt);
      if (err) {
        setError(err);
        return;
      }
      patch = {
        ...patch,
        startAt: new Date(patch.startAt).toISOString(),
        endAt: new Date(patch.endAt).toISOString(),
      };
    }
    try {
      await updateTimeBlock(block.id, {
        title: patch.title,
        startAt: patch.startAt,
        endAt: patch.endAt,
        color: patch.color,
      });
      setEditingId(null);
      await load(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update block");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteTimeBlock(id);
      await load(date);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete block");
    }
  };

  const blocks = data?.blocks ?? [];
  const unscheduled = data?.unscheduled ?? [];
  const capacity = data?.capacity;
  const conflicts = data?.conflicts ?? [];

  return (
    <div className={cn("flex h-full flex-col bg-white dark:bg-[#051A4D]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#E4E8F2] px-4 py-3 dark:border-[#132E74]">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-[#09318D] dark:text-[#FD91CC]" />
          <h2 className="text-lg font-semibold text-[#051A4D] dark:text-white">Planner</h2>
          <span className="text-sm text-[#5B6478] dark:text-[#9BB0D3]">{data?.workHours ? `Work hours: ${data.workHours}` : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => shiftDate(-1)} className="rounded-md px-2 py-1 text-sm text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium text-[#051A4D] dark:text-white">{date}</span>
          <button type="button" onClick={() => shiftDate(1)} className="rounded-md px-2 py-1 text-sm text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]">
            <ChevronRight className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setDate(toDateKey(new Date()))} className="rounded-md px-3 py-1 text-sm text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]">
            Today
          </button>
          <button type="button" onClick={() => { setIsCreating(true); setError(null); }} className="flex items-center gap-1 rounded-md bg-[#09318D] px-3 py-1 text-sm text-white dark:bg-[#FD91CC] dark:text-[#051A4D]">
            <Plus className="h-4 w-4" /> Block
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex-1 space-y-3 p-4">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-6">
          {/* Capacity */}
          {capacity && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-[#051A4D] dark:text-white">Capacity</h3>
              <div className="flex gap-4 text-sm text-[#5B6478] dark:text-[#9BB0D3]">
                <span>Work: {capacity.workMin}m</span>
                <span>Scheduled: {capacity.scheduledMin}m</span>
                <span>Estimated: {capacity.estimatedMin}m</span>
              </div>
            </section>
          )}

          {/* Create form */}
          {isCreating && (
            <form onSubmit={handleCreate} className="space-y-2 rounded-lg border border-[#E4E8F2] p-3 dark:border-[#132E74]">
              <div className="flex flex-wrap gap-2">
                <select value={formTaskId} onChange={(e) => setFormTaskId(e.target.value)} className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white">
                  <option value="">No task</option>
                  {unscheduled.map((t: BackendPlannerUnscheduledTask) => (
                    <option key={t.id} value={t.id}>{t.title}</option>
                  ))}
                </select>
                <input value={formTitle} onChange={(e) => setFormTitle(e.target.value)} placeholder="Title (optional)" className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" />
                <input type="datetime-local" value={formStart} onChange={(e) => setFormStart(e.target.value)} className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" required />
                <input type="datetime-local" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" required />
                <input value={formColor} onChange={(e) => setFormColor(e.target.value)} placeholder="Color" className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="rounded-md bg-[#09318D] px-3 py-1 text-sm text-white dark:bg-[#FD91CC] dark:text-[#051A4D]">Save</button>
                <button type="button" onClick={() => { setIsCreating(false); resetForm(); }} className="rounded-md px-3 py-1 text-sm text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]">Cancel</button>
              </div>
            </form>
          )}

          {/* Blocks */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#051A4D] dark:text-white">Time Blocks</h3>
            {blocks.length === 0 ? (
              <p className="text-sm text-[#5B6478] dark:text-[#9BB0D3]">No blocks scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {blocks.map((b: BackendTimeBlock) => (
                  <li key={b.id} className="flex items-center justify-between rounded-lg border border-[#E4E8F2] p-3 dark:border-[#132E74]">
                    <div className="flex items-center gap-3">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: b.color || "#09318D" }} />
                      <div>
                        <div className="text-sm font-medium text-[#051A4D] dark:text-white">{b.task?.title || b.title || "Untitled block"}</div>
                        <div className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">{formatTime(b.startAt)} - {formatTime(b.endAt)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={() => setEditingId(b.id)} className="rounded-md p-1 text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button type="button" onClick={() => handleDelete(b.id)} className="rounded-md p-1 text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    {editingId === b.id && (
                      <EditBlockForm block={b} onSave={handleUpdate} onCancel={() => setEditingId(null)} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Unscheduled */}
          <section>
            <h3 className="mb-2 text-sm font-semibold text-[#051A4D] dark:text-white">Unscheduled Tasks</h3>
            {unscheduled.length === 0 ? (
              <p className="text-sm text-[#5B6478] dark:text-[#9BB0D3]">All tasks scheduled.</p>
            ) : (
              <ul className="space-y-1">
                {unscheduled.map((t: BackendPlannerUnscheduledTask) => (
                  <li key={t.id} className="text-sm text-[#051A4D] dark:text-white">{t.title}</li>
                ))}
              </ul>
            )}
          </section>

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-red-600 dark:text-red-400">Conflicts</h3>
              <ul className="space-y-1">
                {conflicts.map((c, idx) => (
                  <li key={idx} className="text-sm text-red-600 dark:text-red-400">{Array.isArray(c) ? c.join(" vs ") : String(c)}</li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function EditBlockForm({ block, onSave, onCancel }: { block: BackendTimeBlock; onSave: (block: BackendTimeBlock, patch: { title?: string; startAt?: string; endAt?: string; color?: string | null }) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(block.title || block.task?.title || "");
  const [start, setStart] = useState(() => new Date(block.startAt).toISOString().slice(0, 16));
  const [end, setEnd] = useState(() => new Date(block.endAt).toISOString().slice(0, 16));
  const [color, setColor] = useState(block.color || "");
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input value={title} onChange={(e) => setTitle(e.target.value)} className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" />
      <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" />
      <input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" />
      <input value={color} onChange={(e) => setColor(e.target.value)} className="rounded-md border border-[#E4E8F2] bg-white px-2 py-1 text-sm dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white" />
      <button type="button" onClick={() => onSave(block, { title, startAt: start, endAt: end, color })} className="rounded-md bg-[#09318D] px-3 py-1 text-sm text-white dark:bg-[#FD91CC] dark:text-[#051A4D]">Save</button>
      <button type="button" onClick={onCancel} className="rounded-md px-3 py-1 text-sm text-[#5B6478] hover:bg-[#F4F6FB] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]">Cancel</button>
    </div>
  );
}