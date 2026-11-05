"use client";

import * as React from "react";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { formatWhen } from "@/lib/dates/formatWhen";
import { TimeField } from "./TimeField";

// Calendar styles load with the component module; the calendar logic itself
// is code-split below so the picker bundle stays out of the initial load.
import "react-day-picker/style.css";

const DayPickerLazy = React.lazy(() =>
  import("react-day-picker").then((m) => ({ default: m.DayPicker }))
);

export interface DateSelection {
  dueAt: string | null;
  allDay: boolean;
  startAt?: string | null;
  deadlineAt?: string | null;
}

export interface DatePopoverProps {
  initial: DateSelection;
  /** IANA zone for labels. Defaults to the device zone. */
  timezone?: string;
  /** 0 = Sunday … 6 = Saturday. Defaults to Monday. */
  weekStart?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  onApply: (dates: DateSelection) => void;
  onClose: () => void;
}

// --- Pure date helpers (local wall-clock; ISO emitted at apply time) --------

function startOfDayLocal(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function addDays(d: Date, n: number): Date {
  const c = new Date(d);
  c.setDate(c.getDate() + n);
  return c;
}

function toDateInputValue(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fromDateInputValue(s: string): Date | null {
  if (!s) return null;
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toHHmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fromHHmm(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** Next whole hour strictly after now (2:37 PM -> 3:00 PM). */
export function nextRoundHour(now: Date): Date {
  const c = new Date(now);
  c.setMinutes(0, 0, 0);
  c.setHours(c.getHours() + 1);
  return c;
}

/** True when the day is before today's calendar day. */
export function isPastDay(day: Date, now: Date): boolean {
  return startOfDayLocal(day).getTime() < startOfDayLocal(now).getTime();
}

/** Saturday of this week when still ahead, else next Saturday. */
export function thisWeekend(now: Date): Date {
  const dow = startOfDayLocal(now).getDay();
  const delta = (6 - dow + 7) % 7;
  return addDays(startOfDayLocal(now), delta);
}

/** Next Monday (strictly future when today is Monday). */
export function nextWeekMonday(now: Date): Date {
  const dow = startOfDayLocal(now).getDay();
  const delta = ((8 - dow) % 7) || 7;
  return addDays(startOfDayLocal(now), delta);
}

// ---------------------------------------------------------------------------

type ChronoModule = typeof import("chrono-node");

export function DatePopover({
  initial,
  timezone,
  weekStart = 1,
  onApply,
  onClose,
}: DatePopoverProps) {
  const [now] = useState(() => new Date());
  const todayStart = useMemo(() => startOfDayLocal(now), [now]);

  const initialDay = useMemo(() => {
    if (!initial.dueAt) return null;
    const d = new Date(initial.dueAt);
    return Number.isNaN(d.getTime()) ? null : startOfDayLocal(d);
  }, [initial.dueAt]);

  const [selectedDay, setSelectedDay] = useState<Date | null>(initialDay);
  const [hasTime, setHasTime] = useState<boolean>(() => {
    if (!initial.dueAt || initial.allDay) return false;
    const d = new Date(initial.dueAt);
    if (Number.isNaN(d.getTime())) return false;
    return d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0;
  });
  const [timeStr, setTimeStr] = useState<string>(() => {
    if (initial.dueAt && !initial.allDay) {
      const d = new Date(initial.dueAt);
      if (!Number.isNaN(d.getTime())) return toHHmm(d);
    }
    return toHHmm(nextRoundHour(new Date()));
  });
  const [startStr, setStartStr] = useState<string>(() =>
    initial.startAt ? toDateInputValue(new Date(initial.startAt)) : ""
  );
  const [deadlineStr, setDeadlineStr] = useState<string>(() =>
    initial.deadlineAt ? toDateInputValue(new Date(initial.deadlineAt)) : ""
  );
  const [showMore, setShowMore] = useState<boolean>(() =>
    Boolean(initial.startAt || initial.deadlineAt)
  );

  // Typed-date shortcut: chrono loads on first focus, parses as you type.
  const [typed, setTyped] = useState("");
  const [chronoMod, setChronoMod] = useState<ChronoModule | null>(null);
  const [chronoFailed, setChronoFailed] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the typing field on open; return focus to the trigger on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => {
      previous?.focus?.();
    };
  }, []);

  const parsedTyped = useMemo(() => {
    if (!chronoMod || typed.trim() === "") return null;
    try {
      const results = chronoMod.en.casual.parse(typed, { instant: now }, { forwardDate: true });
      const first = results[0];
      if (!first) return null;
      const date = first.date();
      return { date, timed: first.start.isCertain("hour") };
    } catch {
      return null;
    }
  }, [chronoMod, typed, now]);

  const typedPreview =
    parsedTyped !== null
      ? formatWhen(parsedTyped.date, {
          now,
          allDay: !parsedTyped.timed,
          timeZone: timezone,
        })
      : null;

  const loadChrono = () => {
    if (chronoMod || chronoFailed) return;
    import("chrono-node")
      .then((m) => setChronoMod(m))
      .catch(() => setChronoFailed(true));
  };

  const applyTyped = () => {
    if (!parsedTyped) return;
    setSelectedDay(startOfDayLocal(parsedTyped.date));
    setHasTime(parsedTyped.timed);
    if (parsedTyped.timed) setTimeStr(toHHmm(parsedTyped.date));
    setTyped("");
  };

  // Quick picks -------------------------------------------------------------

  const laterTodayDate = useMemo(() => {
    const c = addDays(new Date(now), 0);
    c.setHours(c.getHours() + 3, 0, 0, 0);
    return startOfDayLocal(c).getTime() === todayStart.getTime() &&
      c.getTime() > now.getTime()
      ? c
      : null;
  }, [now, todayStart]);

  const thisEveningDate = useMemo(() => {
    const c = startOfDayLocal(now);
    c.setHours(19, 0, 0, 0);
    return c.getTime() > now.getTime() ? c : null;
  }, [now]);

  const pickDay = (day: Date | null, timed: boolean, at?: Date) => {
    setSelectedDay(day ? startOfDayLocal(day) : null);
    setTyped("");
    if (!day) {
      setHasTime(false);
      return;
    }
    if (timed) {
      setHasTime(true);
      setTimeStr(toHHmm(at ?? nextRoundHour(now)));
    } else {
      setHasTime(false);
    }
  };

  const quickPicks: Array<{ label: string; run: () => void; active: boolean }> = [
    {
      label: "Today",
      run: () => pickDay(now, false),
      active: selectedDay?.getTime() === todayStart.getTime() && !hasTime,
    },
    {
      label: "Tomorrow",
      run: () => pickDay(addDays(now, 1), false),
      active: selectedDay?.getTime() === addDays(todayStart, 1).getTime() && !hasTime,
    },
    {
      label: "This weekend",
      run: () => pickDay(thisWeekend(now), false),
      active: selectedDay?.getTime() === thisWeekend(now).getTime() && !hasTime,
    },
    {
      label: "Next week",
      run: () => pickDay(nextWeekMonday(now), false),
      active: selectedDay?.getTime() === nextWeekMonday(now).getTime() && !hasTime,
    },
    ...(laterTodayDate
      ? [
          {
            label: "Later today",
            run: () => pickDay(now, true, laterTodayDate),
            active: false as boolean,
          },
        ]
      : []),
    ...(thisEveningDate
      ? [
          {
            label: "This evening",
            run: () => pickDay(now, true, thisEveningDate),
            active: false as boolean,
          },
        ]
      : []),
    {
      label: "No date",
      run: () => pickDay(null, false),
      active: selectedDay === null,
    },
  ];

  // Apply -------------------------------------------------------------------

  const showPastNote = selectedDay !== null && isPastDay(selectedDay, now);

  const handleApply = () => {
    if (!selectedDay) {
      onApply({
        dueAt: null,
        allDay: true,
        startAt: fromDateInputValue(startStr)?.toISOString() ?? null,
        deadlineAt: fromDateInputValue(deadlineStr)?.toISOString() ?? null,
      });
      return;
    }
    const due = new Date(selectedDay);
    let allDay = true;
    if (hasTime) {
      const t = fromHHmm(timeStr) ?? { h: 9, m: 0 };
      due.setHours(t.h, t.m, 0, 0);
      allDay = false;
    }
    onApply({
      dueAt: due.toISOString(),
      allDay,
      startAt: fromDateInputValue(startStr)?.toISOString() ?? null,
      deadlineAt: fromDateInputValue(deadlineStr)?.toISOString() ?? null,
    });
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Schedule date"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute left-0 top-full z-30 mt-1.5 w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-[#E4E8F2] bg-white shadow-xl dark:border-[#132E74] dark:bg-[#051A4D] max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:top-auto max-sm:mt-0 max-sm:w-auto"
    >
      <div className="max-h-[min(70vh,560px)] overflow-y-auto p-3">
        {/* Typed date shortcut */}
        <div>
          <label
            htmlFor="date-popover-type"
            className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]"
          >
            Type a date
          </label>
          <input
            ref={inputRef}
            id="date-popover-type"
            type="text"
            value={typed}
            autoComplete="off"
            placeholder="Tomorrow at 5pm"
            onFocus={loadChrono}
            onChange={(e) => {
              loadChrono();
              setTyped(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && parsedTyped) {
                e.preventDefault();
                applyTyped();
              }
            }}
            className="mt-1 min-h-12 w-full rounded-lg border border-[#E4E8F2] bg-white px-3 text-sm text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
          />
          <p aria-live="polite" className="mt-1 min-h-4 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
            {typed.trim() !== "" &&
              (typedPreview
                ? `Looks like ${typedPreview}. Press Enter to use it.`
                : chronoFailed
                  ? "Date typing is unavailable right now — pick below instead."
                  : "Keep typing — e.g. Friday, next week, Dec 25.")}
          </p>
        </div>

        {/* Quick picks */}
        <div className="mt-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
            Quick picks
          </p>
          <div className="mt-1.5 grid grid-cols-2 gap-1.5">
            {quickPicks.map((pick) => (
              <button
                key={pick.label}
                type="button"
                onClick={pick.run}
                aria-pressed={pick.active}
                className={cn(
                  "min-h-12 rounded-lg px-2 text-xs transition-colors duration-150 cursor-pointer focus-ring-pink motion-reduce:transition-none",
                  pick.active
                    ? "bg-[#09318D] font-bold text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                    : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                )}
              >
                {pick.label}
              </button>
            ))}
          </div>
        </div>

        {/* Calendar */}
        <div className="mt-3">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
            Calendar
          </p>
          <div className="mt-1.5 flex justify-center">
            <Suspense
              fallback={
                <div
                  role="status"
                  className="flex h-64 w-full items-center justify-center rounded-lg bg-[#F2F5FC] text-xs text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]"
                >
                  Loading calendar…
                </div>
              }
            >
              <DayPickerLazy
                mode="single"
                selected={selectedDay ?? undefined}
                onSelect={(d: Date | undefined) => {
                  setSelectedDay(d ? startOfDayLocal(d) : null);
                  setTyped("");
                }}
                weekStartsOn={weekStart}
                classNames={{
                  selected: "bg-[#09318D] text-white",
                  today: "font-bold underline underline-offset-2",
                  day_button: "min-h-12 min-w-12",
                }}
              />
            </Suspense>
          </div>
          {showPastNote && (
            <p role="note" className="mt-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
              That day has passed — saving it will mark the task overdue.
            </p>
          )}
        </div>

        {/* Time toggle */}
        <div className="mt-3 border-t border-[#E4E8F2] pt-2.5 dark:border-[#132E74]">
          <button
            type="button"
            role="switch"
            aria-checked={hasTime}
            onClick={() => {
              if (!hasTime) setTimeStr(toHHmm(nextRoundHour(new Date())));
              setHasTime((v) => !v);
            }}
            className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-1 text-left cursor-pointer focus-ring-pink"
          >
            <span>
              <span className="block text-xs font-medium text-[#0B1220] dark:text-white">
                {hasTime ? "Specific time" : copy.scheduling.noSpecificTime}
              </span>
              <span className="block text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                {hasTime
                  ? "The task keeps its clock time."
                  : "Turn on to pick a clock time."}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "relative h-6 w-11 shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none",
                hasTime ? "bg-[#09318D] dark:bg-[#FD91CC]" : "bg-[#E4E8F2] dark:bg-[#132E74]"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-150 motion-reduce:transition-none",
                  hasTime ? "translate-x-[22px]" : "translate-x-0.5"
                )}
              />
            </span>
          </button>
          {hasTime && (
            <div className="mt-1">
              <TimeField
                id="date-popover-time"
                label="Time"
                value={timeStr}
                onChange={setTimeStr}
              />
            </div>
          )}
        </div>

        {/* More dates (collapsed) */}
        <div className="mt-2 border-t border-[#E4E8F2] pt-2 dark:border-[#132E74]">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            aria-expanded={showMore}
            className="flex min-h-12 w-full items-center justify-between rounded-lg px-1 text-xs font-semibold text-[#5B6478] hover:text-[#0B1220] cursor-pointer focus-ring-pink dark:text-[#9BB0D3] dark:hover:text-white"
          >
            More dates
            <ChevronDown
              className={cn("h-4 w-4 transition-transform duration-150 motion-reduce:transition-none", showMore && "rotate-180")}
              aria-hidden="true"
            />
          </button>
          {showMore && (
            <div className="space-y-2.5 px-1 pb-1 pt-1">
              <div>
                <label
                  htmlFor="date-popover-start"
                  className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]"
                >
                  Start date
                </label>
                <input
                  id="date-popover-start"
                  type="date"
                  value={startStr}
                  onChange={(e) => setStartStr(e.target.value)}
                  className="mt-0.5 min-h-12 w-full rounded-lg border border-[#E4E8F2] bg-white px-3 text-xs text-[#0B1220] focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                />
                <p className="mt-0.5 text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                  The day work may begin; shown in Today once reached.
                </p>
              </div>
              <div>
                <label
                  htmlFor="date-popover-deadline"
                  className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]"
                >
                  Deadline date
                </label>
                <input
                  id="date-popover-deadline"
                  type="date"
                  value={deadlineStr}
                  onChange={(e) => setDeadlineStr(e.target.value)}
                  className="mt-0.5 min-h-12 w-full rounded-lg border border-[#E4E8F2] bg-white px-3 text-xs text-[#0B1220] focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                />
                <p className="mt-0.5 text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                  The last acceptable day; the task reads overdue after it.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Done */}
        <div className="sticky bottom-0 -mx-3 mt-3 border-t border-[#E4E8F2] bg-white/95 px-3 pb-1 pt-2.5 backdrop-blur dark:border-[#132E74] dark:bg-[#051A4D]/95">
          <button
            type="button"
            onClick={handleApply}
            className="min-h-12 w-full rounded-xl bg-[#09318D] text-sm font-semibold text-white transition-colors duration-150 hover:bg-[#0B3EA8] focus-ring-pink motion-reduce:transition-none dark:bg-[#FD91CC] dark:text-[#051A4D]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
