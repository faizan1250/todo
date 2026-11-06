"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

export interface EstimatePickerProps {
  value: number | null;
  onChange: (minutes: number | null) => void;
}

const PRESETS = [
  { label: "15m", value: 15 },
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
  { label: "2h", value: 120 },
] as const;

/**
 * Standalone duration picker ("How long will it take?") with presets plus a
 * custom-minutes field. Controlled; persistence stays with the caller.
 */
export function EstimatePicker({ value, onChange }: EstimatePickerProps) {
  const [custom, setCustom] = useState("");

  const commitCustom = () => {
    const minutes = parseInt(custom, 10);
    if (!Number.isNaN(minutes) && minutes > 0 && minutes <= 1440) {
      onChange(minutes);
      setCustom("");
    }
  };

  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
        {copy.scheduling.estimatePrompt}
      </p>
      <div className="mt-1.5 grid grid-cols-5 gap-1" role="group" aria-label={copy.scheduling.estimatePrompt}>
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "min-h-12 rounded-lg px-1.5 text-xs transition-colors duration-150 cursor-pointer focus-ring-pink motion-reduce:transition-none",
            value === null
              ? "bg-[#09318D] font-bold text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
              : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
          )}
        >
          None
        </button>
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => onChange(preset.value)}
            aria-pressed={value === preset.value}
            className={cn(
              "min-h-12 rounded-lg px-1.5 text-xs transition-colors duration-150 cursor-pointer focus-ring-pink motion-reduce:transition-none",
              value === preset.value
                ? "bg-[#09318D] font-bold text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
            )}
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          type="number"
          min={1}
          max={1440}
          inputMode="numeric"
          placeholder="Custom minutes"
          aria-label="Custom minutes"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitCustom();
          }}
          className="min-h-12 min-w-0 flex-1 rounded-lg border border-[#E4E8F2] bg-white px-3 text-xs text-[#0B1220] focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
        />
        <button
          type="button"
          onClick={commitCustom}
          disabled={custom.trim() === ""}
          className="min-h-12 rounded-lg bg-[#09318D] px-4 text-xs font-semibold text-white transition-colors duration-150 hover:bg-[#0B3EA8] focus-ring-pink disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none dark:bg-[#FD91CC] dark:text-[#051A4D]"
        >
          Set
        </button>
      </div>
    </div>
  );
}
