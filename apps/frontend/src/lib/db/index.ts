import Dexie from "dexie";
import { getDB, TodoDB } from "./schema";

export { getDB, TodoDB };
export type { MetaKey, MetaRow, OutboxEntry, OutboxOp, SyncRow } from "./schema";

export function closeDB(userId: string): void {
  const db = getDB(userId);
  db.close();
}

// Sign-out wipe: close the cached handle and delete the per-user DB.
export async function deleteUserDB(userId: string): Promise<void> {
  const db = getDB(userId);
  db.close();
  await Dexie.delete(`todo-${userId}`);
}
