// Tab leader election via Web Locks (Phase 5 Day 2b).
//
// Only the tab holding the "sync-leader" lock runs the engine; lock
// takeover on tab close is inherent to Web Locks (~instant). Where Web
// Locks are unavailable (older Safari), fall back to running directly.

export const SYNC_LEADER_LOCK = "sync-leader";

interface LocksLike {
  request<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

function locks(): LocksLike | null {
  if (typeof navigator === "undefined") return null;
  const l = (navigator as unknown as { locks?: LocksLike }).locks;
  return typeof l?.request === "function" ? l : null;
}

export function isLeaderSupported(): boolean {
  return locks() !== null;
}

export async function runAsLeader<T>(fn: () => Promise<T>): Promise<T> {
  const l = locks();
  if (!l) return fn();
  return l.request(SYNC_LEADER_LOCK, fn);
}
