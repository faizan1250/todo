/**
 * Local next-date computation for repeat previews and the complete toast.
 * This module statically imports `rrule`; UI entry points lazy-import this
 * module (`await import("./next-dates")`) so the parser stays out of the
 * initial panel/workspace chunks.
 */
import { rrulestr } from "rrule";

export interface NextDatesOptions {
  /** Anchor occurrence (usually the task dueAt). Defaults to now. */
  anchorIso?: string | number | null;
  /** How many upcoming dates to return. Defaults to 3. */
  count?: number;
  /** Reference "now". Defaults to new Date(). */
  now?: Date;
}

/** Upcoming occurrence dates, ascending. Never throws — [] on bad rules. */
export function getNextDates(rrule: string, opts: NextDatesOptions = {}): Date[] {
  const want = Math.max(1, Math.min(opts.count ?? 3, 10));
  try {
    const anchorRaw = opts.anchorIso ?? null;
    const anchor = anchorRaw != null ? new Date(anchorRaw) : (opts.now ?? new Date());
    if (Number.isNaN(anchor.getTime())) return [];
    const now = opts.now ?? new Date();
    // Anchor in the past would replay history: start from max(anchor, now).
    const dtstart = anchor.getTime() < now.getTime() ? now : anchor;
    const rule = rrulestr(rrule, { dtstart });
    const out: Date[] = [];
    let cursor: Date | null = dtstart;
    for (let i = 0; i < want; i++) {
      // Exclusive: the anchor is the current occurrence, we want what follows.
      const next = rule.after(cursor, false);
      if (!next) break;
      out.push(next);
      cursor = next;
    }
    return out;
  } catch {
    return [];
  }
}

/** First upcoming occurrence, or null. Never throws. */
export function getNextDate(rrule: string, opts: NextDatesOptions = {}): Date | null {
  return getNextDates(rrule, { ...opts, count: 1 })[0] ?? null;
}
