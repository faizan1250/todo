import { v7 as uuidv7 } from "uuid";
import { db } from "./db";
import { getTimeOffset } from "./client";
import type { SyncOp } from "./outbox";

const ENTITY_TABLES = [
  "folders",
  "lists",
  "sections",
  "tasks",
  "checklistItems",
  "tags",
  "templates",
  "reminders",
  "recurrences",
  "places",
  "savedFilters",
  "timeBlocks",
  "user",
] as const;

type EntityName = (typeof ENTITY_TABLES)[number];

// Backend rejects mutations dated more than 5 minutes in the future.
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const LOCAL_WRITE_EVENT = "todo:local-write";

export async function localMutate(
  entity: string,
  op: SyncOp,
  entityId: string,
  patch?: any,
): Promise<string> {
  if (!(ENTITY_TABLES as readonly string[]).includes(entity)) {
    throw new Error(`Unknown sync entity: ${entity}`);
  }
  const tableName = entity as EntityName;

  const now = Date.now();
  const offset = await getTimeOffset();
  const editedAt = Math.min(now + offset, now + MAX_FUTURE_SKEW_MS);
  const id = uuidv7();

  const table = db.table(tableName);
  await db.transaction("rw", table, db.outbox, async () => {
    if (op === "delete") {
      const existing = await table.get(entityId);
      if (existing) {
        await table.update(entityId, {
          deletedAt: editedAt,
          updatedAt: editedAt,
        });
      } else {
        await table.put({
          id: entityId,
          deletedAt: editedAt,
          updatedAt: editedAt,
        });
      }
    } else {
      const existing = await table.get(entityId);
      await table.put({
        ...existing,
        ...patch,
        id: entityId,
        updatedAt: editedAt,
      });
    }
    await db.outbox.add({
      id,
      entity: tableName,
      op,
      entityId,
      patch,
      editedAt,
      createdAt: now,
      attempts: 0,
    });
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(LOCAL_WRITE_EVENT));
  }

  return id;
}
