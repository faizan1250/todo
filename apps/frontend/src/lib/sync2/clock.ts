// Sync clock offset (Phase 5 Day 2a).
//
// The backend clamps mutations dated more than 5 minutes in the future and
// resolves LWW ties with server time. We track serverTime - Date.now() in
// db.meta ("clockOffset") so mutate.ts can stamp editedAt without tripping
// the future-skew clamp after the local clock drifts.

import { getDB } from "../db/schema";

const CLOCK_OFFSET_KEY = "clockOffset";

export async function getOffset(userId: string): Promise<number> {
  const db = getDB(userId);
  const row = await db.meta.get(CLOCK_OFFSET_KEY);
  return typeof row?.value === "number" ? row.value : 0;
}

export async function setOffset(
  userId: string,
  offsetMs: number
): Promise<void> {
  const db = getDB(userId);
  await db.meta.put({ key: CLOCK_OFFSET_KEY, value: offsetMs });
}

// Record a fresh serverTime sample. Returns the learned offset.
export async function learnOffset(
  userId: string,
  serverTime: number
): Promise<number> {
  const offset = serverTime - Date.now();
  await setOffset(userId, offset);
  return offset;
}
