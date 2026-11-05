import { v7 as uuidv7 } from "uuid";
import { db, type OutboxEntry } from "./db";

export type SyncOp = "upsert" | "delete";

export interface SyncMutation {
  id: string;
  entity: string;
  op: SyncOp;
  entityId: string;
  patch?: unknown;
  editedAt: number;
  schemaVersion?: number;
}

export type NewOutboxEntry = Omit<OutboxEntry, "id" | "createdAt" | "attempts"> & {
  id?: string;
  createdAt?: number;
  attempts?: number;
};

export async function enqueue(entry: NewOutboxEntry): Promise<string> {
  const id = entry.id ?? uuidv7();
  await db.outbox.add({
    ...entry,
    id,
    createdAt: entry.createdAt ?? Date.now(),
    attempts: entry.attempts ?? 0,
  });
  return id;
}

export async function getPending(): Promise<OutboxEntry[]> {
  return db.outbox.orderBy("createdAt").toArray();
}

export async function removeAcked(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.outbox.bulkDelete(ids);
}

export async function incrementAttempts(id: string): Promise<void> {
  const existing = await db.outbox.get(id);
  if (!existing) return;
  await db.outbox.update(id, { attempts: existing.attempts + 1 });
}
