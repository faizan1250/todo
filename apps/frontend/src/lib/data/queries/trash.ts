// Local Trash view: tombstoned tasks, most recently deleted first.

import { getDB } from "../../db/schema";
import type { LocalTask } from "../types";
import { asTask, isAlive, ms } from "./shared";

export async function getTrashTasks(
  userId: string,
  limit = 200
): Promise<LocalTask[]> {
  const rows = await getDB(userId).tasks.toArray();
  const out = rows.map(asTask).filter((t) => !isAlive(t));
  out.sort((x, y) => {
    const dx = ms(x.deletedAt) ?? 0;
    const dy = ms(y.deletedAt) ?? 0;
    if (dx !== dy) return dy - dx;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  return out.slice(0, Math.max(0, limit));
}
