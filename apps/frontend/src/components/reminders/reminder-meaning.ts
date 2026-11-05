import type { ReminderItem } from "@/components/app/types";
import { formatWhen } from "@/lib/dates/formatWhen";

export const REMINDER_LIMIT = 10;

export const REMINDER_CAP_MESSAGE =
  "You've added 10 reminders — the most we can keep on one task.";

export type ReminderStatus = "scheduled" | "no-date" | "passed" | "fired";

export interface ReminderMeaning {
  /** Plain-words meaning, e.g. "1 hour before", "At due time". */
  meaning: string;
  /** Resolved time or state line, e.g. "Today, 4:00 PM", "Waiting for a date". */
  detail: string;
  status: ReminderStatus;
}

/** Backend marks anchor-less relative reminders inactive with epoch-zero. */
function toValidDate(value: ReminderItem["remindAt"]): Date | null {
  if (value === null || value === undefined) return null;
  const d = typeof value === "object" ? value : new Date(value);
  if (Number.isNaN(d.getTime()) || d.getTime() === 0) return null;
  return d;
}

function anchorWord(relativeTo: ReminderItem["relativeTo"]): string {
  if (relativeTo === "start") return "start";
  if (relativeTo === "deadline") return "deadline";
  return "due";
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

/**
 * Plain-words meaning for a reminder's offset, e.g. "1 hour before".
 * Common presets read exactly ("10 minutes before"); anything else is
 * composed from the same words ("3 hours before", "2 days after start").
 */
export function formatOffsetMeaning(
  offsetMin: number | null | undefined,
  relativeTo: ReminderItem["relativeTo"]
): string {
  const anchor = anchorWord(relativeTo);
  const offset = offsetMin ?? 0;
  if (offset === 0) return `At ${anchor} time`;
  const abs = Math.abs(offset);
  const dir = offset < 0 ? "before" : "after";
  if (abs % 1440 === 0) return `${plural(abs / 1440, "day")} ${dir}`;
  if (abs % 60 === 0) return `${plural(abs / 60, "hour")} ${dir}`;
  return `${plural(abs, "minute")} ${dir}`;
}

export interface MeaningOptions {
  /**
   * The anchor date the relative reminder is measured from
   * (task due/start/deadline). Pass null/undefined when the task has no
   * such date — relative rows then read "Waiting for a date" instead of a
   * possibly stale server timestamp. Omit to judge by remindAt alone.
   */
  anchorDate?: string | number | Date | null;
  now?: Date | number;
}

/**
 * Meaning + resolved-time line for one reminder row.
 * Display rule: always show the server's remindAt value as-is (no silent
 * client recompute); the no-date and passed states are display-only.
 */
export function getReminderMeaning(
  reminder: ReminderItem,
  options: MeaningOptions = {}
): ReminderMeaning {
  const now =
    options.now instanceof Date
      ? options.now
      : new Date(options.now ?? Date.now());
  const fired = Boolean(reminder.firedAt);
  const meaning =
    reminder.kind === "absolute"
      ? "At specific time"
      : formatOffsetMeaning(reminder.offsetMin, reminder.relativeTo);

  const hasAnchorOption = "anchorDate" in options;
  const anchorMissing =
    hasAnchorOption &&
    (options.anchorDate === null ||
      options.anchorDate === undefined ||
      options.anchorDate === "");
  if (reminder.kind === "relative" && anchorMissing) {
    return {
      meaning,
      detail: "Waiting for a date",
      status: "no-date",
    };
  }

  const resolved = toValidDate(reminder.remindAt);
  if (!resolved) {
    return {
      meaning,
      detail: "Waiting for a date",
      status: "no-date",
    };
  }

  const label = formatWhen(resolved, { now }) ?? resolved.toLocaleString();
  if (fired) return { meaning, detail: label, status: "fired" };
  if (resolved.getTime() < now.getTime()) {
    return { meaning, detail: `Already passed · ${label}`, status: "passed" };
  }
  return { meaning, detail: label, status: "scheduled" };
}

export const REMINDER_NO_DATE_HINT =
  "Set a date on this task and we'll schedule this reminder.";
