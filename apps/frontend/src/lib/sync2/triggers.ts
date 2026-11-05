// Sync triggers (Phase 5 Day 2b).
//
// Event wiring around a caller-supplied runner (no import cycle: the
// runner, typically leader-guarded runSync, is injected as a param).
// Timers live here, never in the engine: scheduleSync debounce, 60s
// interval, and backoff retries scheduled from RunSyncResult.

import type { RunSyncResult } from "./engine";

export type SyncRunner = (
  userId: string,
  deviceId: string
) => Promise<RunSyncResult>;

export interface WireSyncCallbacks {
  onResult?: (result: RunSyncResult) => void;
  onError?: (error: unknown) => void;
}

export const LOCAL_WRITE_EVENT = "todo:local-write";
export const SYNC_INTERVAL_MS = 60_000;
export const LOCAL_WRITE_DEBOUNCE_MS = 300;

let scheduled: ReturnType<typeof setTimeout> | null = null;

export function scheduleSync(run: () => void, delayMs = 300): void {
  cancelScheduled();
  scheduled = setTimeout(() => {
    scheduled = null;
    run();
  }, delayMs);
}

export function cancelScheduled(): void {
  if (scheduled !== null) {
    clearTimeout(scheduled);
    scheduled = null;
  }
}

export function wireSyncTriggers(
  userId: string,
  deviceId: string,
  run: SyncRunner,
  callbacks?: WireSyncCallbacks
): () => void {
  if (typeof window === "undefined") return () => {};
  let stopped = false;

  const invoke = (): void => {
    if (stopped) return;
    run(userId, deviceId).then(
      (result) => {
        if (stopped) return;
        if (result.status === "backoff" && result.retryDelayMs != null) {
          scheduleSync(invoke, result.retryDelayMs);
        }
        callbacks?.onResult?.(result);
      },
      (error) => {
        if (!stopped) callbacks?.onError?.(error);
      }
    );
  };
  const invokeSoon = (): void => {
    scheduleSync(invoke, LOCAL_WRITE_DEBOUNCE_MS);
  };
  const onOnline = (): void => {
    invoke();
  };
  const onVisibility = (): void => {
    if (document.visibilityState === "visible") invoke();
  };
  const onLocalWrite = (): void => {
    invokeSoon();
  };

  window.addEventListener("online", onOnline);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener(LOCAL_WRITE_EVENT, onLocalWrite);
  const interval = setInterval(invoke, SYNC_INTERVAL_MS);

  return () => {
    stopped = true;
    window.removeEventListener("online", onOnline);
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener(LOCAL_WRITE_EVENT, onLocalWrite);
    clearInterval(interval);
    cancelScheduled();
  };
}
