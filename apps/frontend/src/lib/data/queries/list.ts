// Local list view: non-deleted tasks of one list, position order.
// Subtasks are included; callers group by parentId/sectionId for display.

import { getDB } from "../../../db/schema";
import type { LocalTask } from "../types";
import { asTask, isAlive, sortByPosition } from "./shared";

export async function getListTasks(
  userId: string,
  listId: string
): Promise<LocalTask[]> {
  const rows = await getDB(userId).tasks.where("listId").equals(listId).toArray();
  return sortByPosition(rows.filter((r) => isAlive(asTask(r))).map(asTask));
}
