import { API_BASE_URL } from "../auth-client";
import { db } from "./db";
import { getCursor, setCursor, setLastSyncAt } from "./meta";
import { getOrCreateDeviceId, } from "./device";
import { getPending, incrementAttempts, removeAcked } from "./outbox";

export const CLIENT_VERSION = "1";
const PULL_LIMIT = 500;
const PUSH_BATCH = 100;
const MAX_PULL_PAGES = 10;
const TIME_OFFSET_KEY = "timeOffset";

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

type EntityTable = (typeof ENTITY_TABLES)[number];

export class SyncUpdateRequired extends Error {
  constructor(message = "Please refresh to get the latest update.") {
    super(message);
    this.name = "SyncUpdateRequired";
  }
}

export interface PullResult {
  applied: number;
  hasMore: boolean;
}

export interface PushResult {
  acked: number;
  retried: number;
}

function throwIfUpdateRequired(res: Response, body: unknown): void {
  if (res.status === 426) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : typeof body === "object" && body !== null && "message" in body && typeof (body as { message: unknown }).message === "string"
          ? (body as { message: string }).message
          : "Please refresh to get the latest update.";
    throw new SyncUpdateRequired(message);
  }
}

export async function setTimeOffset(offsetMs: number): Promise<void> {
  await db.meta.put({ key: TIME_OFFSET_KEY, value: offsetMs });
}

export async function getTimeOffset(): Promise<number> {
  const row = await db.meta.get(TIME_OFFSET_KEY);
  return typeof row?.value === "number" ? row.value : 0;
}

async function clearAllEntityTables(): Promise<void> {
  await Promise.all(ENTITY_TABLES.map((t) => db.table(t).clear()));
}

export async function pullOnce(): Promise<PullResult> {
  const deviceId = await getOrCreateDeviceId();
  let cursor = await getCursor();

  const doFetch = async (c: string) => {
    const url = `${API_BASE_URL}/api/v1/sync?cursor=${encodeURIComponent(c)}&limit=${PULL_LIMIT}`;
    const res = await fetch(url, {
      credentials: "include",
      headers: {
        "X-Device-Id": deviceId,
        "X-Client-Version": CLIENT_VERSION,
      },
    });
    const body = await res.json().catch(() => null);
    return { res, body } as const;
  };

  let { res, body } = await doFetch(cursor);

  if (res.status === 409 && (body as { resync?: boolean } | null)?.resync === true) {
    await clearAllEntityTables();
    await setCursor("");
    cursor = "";
    ({ res, body } = await doFetch(cursor));
  }

  throwIfUpdateRequired(res, body);

  if (!res.ok) {
    throw new Error(`Sync pull failed with status ${res.status}`);
  }

  const changes = (body as { changes?: Record<string, unknown[]> }).changes ?? {};
  let applied = 0;
  for (const [entity, rows] of Object.entries(changes)) {
    if (!ENTITY_TABLES.includes(entity as EntityTable)) continue;
    if (!Array.isArray(rows) || rows.length === 0) continue;
    await db.table(entity).bulkPut(rows);
    applied += rows.length;
  }

  const nextCursor = (body as { cursor?: unknown }).cursor;
  if (typeof nextCursor === "string") {
    await setCursor(nextCursor);
  }
  const serverTime = (body as { serverTime?: unknown }).serverTime;
  if (typeof serverTime === "number") {
    await setTimeOffset(serverTime - Date.now());
  }
  await setLastSyncAt(Date.now());

  return {
    applied,
    hasMore: (body as { hasMore?: unknown }).hasMore === true,
  };
}

type PushStatus = "applied" | "duplicate" | "rejected" | "ignored" | "failed";

export async function pushOnce(): Promise<PushResult> {
  const deviceId = await getOrCreateDeviceId();
  const pending = (await getPending()).slice(0, PUSH_BATCH);
  if (pending.length === 0) return { acked: 0, retried: 0 };

  const mutations = pending.map(({ id, entity, op, entityId, patch, editedAt, schemaVersion }) => ({
    id,
    entity,
    op,
    entityId,
    patch,
    editedAt,
    schemaVersion,
  }));

  const res = await fetch(`${API_BASE_URL}/api/v1/sync/push`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
      "X-Client-Version": CLIENT_VERSION,
    },
    body: JSON.stringify({ mutations }),
  });
  const body = await res.json().catch(() => null);
  throwIfUpdateRequired(res, body);

  if (!res.ok) {
    throw new Error(`Sync push failed with status ${res.status}`);
  }

  const results = ((body as { results?: { id: string; status: PushStatus }[] }).results ?? []) as {
    id: string;
    status: PushStatus;
  }[];

  const acked: string[] = [];
  let retried = 0;
  for (const r of results) {
    if (r.status === "applied" || r.status === "duplicate") {
      acked.push(r.id);
    } else if (r.status === "rejected") {
      // Rejected mutations can never succeed: drop locally and let the
      // next pull overwrite local state with the server version.
      acked.push(r.id);
    } else {
      await incrementAttempts(r.id);
      retried += 1;
    }
  }
  await removeAcked(acked);
  return { acked: acked.length, retried };
}

let syncInFlight = false;

export async function syncNow(): Promise<{ pushed: PushResult; pulled: number }> {
  if (syncInFlight) return { pushed: { acked: 0, retried: 0 }, pulled: 0 };
  syncInFlight = true;
  try {
    const pushed = await pushOnce();
    let pulled = 0;
    for (let page = 0; page < MAX_PULL_PAGES; page++) {
      const result = await pullOnce();
      pulled += result.applied;
      if (!result.hasMore) break;
    }
    return { pushed, pulled };
  } finally {
    syncInFlight = false;
  }
}
