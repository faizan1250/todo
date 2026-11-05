// Sync status store (Phase 5 Day 2b).
//
// Framework-free external store for sync state, compatible with
// useSyncExternalStore(subscribe, getSnapshot). No React import here;
// the hook lives wherever the UI subscribes (Day 4).

export type SyncState =
  | "idle"
  | "pushing"
  | "pulling"
  | "offline"
  | "backoff"
  | "resyncing";

export interface SyncStatus {
  state: SyncState;
  pendingCount: number;
  lastSyncAt: number | null;
  error: string | null;
}

const INITIAL: SyncStatus = {
  state: "idle",
  pendingCount: 0,
  lastSyncAt: null,
  error: null,
};

let snapshot: SyncStatus = { ...INITIAL };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

// Stable reference while unchanged (required by useSyncExternalStore).
export function getSnapshot(): SyncStatus {
  return snapshot;
}

// Server snapshot for SSR/prerender: stable initial value. Never mutates;
// `snapshot` is always replaced, never mutated in place.
export function getServerSnapshot(): SyncStatus {
  return INITIAL;
}

export function getStatus(): SyncStatus {
  return snapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setStatus(patch: Partial<SyncStatus>): void {
  const next: SyncStatus = { ...snapshot, ...patch };
  if (
    next.state === snapshot.state &&
    next.pendingCount === snapshot.pendingCount &&
    next.lastSyncAt === snapshot.lastSyncAt &&
    next.error === snapshot.error
  ) {
    return;
  }
  snapshot = next;
  emit();
}

export function setSyncState(state: SyncState): void {
  setStatus({ state });
}

export function resetStatus(): void {
  snapshot = { ...INITIAL };
  emit();
}
