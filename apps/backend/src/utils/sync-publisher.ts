import { db } from "../db";
import * as schema from "../db/schema";

type ServerLike = { publish: (topic: string, data: string) => unknown } | null;

let server: ServerLike = null;

interface UserPublishState {
  timer: ReturnType<typeof setTimeout> | null;
  latestSeq: number;
  latestDevice: string | null;
}

const publishers = new Map<string, UserPublishState>();

export function setServer(s: any) {
  server = s ?? null;
}

export function schedulePublish(userId: string, seq: number, originDeviceId: string | null) {
  let state = publishers.get(userId);
  if (!state) {
    state = { timer: null, latestSeq: seq, latestDevice: originDeviceId };
    publishers.set(userId, state);
  } else {
    state.latestSeq = seq;
    state.latestDevice = originDeviceId;
  }

  if (state.timer) return;

  state.timer = setTimeout(() => {
    const s = publishers.get(userId);
    if (!s) return;
    s.timer = null;
    if (!server) return;
    const payload = JSON.stringify({ t: "changed", seq: s.latestSeq, device: s.latestDevice });
    try {
      server.publish(`user:${userId}`, payload);
    } catch {
      // ignore publish errors
    }
  }, 100);
}

export function flushPublish(userId?: string) {
  const flushOne = (uid: string, s: UserPublishState) => {
    if (s.timer) {
      clearTimeout(s.timer);
      s.timer = null;
    }
    if (!server) return;
    const payload = JSON.stringify({ t: "changed", seq: s.latestSeq, device: s.latestDevice });
    try {
      server.publish(`user:${uid}`, payload);
    } catch {
      // ignore
    }
    publishers.delete(uid);
  };

  if (userId) {
    const s = publishers.get(userId);
    if (s) flushOne(userId, s);
    return;
  }

  for (const [uid, s] of Array.from(publishers.entries())) {
    flushOne(uid, s);
  }
}

/**
 * Fire-and-forget realtime hint after a notification row commits.
 * Separate from the coalesced `changed` sync publish: inbox UIs listen for
 * `{ t: "notification", id }` on `user:{id}` to refresh badges/lists.
 */
export function publishNotification(userId: string, notificationId: string): void {
  if (!server) return;
  try {
    server.publish(`user:${userId}`, JSON.stringify({ t: "notification", id: notificationId }));
  } catch {
    // Notification must never break the write path.
  }
}

/**
 * Notify other devices after a REST (non-sync-push) write. Reads the
 * current global seq (bumped by DB triggers on every write) and schedules
 * a coalesced `changed` publish. Origin device is unknown here, so all
 * devices pull — the writer's extra pull is harmless.
 */
export function notifyUserChanged(userId: string): void {
  try {
    const state = db.select().from(schema.syncState).get();
    if (!state) return;
    schedulePublish(userId, state.seq, null);
  } catch {
    // Notification must never break the write path.
  }
}