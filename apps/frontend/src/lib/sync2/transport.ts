// Sync HTTP transport (Phase 5 Day 2a, per-user engine).
//
// Thin fetch wrapper over the backend sync contract:
//   GET  /api/v1/sync?cursor=&limit=  (headers X-Device-Id, X-Client-Version)
//     -> { cursor, hasMore, serverTime, changes }
//   POST /api/v1/sync/push { mutations: [...] }
//     -> { results: [{ id, status, version?, seq?, reason? }] }
//   409 { resync: true } -> SyncResyncRequired (caller clears + restarts)
//   426                   -> SyncUpdateRequired (engine retries with backoff;
//                            no user-facing update prompt)
//   429                   -> RetryableError with delayMs from Retry-After

import { API_BASE_URL } from "../auth-client";

export const CLIENT_VERSION = "1.0.0";

const SYNC_PATH = "/api/v1/sync";
const DEFAULT_RETRY_DELAY_MS = 5000;

export class SyncUpdateRequired extends Error {
  constructor(message = "Please refresh to get the latest update.") {
    super(message);
    this.name = "SyncUpdateRequired";
  }
}

export class SyncResyncRequired extends Error {
  constructor(message = "Server requested a full resync.") {
    super(message);
    this.name = "SyncResyncRequired";
  }
}

export class RetryableError extends Error {
  readonly delayMs: number;
  readonly status: number;
  constructor(status: number, delayMs: number, message?: string) {
    super(message ?? `Request failed with status ${status}, retry later.`);
    this.name = "RetryableError";
    this.status = status;
    this.delayMs = delayMs;
  }
}

export interface PullChanges {
  [entity: string]: Record<string, unknown>[];
}

export interface PullPageResult {
  cursor: string;
  hasMore: boolean;
  serverTime: number;
  changes: PullChanges;
}

export interface PushMutation {
  id: string;
  entity: string;
  op: string;
  entityId: string;
  patch?: Record<string, unknown>;
  editedAt: number;
  schemaVersion?: number;
}

export type PushStatus = "applied" | "duplicate" | "rejected" | "ignored";

export interface PushResultItem {
  id: string;
  status: PushStatus | string;
  version?: number;
  seq?: number;
  reason?: string;
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const obj = body as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.message === "string") return obj.message;
  }
  return fallback;
}

function retryDelayMs(res: Response): number {
  const raw = res.headers.get("Retry-After");
  if (raw) {
    const secs = Number(raw);
    if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
    const dateMs = Date.parse(raw);
    if (!Number.isNaN(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function throwForStatus(res: Response, body: unknown, what: string): void {
  if (res.status === 426) {
    throw new SyncUpdateRequired(errorMessage(body, "Please refresh to get the latest update."));
  }
  if (res.status === 429) {
    throw new RetryableError(res.status, retryDelayMs(res));
  }
  if (
    res.status === 409 &&
    typeof body === "object" &&
    body !== null &&
    (body as { resync?: unknown }).resync === true
  ) {
    throw new SyncResyncRequired();
  }
  if (!res.ok) {
    throw new Error(`${what} failed with status ${res.status}`);
  }
}

export async function pullPage(
  cursor: string,
  deviceId: string,
  limit = 500
): Promise<PullPageResult> {
  const url =
    `${API_BASE_URL}${SYNC_PATH}` +
    `?cursor=${encodeURIComponent(cursor)}&limit=${limit}`;
  const res = await fetch(url, {
    credentials: "include",
    headers: {
      "X-Device-Id": deviceId,
      "X-Client-Version": CLIENT_VERSION,
    },
  });
  const body: unknown = await res.json().catch(() => null);
  throwForStatus(res, body, "Sync pull");

  const b = (body ?? {}) as {
    cursor?: unknown;
    hasMore?: unknown;
    serverTime?: unknown;
    changes?: unknown;
  };
  const changes: PullChanges = {};
  if (b.changes && typeof b.changes === "object") {
    for (const [entity, rows] of Object.entries(
      b.changes as Record<string, unknown>
    )) {
      if (Array.isArray(rows)) {
        changes[entity] = rows.filter(
          (r): r is Record<string, unknown> =>
            typeof r === "object" && r !== null
        );
      }
    }
  }
  return {
    cursor: typeof b.cursor === "string" ? b.cursor : cursor,
    hasMore: b.hasMore === true,
    serverTime: typeof b.serverTime === "number" ? b.serverTime : Date.now(),
    changes,
  };
}

export async function pushBatch(
  mutations: PushMutation[],
  deviceId: string
): Promise<PushResultItem[]> {
  const res = await fetch(`${API_BASE_URL}${SYNC_PATH}/push`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-Device-Id": deviceId,
      "X-Client-Version": CLIENT_VERSION,
    },
    body: JSON.stringify({ mutations }),
  });
  const body: unknown = await res.json().catch(() => null);
  throwForStatus(res, body, "Sync push");

  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.filter(
    (r): r is PushResultItem =>
      typeof r === "object" &&
      r !== null &&
      typeof (r as { id?: unknown }).id === "string" &&
      typeof (r as { status?: unknown }).status === "string"
  );
}
