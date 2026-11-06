import { rrulestr } from "rrule";
import { toUtcMidnight } from "./dayBounds";

export interface ExpandOccurrencesOptions {
  from: Date;
  to: Date;
  dtstart: Date;
  /**
   * Accepted for API forward-compat. Expansion itself is tz-independent
   * (absolute instants, exactly like the backend calendar route); all-day
   * outputs are normalized to UTC-midnight floating dates.
   */
  tz?: string;
  /** Max occurrences returned. Backend caps at 50 per series. */
  cap?: number;
  /** When true, each occurrence is normalized via toUtcMidnight (floating date). */
  allDay?: boolean;
}

/**
 * Expand an RRULE into concrete occurrence instants within [from, to]
 * (inclusive, via rrule.between), mirroring backend calendar expansion:
 * rule built with dtstart = reference due/start, inclusive bounds, cap 50.
 *
 * NOTE (DST): timed recurrences expand as absolute instants, same as the
 * backend — wall-clock shifting across DST uses calculateNextOccurrence().
 */
export function expandOccurrences(rruleStr: string, opts: ExpandOccurrencesOptions): Date[] {
  const cap = opts.cap ?? 50;
  const rule = rrulestr(rruleStr, { dtstart: opts.dtstart });
  const occurrences = rule.between(opts.from, opts.to, true);
  const sliced = occurrences.slice(0, Math.max(0, cap));
  if (opts.allDay) {
    return sliced.map((o) => toUtcMidnight(o.toISOString().slice(0, 10)));
  }
  return sliced;
}
