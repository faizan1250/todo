// Local Overdue view (mirrors backend views.ts "overdue"):
// active tasks with a due date before now (timed) or before today's floating
// start (all-day).

import { getDB } from "../../db/schema";
import { dayBounds } from "../dayBounds";
import type { LocalTask } from "../types";
import { asTask, isActiveTask, ms, type ViewOptions } from "./shared";

export async function getOverdueTasks(
  userId: string,
  opts: ViewOptions = {}
): Promise<LocalTask[]> {
  const now = opts.now ?? Date.now();
  const b = dayBounds(now, opts.tz);
  const rows = await getDB(userId).tasks.toArray();
  const out: LocalTask[] = [];
  for (const r of rows) {
    const t = asTask(r);
    if (!isActiveTask(t)) continue;
    const due = ms(t.dueAt);
    if (due == null) continue;
    if (t.allDay ? due < b.floatStart : due < now) out.push(t);
  }
  out.sort((x, y) => {
    const dx = ms(x.dueAt) ?? 0;
    const dy = ms(y.dueAt) ?? 0;
    if (dx !== dy) return dx - dy;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  return out;
}
