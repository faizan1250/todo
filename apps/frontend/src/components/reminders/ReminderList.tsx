"use client";

import * as React from "react";
import { useState } from "react";
import { Bell, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReminderItem } from "@/components/app/types";
import {
  getReminderMeaning,
  REMINDER_NO_DATE_HINT,
} from "./reminder-meaning";
import { SnoozeSheet } from "./SnoozeSheet";

export interface ReminderListProps {
  reminders: ReminderItem[];
  /** Task dates the relative reminders are measured from (picked per row). */
  dueAt?: string | number | Date | null;
  startAt?: string | number | Date | null;
  deadlineAt?: string | number | Date | null;
  onSnooze: (reminderId: string, minutes: number) => void;
  onSnoozeAt: (reminderId: string, time: Date) => void;
  onDismiss: (reminderId: string) => void;
  onDelete: (reminderId: string) => void;
}

/**
 * Reminder rows with a plain-words meaning line ("1 hour before") plus the
 * resolved time ("Today, 4:00 PM"). Anchor-less relative rows read
 * "Waiting for a date"; elapsed rows read "Already passed".
 */
export function ReminderList({
  reminders,
  dueAt,
  startAt,
  deadlineAt,
  onSnooze,
  onSnoozeAt,
  onDismiss,
  onDelete,
}: ReminderListProps) {
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);

  if (reminders.length === 0) {
    return (
      <p className="text-xs text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic">
        No reminders set for this task.
      </p>
    );
  }

  const anchorFor = (reminder: ReminderItem): string | number | Date | null | undefined => {
    if (reminder.relativeTo === "start") return startAt;
    if (reminder.relativeTo === "deadline") return deadlineAt;
    return dueAt;
  };

  return (
    <div className="space-y-1.5">
      {reminders.map((reminder) => {
        const { meaning, detail, status } = getReminderMeaning(reminder, {
          anchorDate: anchorFor(reminder),
        });
        const isFired = status === "fired";
        const isPast = status === "passed";
        const isWaiting = status === "no-date";

        return (
          <div
            key={reminder.id}
            className="flex items-center justify-between gap-2 rounded-lg border border-[#E4E8F2] bg-white px-3 py-2 text-xs transition-colors dark:border-[#132E74] dark:bg-[#082363]"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Bell
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isFired || isPast
                    ? "text-[#5B6478]/50 dark:text-[#9BB0D3]/40"
                    : "text-[#09318D] dark:text-[#FD91CC]"
                )}
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "truncate font-medium",
                    isFired && "line-through text-[#5B6478]/70 dark:text-[#9BB0D3]/60"
                  )}
                >
                  {meaning} · {detail}
                </p>
                {isWaiting && (
                  <p className="truncate text-[10px] text-[#5B6478]/70 dark:text-[#9BB0D3]/60">
                    {REMINDER_NO_DATE_HINT}
                  </p>
                )}
                {isFired && (
                  <span className="text-[10px] text-amber-600 dark:text-amber-400 font-mono">
                    Fired / Dismissed
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {!isFired && (
                <>
                  <button
                    type="button"
                    onClick={() => setSnoozeFor(reminder.id)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] cursor-pointer"
                    title="Remind me later"
                  >
                    Remind me later
                  </button>
                  <button
                    type="button"
                    onClick={() => onDismiss(reminder.id)}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/40 cursor-pointer"
                    title="Dismiss reminder"
                  >
                    Dismiss
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => onDelete(reminder.id)}
                className="flex h-6 w-6 items-center justify-center rounded text-[#5B6478] hover:text-rose-600 hover:bg-rose-50 transition-colors dark:text-[#9BB0D3] dark:hover:text-rose-400 dark:hover:bg-rose-950/40 cursor-pointer"
                title="Delete reminder"
                aria-label={`Delete reminder ${meaning}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      })}

      <SnoozeSheet
        open={snoozeFor !== null}
        onClose={() => setSnoozeFor(null)}
        onPick={(minutes) => {
          if (snoozeFor) onSnooze(snoozeFor, minutes);
          setSnoozeFor(null);
        }}
        onPickTime={(time) => {
          if (snoozeFor) onSnoozeAt(snoozeFor, time);
          setSnoozeFor(null);
        }}
      />
    </div>
  );
}
