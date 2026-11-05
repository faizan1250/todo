// Outbox read helpers for the sync engine (Phase 5 Day 2a).
//
// pendingPatchesByEntity() merges every pending entry for an
// (entity, entityId) pair into one field patch, newest value per field.
// The apply layer spreads this over the incoming server row so the server
// never overwrites unsent local edits (rebase).
//
// Note: create+delete cancelled pairs never reach the outbox (mutate.ts
// drops them), and delete entries carry no patch, so merging is just a
// newest-wins fold over upsert patches in push order.

import { getDB } from "../db/schema";
import type { LocalOutboxEntry } from "../data/mutate";

export type { LocalOutboxEntry };

export function pendingKey(entity: string, entityId: string): string {
  return `${entity}:${entityId}`;
}

function sortOldestFirst(entries: LocalOutboxEntry[]): LocalOutboxEntry[] {
  return [...entries].sort(
    (a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

// All pending entries, oldest first (push order).
export async function getPending(
  userId: string
): Promise<LocalOutboxEntry[]> {
  const db = getDB(userId);
  const rows = await db.outbox.toArray();
  return sortOldestFirst(rows as LocalOutboxEntry[]);
}

// Merged pending patch per "entity:entityId", newest value per field.
export async function pendingPatchesByEntity(
  userId: string
): Promise<Map<string, Record<string, unknown>>> {
  const pending = await getPending(userId);
  const merged = new Map<string, Record<string, unknown>>();
  for (const entry of pending) {
    if (entry.op !== "upsert" || !entry.patch) continue;
    const key = pendingKey(entry.entity, entry.entityId);
    const acc = merged.get(key) ?? {};
    for (const [field, value] of Object.entries(entry.patch)) {
      acc[field] = value;
    }
    merged.set(key, acc);
  }
  return merged;
}
