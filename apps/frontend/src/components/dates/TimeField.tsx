"use client";

import { cn } from "@/lib/utils";

export interface TimeFieldProps {
  id: string;
  label: string;
  /** "HH:mm" 24h value, or "" when unset. */
  value: string;
  onChange: (value: string) => void;
  /** Step alignment in minutes. Defaults to 15. */
  stepMin?: number;
  disabled?: boolean;
}

/**
 * Labeled time input in 15-minute steps. The native control follows the
 * device locale for 12/24-hour display, so no locale prop is needed.
 */
export function TimeField({
  id,
  label,
  value,
  onChange,
  stepMin = 15,
  disabled = false,
}: TimeFieldProps) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3">
      <label
        htmlFor={id}
        className="text-xs font-medium text-[#5B6478] dark:text-[#9BB0D3]"
      >
        {label}
      </label>
      <input
        id={id}
        type="time"
        step={stepMin * 60}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "min-h-12 rounded-lg border border-[#E4E8F2] bg-white px-3 text-sm text-[#0B1220] transition-colors duration-150 focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] motion-reduce:transition-none dark:border-[#132E74] dark:bg-[#082363] dark:text-white",
          disabled && "cursor-not-allowed opacity-50"
        )}
      />
    </div>
  );
}
