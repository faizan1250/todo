// Remote-change event bus (Phase 5 Day 4b).
//
// apply.ts (sync2) does NOT call this — wire-up comes at cutover.
// Row components subscribe via subscribeRemoteChanged and glow on match.

export interface RemoteChangedDetail {
  entity: string;
  id: string;
  deviceName: string;
}

type Listener = (detail: RemoteChangedDetail) => void;

const listeners = new Set<Listener>();

export function notifyRemoteChanged(
  entity: string,
  id: string,
  deviceName = "another device",
): void {
  const detail: RemoteChangedDetail = { entity, id, deviceName };
  for (const listener of Array.from(listeners)) {
    try {
      listener(detail);
    } catch {
      // One bad listener must not break the rest.
    }
  }
}

export function subscribeRemoteChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
