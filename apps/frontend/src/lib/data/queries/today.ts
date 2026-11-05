// Local Today view (mirrors backend views.ts "today"):
// active tasks with due before end of today (includes overdue), plus tasks
// with no due whose start falls within today.

import { getDB } from "../../../db/schema";
import { dayBounds } from "../dayBounds";
import type { LocalTask } from "../types";
import {
  asTask,
  isActiveTask,
  ms,
  sortByEffectiveDate,
  type ViewOptions,
} from "./shared";

export async function getTodayTasks(
  userId: string,
  opts: ViewOptions = {}
): Promise<LocalTask[]> {
  const b = dayBounds(opts.now ?? Date.now(), opts.tz);
  const rows = await getDB(userId).tasks.toArray();
  const out: LocalTask[] = [];
  for (const r of rows) {
    const t = asTask(r);
    if (!isActiveTask(t)) continue;
    const due = ms(t.dueAt);
    if (due != null) {
      const end = t.allDay ? b.floatEnd : b.end;
      if (due < end) out.push(t);
    } else {
      const start = ms(t.startAt);
      if (start == null) continue;
      const inDay = t.allDay
        ? start >= b.floatStart && start < b.floatEnd
        : start >= b.start && start < b.end;
      if (inDay) out.push(t);
    }
  }
  return sortByEffectiveDate(out);
}
