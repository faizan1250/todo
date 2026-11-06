"use client";

import * as React from "react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ReminderPickerInput {
  kind: "absolute" | "relative";
  relativeTo?: "due" | "start" | "deadline" | null;
  offsetMin?: number | null;
  remindAt?: string | null;
}

export interface ReminderPickerProps {
  /** False when the task has no due date — relative options need one. */
  hasDueDate: boolean;
  /** True at the 10-reminder cap — the whole menu stays shut. */
  atCap?: boolean;
  onAdd: (input: ReminderPickerInput) => void;
}

const RELATIVE_PRESETS: Array<{ label: string; offset: number }> = [
  { label: "At due time", offset: 0 },
  { label: "10m before", offset: -10 },
  { label: "1h before", offset: -60 },
  { label: "1d before", offset: -1440 },
];

/**
 * Reminder menu: relative presets, a custom offset ("Custom"), and an exact
 * clock time ("At specific time"). Relative choices need a due date; the
 * exact-time choice always works.
 */
export function ReminderPicker({ hasDueDate, atCap = false, onAdd }: ReminderPickerProps) {
  const [mode, setMode] = useState<"menu" | "custom" | "specific">("menu");
  const [customMinutes, setCustomMinutes] = useState("30");
  const [specificTime, setSpecificTime] = useState("");

  if (atCap) return null;

  const presetClass = (disabled: boolean) =>
    cn(
      "rounded bg-white border border-[#E4E8F2] px-2 py-1 text-xs text-center transition-colors dark:bg-[#051A4D] dark:border-[#132E74]",
      disabled
        ? "text-[#5B6478]/40 dark:text-[#9BB0D3]/40 cursor-not-allowed"
        : "text-[#5B6478] hover:border-[#09318D] hover:text-[#09318D] cursor-pointer dark:text-[#9BB0D3] dark:hover:border-[#FD91CC]"
    );

  return (
    <div className="rounded-xl border border-[#E4E8F2] bg-[#F2F5FC]/60 p-2.5 space-y-2 dark:border-[#132E74] dark:bg-[#082363]/50">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
        Preset Reminder
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {RELATIVE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={!hasDueDate}
            title={hasDueDate ? preset.label : "Set a due date first"}
            onClick={() =>
              onAdd({ kind: "relative", relativeTo: "due", offsetMin: preset.offset })
            }
            className={presetClass(!hasDueDate)}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          disabled={!hasDueDate}
          title={hasDueDate ? "Custom offset before due" : "Set a due date first"}
          onClick={() => setMode((m) => (m === "custom" ? "menu" : "custom"))}
          className={cn(presetClass(!hasDueDate), mode === "custom" && hasDueDate && "border-[#09318D] text-[#09318D] dark:border-[#FD91CC] dark:text-[#FD91CC]")}
        >
          Custom
        </button>
        <button
          type="button"
          onClick={() => setMode((m) => (m === "specific" ? "menu" : "specific"))}
          title="Pick an exact time"
          className={cn(presetClass(false), mode === "specific" && "border-[#09318D] text-[#09318D] dark:border-[#FD91CC] dark:text-[#FD91CC]")}
        >
          At specific time
        </button>
      </div>

      {!hasDueDate && (
        <p className="text-[11px] text-[#5B6478]/80 dark:text-[#9BB0D3]/70">
          Relative reminders need a due date — or pick an exact time below.
        </p>
      )}

      {mode === "custom" && hasDueDate && (
        <div className="border-t border-[#E4E8F2] pt-2 dark:border-[#132E74] flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={customMinutes}
            onChange={(e) => setCustomMinutes(e.target.value)}
            aria-label="Minutes before due"
            className="w-20 flex-none rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white"
          />
          <span className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">minutes before due</span>
          <button
            type="button"
            onClick={() => {
              const n = parseInt(customMinutes, 10);
              if (Number.isFinite(n) && n > 0) {
                onAdd({ kind: "relative", relativeTo: "due", offsetMin: -n });
                setMode("menu");
              }
            }}
            className="rounded bg-[#09318D] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0B3EA8] dark:bg-[#FD91CC] dark:text-[#051A4D] cursor-pointer"
          >
            Set
          </button>
        </div>
      )}

      {mode === "specific" && (
        <div className="border-t border-[#E4E8F2] pt-2 dark:border-[#132E74] flex items-center gap-2">
          <input
            type="datetime-local"
            value={specificTime}
            onChange={(e) => setSpecificTime(e.target.value)}
            aria-label="Reminder time"
            className="flex-1 rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white"
          />
          <button
            type="button"
            onClick={() => {
              if (specificTime) {
                onAdd({
                  kind: "absolute",
                  remindAt: new Date(specificTime).toISOString(),
                });
                setSpecificTime("");
                setMode("menu");
              }
            }}
            className="rounded bg-[#09318D] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0B3EA8] dark:bg-[#FD91CC] dark:text-[#051A4D] cursor-pointer"
          >
            Set
          </button>
        </div>
      )}
    </div>
  );
}
