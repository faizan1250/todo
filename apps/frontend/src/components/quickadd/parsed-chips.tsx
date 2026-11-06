"use client";

import * as React from "react";
import {
  AtSign,
  Bell,
  Calendar,
  Clock,
  Flag,
  Repeat,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react";
import type { AmbiguousHour, ChipKind, ParsedChip } from "./smart-parse";

const KIND_ICON: Record<ChipKind, LucideIcon> = {
  date: Calendar,
  recurrence: Repeat,
  reminder: Bell,
  tag: Tag,
  list: AtSign,
  priority: Flag,
  estimate: Clock,
};

interface ParsedChipsProps {
  chips: ParsedChip[];
  unknownListQuery: string | null;
  ambiguousHour: AmbiguousHour | null;
  onRemoveChip: (chip: ParsedChip) => void;
  onResolveHour: (chip: ParsedChip, ampm: "am" | "pm") => void;
}

/**
 * Additive display under the quick-add input. Chips never carry state —
 * removal rewrites the input text (plain words), the existing submit path
 * then parses the final string as before.
 */
export function ParsedChips({
  chips,
  unknownListQuery,
  ambiguousHour,
  onRemoveChip,
  onResolveHour,
}: ParsedChipsProps) {
  if (chips.length === 0 && !unknownListQuery && !ambiguousHour) return null;

  const ambiguousKey = ambiguousHour ? ambiguousHour.chip.key : null;

  return (
    <div
      data-testid="smart-chips"
      aria-label="Detected task details"
      className="flex flex-wrap items-center gap-1.5"
    >
      {chips.map((chip) => {
        if (chip.key === ambiguousKey && ambiguousHour) {
          const { hour } = ambiguousHour;
          return (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded bg-amber-50 py-0.5 pl-1.5 pr-1 text-[10px] font-mono font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
            >
              <Clock className="h-2.5 w-2.5" />
              <span>{hour}:00 PM?</span>
              <span className="ml-0.5 inline-flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => onResolveHour(chip, "am")}
                  aria-label={`Use ${hour} AM`}
                  className="rounded px-1 py-px font-semibold hover:bg-amber-200/70 dark:hover:bg-amber-900/70 cursor-pointer"
                >
                  AM
                </button>
                <button
                  type="button"
                  onClick={() => onResolveHour(chip, "pm")}
                  aria-label={`Use ${hour} PM`}
                  className="rounded px-1 py-px font-semibold hover:bg-amber-200/70 dark:hover:bg-amber-900/70 cursor-pointer"
                >
                  PM
                </button>
              </span>
              <button
                type="button"
                onClick={() => onRemoveChip(chip)}
                aria-label={`Remove time ${chip.label}`}
                className="rounded p-px hover:bg-amber-200/70 dark:hover:bg-amber-900/70 cursor-pointer"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          );
        }
        const Icon = KIND_ICON[chip.kind];
        return (
          <span
            key={chip.key}
            className="inline-flex max-w-[180px] items-center gap-1 rounded bg-[#09318D]/10 py-0.5 pl-1.5 pr-1 text-[10px] font-mono font-medium text-[#09318D] dark:bg-[#FD91CC]/15 dark:text-[#FFA8D7]"
          >
            <Icon className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{chip.label}</span>
            <button
              type="button"
              onClick={() => onRemoveChip(chip)}
              aria-label={`Remove ${chip.kind} ${chip.label}`}
              className="rounded p-px hover:bg-[#09318D]/20 dark:hover:bg-[#FD91CC]/25 cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {unknownListQuery && (
        <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <AtSign className="h-2.5 w-2.5" />
          <span>Inbox (couldn&apos;t find &apos;{unknownListQuery}&apos;)</span>
        </span>
      )}
    </div>
  );
}
