"use client";

import * as React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface SnoozeSheetProps {
  open: boolean;
  onClose: () => void;
  /** Snooze relative to now (10m / 1h / 3h presets). */
  onPick: (minutes: number) => void;
  /** Snooze to an exact clock time (tomorrow 9 AM, custom pick). */
  onPickTime: (time: Date) => void;
}

const PRESETS: Array<{ label: string; minutes: number }> = [
  { label: "10m", minutes: 10 },
  { label: "1h", minutes: 60 },
  { label: "3h", minutes: 180 },
];

function tomorrowAtNine(now: Date): Date {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d;
}

/**
 * "Remind me later" sheet: 10m / 1h / 3h / tomorrow 9 AM / pick a time.
 * Fires through the same snooze path as the old +15m shortcut.
 */
export function SnoozeSheet({ open, onClose, onPick, onPickTime }: SnoozeSheetProps) {
  const [customTime, setCustomTime] = useState("");

  if (!open) return null;

  const tomorrow = tomorrowAtNine(new Date());
  const tomorrowLabel = `Tomorrow 9 AM (${tomorrow.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  })})`;

  const btn =
    "rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1.5 text-xs font-medium text-[#5B6478] hover:border-[#09318D] hover:text-[#09318D] transition-colors cursor-pointer dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3] dark:hover:border-[#FD91CC] dark:hover:text-[#FD91CC]";

  return (
    <div
      role="dialog"
      aria-label="Remind me later"
      className="rounded-xl border border-[#E4E8F2] bg-[#F2F5FC]/60 p-2.5 space-y-2 dark:border-[#132E74] dark:bg-[#082363]/50"
    >
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          Remind me later
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close snooze options"
          className="text-xs text-[#5B6478] hover:underline dark:text-[#9BB0D3] cursor-pointer"
        >
          Close
        </button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(p.minutes)}
            className={cn(btn, "text-center")}
          >
            {p.label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onPickTime(tomorrow)}
        className={cn(btn, "w-full text-center")}
      >
        {tomorrowLabel}
      </button>
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={customTime}
          onChange={(e) => setCustomTime(e.target.value)}
          aria-label="Pick a snooze time"
          className="flex-1 rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white"
        />
        <button
          type="button"
          onClick={() => {
            if (customTime) {
              onPickTime(new Date(customTime));
              setCustomTime("");
            }
          }}
          className="rounded bg-[#09318D] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0B3EA8] dark:bg-[#FD91CC] dark:text-[#051A4D] cursor-pointer"
        >
          Set
        </button>
      </div>
    </div>
  );
}
