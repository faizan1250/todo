// Local Upcoming view (mirrors backend views.ts "upcoming"):
// active tasks due (or starting, when no due) within tomorrow .. today+days.
// Default window 7 days, clamped 1..90 like the backend.

import { getDB } from "../../db/schema";
import { dayBounds } from "../dayBounds";
import type { LocalTask } from "../types";
import {
  asTask,
  isActiveTask,
  ms,
  sortByEffectiveDate,
  type ViewOptions,
} from "./shared";

export interface UpcomingOptions extends ViewOptions {
  days?: number;
}

export async function getUpcomingTasks(
  userId: string,
  opts: UpcomingOptions = {}
): Promise<LocalTask[]> {
  const now = opts.now ?? Date.now();
  const days = Math.min(Math.max(Math.floor(opts.days ?? 7) || 7, 1), 90);
  const today = dayBounds(now, opts.tz);
  const tomorrow = dayBounds(today.start + 24 * 60 * 60 * 1000, opts.tz);
  const windowEnd = dayBounds(
    today.start + (days + 1) * 24 * 60 * 60 * 1000,
    opts.tz
  );
  const rows = await getDB(userId).tasks.toArray();
  const out: LocalTask[] = [];
  for (const r of rows) {
    const t = asTask(r);
    if (!isActiveTask(t)) continue;
    const due = ms(t.dueAt);
    if (due != null) {
      const inWindow = t.allDay
        ? due >= tomorrow.floatStart && due < windowEnd.floatStart
        : due >= tomorrow.start && due < windowEnd.start;
      if (inWindow) out.push(t);
    } else {
      const start = ms(t.startAt);
      if (start == null) continue;
      const inWindow = t.allDay
        ? start >= tomorrow.floatStart && start < windowEnd.floatStart
        : start >= tomorrow.start && start < windowEnd.start;
      if (inWindow) out.push(t);
    }
  }
  return sortByEffectiveDate(out);
}
