"use client";

import { Bell, Calendar, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatOverdue, formatWhen } from "@/lib/dates/formatWhen";
import { useNow } from "@/lib/dates/useNow";

export interface DateChipProps {
  dueAt: string | number | Date | null | undefined;
  allDay?: boolean;
  /** Visual status override. Derived from the date when omitted. */
  status?: "overdue" | "today" | "upcoming" | "none";
  hasRepeat?: boolean;
  hasBell?: boolean;
  /** Whether the popover is currently open (chevron + aria state). */
  expanded?: boolean;
  timeZone?: string;
  /** Test seam: reference point for relative labels. Defaults to live time. */
  now?: Date;
  onOpen: () => void;
}

/**
 * Compact schedule pill for the task-detail pills bar.
 * Label and tone come from formatWhen/formatOverdue so the chip, popover
 * preview, and list rows all read the same words.
 */
export function DateChip({
  dueAt,
  allDay = false,
  status,
  hasRepeat = false,
  hasBell = false,
  expanded = false,
  timeZone,
  now: nowProp,
  onOpen,
}: DateChipProps) {
  const liveNow = useNow();
  const now = nowProp ?? liveNow;

  const label = formatWhen(dueAt, { now, allDay, timeZone });
  const isOverdue = formatOverdue(dueAt, { now, timeZone }) !== null;
  const resolved: NonNullable<DateChipProps["status"]> =
    status ?? (label === null ? "none" : isOverdue ? "overdue" : label.startsWith("Today") ? "today" : "upcoming");

  const ariaLabel =
    label === null
      ? "Set due date"
      : `Due ${label.charAt(0).toLowerCase()}${label.slice(1)}`;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={ariaLabel}
      aria-expanded={expanded}
      aria-haspopup="dialog"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer focus-ring-pink motion-reduce:transition-none",
        resolved === "overdue" &&
          "border-rose-300 bg-rose-50/80 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400",
        resolved === "today" &&
          "border-[#09318D]/30 bg-[#09318D]/5 text-[#09318D] dark:border-[#FD91CC]/30 dark:bg-[#FD91CC]/10 dark:text-[#FFA8D7]",
        (resolved === "upcoming" || resolved === "none") &&
          "border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
      )}
      title="Change schedule and dates"
    >
      <Calendar
        className={cn(
          "h-3.5 w-3.5",
          resolved === "overdue"
            ? "text-rose-600 dark:text-rose-400"
            : "text-[#09318D] dark:text-[#FD91CC]"
        )}
        aria-hidden="true"
      />
      <span>
        Due: <span className="font-semibold">{label ?? "None"}</span>
        {allDay && label !== null && (
          <span className="ml-1 text-[10px] opacity-75">(All day)</span>
        )}
      </span>
      {hasRepeat && (
        <Repeat className="h-3 w-3 opacity-60" aria-label="Repeating task" />
      )}
      {hasBell && (
        <Bell className="h-3 w-3 opacity-60" aria-label="Has reminder" />
      )}
    </button>
  );
}
