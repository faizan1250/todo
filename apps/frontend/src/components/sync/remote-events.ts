// Remote-change event bus (Phase 5 Day 4b; wired at cutover 6a).
//
// sync2/apply.ts calls notifyRemoteChanged for pulled rows that are new
// locally or differ from the server version (no unsent edits). Row
// components subscribe via subscribeRemoteChanged and glow on match; list
// views subscribe to refresh from Dexie (new rows have no rendered row to
// glow, so without a refresh they would never appear).

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

// History-sheet requests (Phase 5 Day 5a). toastConflict's "See what's new"
// callback fires requestHistorySheet(entityId); the Day-6 cutover parent
// subscribes and renders HistorySheet. Decoupled on purpose: no imports
// between the toast layer and the sheet.

export interface HistoryRequestDetail {
  entityId: string;
}

type HistoryRequestListener = (detail: HistoryRequestDetail) => void;

const historyRequestListeners = new Set<HistoryRequestListener>();

export function requestHistorySheet(entityId: string): void {
  const detail: HistoryRequestDetail = { entityId };
  for (const listener of Array.from(historyRequestListeners)) {
    try {
      listener(detail);
    } catch {
      // One bad listener must not break the rest.
    }
  }
}

export function subscribeHistoryRequest(
  listener: HistoryRequestListener
): () => void {
  historyRequestListeners.add(listener);
  return () => {
    historyRequestListeners.delete(listener);
  };
}
