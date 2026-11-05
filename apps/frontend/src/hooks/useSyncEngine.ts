"use client";

// Sync engine hook (Phase 5 Day 3).
//
// Owns the whole sync2 lifecycle for one signed-in user:
//   - per-user deviceId (read/create in per-user meta, uuidv7)
//   - best-effort POST /api/v1/sync/devices registration (never blocks sync)
//   - leader-guarded runSync: Web Locks `ifAvailable` so only the lock
//     holder syncs; contended tabs skip silently instead of queueing.
//   - triggers (60s interval, online/visible, local-write debounce)
//   - realtime socket, mounted after the first successful sync
//   - status store passthrough for the UI
//
// userId null -> inert (no DB, no socket, no timers).

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { v7 as uuidv7 } from "uuid";
import { API_BASE_URL } from "@/lib/auth-client";
import { getDB } from "@/lib/db/schema";
import { runSync, type RunSyncResult } from "@/lib/sync2/engine";
import { SYNC_LEADER_LOCK } from "@/lib/sync2/leader";
import { connectRealtime } from "@/lib/sync2/realtime";
import { wireSyncTriggers } from "@/lib/sync2/triggers";
import {
  getServerSnapshot,
  getSnapshot,
  subscribe,
  type SyncStatus,
} from "@/lib/sync2/status";

export interface UseSyncEngineReturn extends SyncStatus {
  syncNow: () => void;
}

const DEVICE_META_KEY = "deviceId";
const SKIPPED: RunSyncResult = { status: "ok" };

async function getOrCreateDeviceId(userId: string): Promise<string> {
  const db = getDB(userId);
  const row = await db.meta.get(DEVICE_META_KEY);
  if (typeof row?.value === "string" && row.value.length > 0) {
    return row.value;
  }
  const id = uuidv7();
  await db.meta.put({ key: DEVICE_META_KEY, value: id });
  return id;
}

interface UserAgentDataLike {
  platform?: string;
  brands?: Array<{ brand?: string }>;
}

function friendlyDeviceName(): string {
  if (typeof navigator === "undefined") return "Web browser";
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
    .userAgentData;
  const platform = uaData?.platform;
  const brands = uaData?.brands ?? [];
  const browser =
    brands.find(
      (b) =>
        typeof b.brand === "string" &&
        b.brand.length > 0 &&
        !/not/i.test(b.brand) &&
        b.brand !== "Chromium"
    )?.brand ??
    brands.find(
      (b) => typeof b.brand === "string" && !/not/i.test(b.brand)
    )?.brand;
  if (browser && platform) return `${browser} on ${platform}`.slice(0, 64);
  return (platform ?? browser ?? "Web browser").slice(0, 64);
}

// Best-effort device registration for device labels. Never throws, never
// blocks sync: a missing/failed registration only affects list displays.
async function registerDevice(deviceId: string): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/v1/sync/devices`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deviceId,
        name: friendlyDeviceName(),
        platform: "web",
      }),
    });
  } catch {
    // Offline or backend hiccup: sync proceeds unregistered.
  }
}

// Only the tab holding the lock runs the engine. `ifAvailable` resolves
// without invoking the callback when another tab holds it, so contenders
// skip instead of piling up behind the leader. No Web Locks -> run direct.
async function runAsLeaderIfAvailable(
  userId: string,
  deviceId: string
): Promise<RunSyncResult> {
  if (typeof navigator === "undefined" || !navigator.locks?.request) {
    return runSync(userId, deviceId);
  }
  try {
    const result: RunSyncResult | undefined = await navigator.locks.request(
      SYNC_LEADER_LOCK,
      { ifAvailable: true },
      () => runSync(userId, deviceId)
    );
    // Lock held elsewhere: callback never ran. Report a no-op.
    if (result == null) return SKIPPED;
    return result;
  } catch {
    // Locks API rejected the request shape itself: run direct.
    return runSync(userId, deviceId);
  }
}

export function useSyncEngine(userId: string | null): UseSyncEngineReturn {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const runnerRef = useRef<() => Promise<RunSyncResult>>(async () => SKIPPED);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let disposeTriggers: (() => void) | null = null;
    let disconnectRealtime: (() => void) | null = null;
    let currentDeviceId = "";

    const guarded = (): Promise<RunSyncResult> => {
      if (!currentDeviceId) return Promise.resolve(SKIPPED);
      return runAsLeaderIfAvailable(userId, currentDeviceId);
    };
    runnerRef.current = () => guarded();

    const ensureSocket = (): void => {
      if (disconnectRealtime || cancelled || !currentDeviceId) return;
      disconnectRealtime = connectRealtime({
        userId,
        deviceId: currentDeviceId,
        onChanged: () => {
          void guarded();
        },
      });
    };

    (async () => {
      try {
        currentDeviceId = await getOrCreateDeviceId(userId);
      } catch {
        return;
      }
      if (cancelled) return;
      void registerDevice(currentDeviceId);
      disposeTriggers = wireSyncTriggers(userId, currentDeviceId, guarded, {
        onResult: (result) => {
          if (result.status === "ok") ensureSocket();
        },
      });
      try {
        const result = await guarded();
        if (!cancelled && result.status === "ok") ensureSocket();
      } catch {
        // runSync maps failures to results; locks fallback runs direct.
      }
    })();

    return () => {
      cancelled = true;
      runnerRef.current = async () => SKIPPED;
      disconnectRealtime?.();
      disconnectRealtime = null;
      disposeTriggers?.();
      disposeTriggers = null;
    };
  }, [userId]);

  const syncNow = useCallback(() => {
    void runnerRef.current().catch(() => {});
  }, []);

  return { ...status, syncNow };
}
