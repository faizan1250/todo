"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { formatNextDateLabel, type RepeatMode } from "./rrule-presets";

interface RepeatSummaryProps {
  rrule: string | null;
  mode?: RepeatMode;
  /** Anchor occurrence (usually task dueAt) for the next-date preview. */
  anchorIso?: string | number | null;
}

/**
 * Plain-words recurrence summary + next-3 preview. Both the shared
 * summarizer and the rrule parser load lazily so the repeat panel chunk
 * stays light; renders nothing while loading and the raw rule on failure.
 */
export function RepeatSummary({ rrule, mode = "fixed", anchorIso = null }: RepeatSummaryProps) {
  const [summary, setSummary] = useState<string | null>(null);
  const [next, setNext] = useState<Date[]>([]);

  useEffect(() => {
    if (!rrule) {
      setSummary(null);
      setNext([]);
      return;
    }
    let live = true;
    Promise.all([import("@todo/shared"), import("./next-dates")])
      .then(([shared, nd]) => {
        if (!live) return;
        setSummary(shared.buildRecurrenceSummary(rrule, mode));
        const dates = nd.getNextDates(rrule, { anchorIso, count: 3 });
        setNext(dates);
        // Pre-warm the formatted labels (Intl cost paid once here).
        void dates.map(formatNextDateLabel);
      })
      .catch(() => {
        if (live) setSummary(rrule);
      });
    return () => {
      live = false;
    };
  }, [rrule, mode, anchorIso]);

  if (!rrule || !summary) return null;

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-[#0B1220] dark:text-white">{summary}</p>
      {next.length > 0 && (
        <p className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
          Next: {next.map(formatNextDateLabel).join(" · ")}
        </p>
      )}
    </div>
  );
}
