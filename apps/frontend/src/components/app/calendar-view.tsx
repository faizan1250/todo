"use client";

import * as React from "react";
import { useState, useMemo, useCallback } from "react";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { BackendCalendarItem } from "@/lib/api";

export interface CalendarViewProps {
  items?: BackendCalendarItem[];
  isLoading?: boolean;
  month?: Date;
  onMonthChange?: (month: Date) => void;
  onSelectTask?: (taskId: string) => void;
  includeDone?: boolean;
  onToggleIncludeDone?: (value: boolean) => void;
  className?: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function toDayKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function CalendarView({
  items = [],
  isLoading = false,
  month,
  onMonthChange,
  onSelectTask,
  includeDone = false,
  onToggleIncludeDone,
  className,
}: CalendarViewProps) {
  const [internalMonth, setInternalMonth] = useState<Date>(() => startOfMonth(new Date()));

  const monthValue = month ?? internalMonth;

  const setMonth = useCallback(
    (next: Date) => {
      const normalized = startOfMonth(next);
      if (month === undefined) setInternalMonth(normalized);
      onMonthChange?.(normalized);
    },
    [month, onMonthChange]
  );

  const monthLabel = monthValue.toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  const cells = useMemo(() => {
    const year = monthValue.getFullYear();
    const monthIndex = monthValue.getMonth();
    const firstDay = new Date(year, monthIndex, 1);
    const lastDay = new Date(year, monthIndex + 1, 0);
    const leading = firstDay.getDay();
    const total = lastDay.getDate();

    const result: (Date | null)[] = [];
    // leading days from previous month
    const prevLast = new Date(year, monthIndex, 0).getDate();
    for (let i = leading - 1; i >= 0; i--) {
      result.push(new Date(year, monthIndex - 1, prevLast - i));
    }
    for (let d = 1; d <= total; d++) {
      result.push(new Date(year, monthIndex, d));
    }
    // trailing
    while (result.length % 7 !== 0) {
      const last = result[result.length - 1]!;
      result.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    }
    // ensure 6 rows (42 cells) for stable layout
    while (result.length < 42) {
      const last = result[result.length - 1]!;
      result.push(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1));
    }
    return result;
  }, [monthValue]);

  const itemsByDay = useMemo(() => {
    const map = new Map<string, BackendCalendarItem[]>();
    for (const item of items) {
      const key = toDayKey(item.start);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items]);

  const todayKey = toDayKey(new Date());

  const handlePrev = () => setMonth(new Date(monthValue.getFullYear(), monthValue.getMonth() - 1, 1));
  const handleNext = () => setMonth(new Date(monthValue.getFullYear(), monthValue.getMonth() + 1, 1));
  const handleToday = () => setMonth(new Date());

  return (
    <div className={cn("flex h-full flex-col bg-white dark:bg-[#051A4D]", className)}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-[#E4E8F2] px-4 py-3 dark:border-[#132E74]">
        <div className="flex items-center gap-2">
          <CalendarIcon className="h-5 w-5 text-[#09318D] dark:text-[#FD91CC]" />
          <h2 className="text-lg font-semibold text-[#051A4D] dark:text-white">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrev}
            aria-label="Previous month"
            className="rounded-md border border-[#E4E8F2] p-1.5 text-[#5B6478] hover:bg-[#F4F6FB] dark:border-[#132E74] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleToday}
            className="rounded-md border border-[#E4E8F2] px-2.5 py-1 text-sm text-[#5B6478] hover:bg-[#F4F6FB] dark:border-[#132E74] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={handleNext}
            aria-label="Next month"
            className="rounded-md border border-[#E4E8F2] p-1.5 text-[#5B6478] hover:bg-[#F4F6FB] dark:border-[#132E74] dark:text-[#9BB0D3] dark:hover:bg-[#0A2A6B]"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {onToggleIncludeDone && (
            <label className="ml-2 flex items-center gap-1.5 text-sm text-[#5B6478] dark:text-[#9BB0D3]">
              <input
                type="checkbox"
                checked={includeDone}
                onChange={(e) => onToggleIncludeDone(e.target.checked)}
                className="h-4 w-4 rounded border-[#E4E8F2]"
              />
              Include done
            </label>
          )}
        </div>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-[#E4E8F2] bg-[#F4F6FB] dark:border-[#132E74] dark:bg-[#082363]">
        {WEEKDAYS.map((w) => (
          <div
            key={w}
            className="px-2 py-1.5 text-center text-xs font-medium uppercase tracking-wide text-[#5B6478] dark:text-[#9BB0D3]"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid flex-1 grid-cols-7 grid-rows-6">
        {isLoading
          ? Array.from({ length: 42 }).map((_, i) => (
              <div
                key={`sk-${i}`}
                className="border-b border-r border-[#E4E8F2] p-1.5 dark:border-[#132E74]"
              >
                <Skeleton className="h-4 w-6 rounded" />
                <div className="mt-1 space-y-1">
                  <Skeleton className="h-3 w-full rounded" />
                  <Skeleton className="h-3 w-3/4 rounded" />
                </div>
              </div>
            ))
          : cells.map((date, i) => {
              if (!date) return <div key={`blank-${i}`} className="border-b border-r border-[#E4E8F2] dark:border-[#132E74]" />;
              const key = toDayKey(date);
              const dayItems = itemsByDay.get(key) ?? [];
              const isToday = key === todayKey;
              const isCurrentMonth = date.getMonth() === monthValue.getMonth();
              return (
                <div
                  key={key + i}
                  className={cn(
                    "flex min-h-0 flex-col border-b border-r border-[#E4E8F2] p-1.5 dark:border-[#132E74]",
                    !isCurrentMonth && "bg-[#F9FAFB] text-[#9CA3AF] dark:bg-[#031233] dark:text-[#6B7A99]"
                  )}
                >
                  <span
                    className={cn(
                      "mb-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium",
                      isToday && "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                    )}
                  >
                    {date.getDate()}
                  </span>
                  <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
                    {dayItems.map((item) => {
                      const color = item.color || "#09318D";
                      const taskId = item.taskId ?? (item.type === "task" ? item.id : null);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            if (taskId && onSelectTask) onSelectTask(taskId);
                          }}
                          className={cn(
                            "truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-white",
                            item.allDay ? "opacity-100" : "opacity-90"
                          )}
                          style={{ backgroundColor: color }}
                          title={item.title}
                        >
                          {!item.allDay && (
                            <span className="mr-1 opacity-80">
                              {new Date(item.start).toLocaleTimeString(undefined, {
                                hour: "numeric",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                          {item.title}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
      </div>
    </div>
  );
}

export default CalendarView;
