// Local Inbox view: non-deleted tasks in inbox list(s), position order.

import { getDB } from "../../db/schema";
import type { LocalTask } from "../types";
import { asTask, isAlive, sortByPosition } from "./shared";

export async function getInboxTasks(userId: string): Promise<LocalTask[]> {
  const db = getDB(userId);
  const lists = await db.lists.toArray();
  const inboxIds = new Set(
    lists
      .filter(
        (l) =>
          l["isInbox"] === true && l["deleted"] !== 1 && l["deletedAt"] == null
      )
      .map((l) => l["id"] as string)
  );
  if (inboxIds.size === 0) return [];
  const rows = await db.tasks.where("listId").anyOf([...inboxIds]).toArray();
  return sortByPosition(rows.filter((r) => isAlive(asTask(r))).map(asTask));
}
