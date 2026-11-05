import { db } from "./db";

const CURSOR_KEY = "cursor";
const EPOCH_KEY = "epoch";
const LAST_SYNC_AT_KEY = "lastSyncAt";

export async function getCursor(): Promise<string> {
  const row = await db.meta.get(CURSOR_KEY);
  return typeof row?.value === "string" ? row.value : "";
}

export async function setCursor(cursor: string): Promise<void> {
  await db.meta.put({ key: CURSOR_KEY, value: cursor });
}

export async function getEpoch(): Promise<string> {
  const row = await db.meta.get(EPOCH_KEY);
  return typeof row?.value === "string" ? row.value : "";
}

export async function setEpoch(epoch: string): Promise<void> {
  await db.meta.put({ key: EPOCH_KEY, value: epoch });
}

export async function getLastSyncAt(): Promise<number> {
  const row = await db.meta.get(LAST_SYNC_AT_KEY);
  return typeof row?.value === "number" ? row.value : 0;
}

export async function setLastSyncAt(timestamp: number): Promise<void> {
  await db.meta.put({ key: LAST_SYNC_AT_KEY, value: timestamp });
}
