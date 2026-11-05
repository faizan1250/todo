// Realtime WS client (Phase 5 Day 3, sync2 engine).
//
// Cookie-auth web socket to `<wsBase>/ws`. The server publishes
// `{ t: "changed", device, seq }` whenever another device writes; messages
// from our own deviceId are ignored. Anything else (connect, reconnect,
// poll fallback, visibility return) funnels into `onChanged`, which the
// hook maps to a leader-guarded `runSync`.
//
// Resilience, in order of escalation:
//   1. heartbeat: ping every 25s, close + reconnect if no pong within 10s.
//   2. reconnect backoff 1s -> 30s with jitter, pull after every reconnect.
//   3. after 3 consecutive failures, 30s poll fallback until the socket
//      recovers (covers proxies that silently kill idle sockets).
//   4. tab hidden > 60s: close the socket, reopen + pull on visible.
//
// SSR-safe: returns a no-op disconnect outside the browser. Never throws.

import { API_BASE_URL } from "../auth-client";

export interface ConnectRealtimeOptions {
  userId: string;
  deviceId: string;
  onChanged: () => void;
}

export const REALTIME_PING_MS = 25_000;
export const REALTIME_PONG_TIMEOUT_MS = 10_000;
export const REALTIME_HIDDEN_CLOSE_MS = 60_000;
export const REALTIME_POLL_FALLBACK_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const FAILURE_THRESHOLD = 3;

export function toWsUrl(base: string = API_BASE_URL): string {
  const trimmed = base.replace(/\/+$/, "");
  const wsBase = trimmed.startsWith("https://")
    ? `wss://${trimmed.slice("https://".length)}`
    : trimmed.startsWith("http://")
      ? `ws://${trimmed.slice("http://".length)}`
      : trimmed.replace(/^http/, "ws");
  return `${wsBase}/ws`;
}

type ServerMessage = {
  t?: unknown;
  device?: unknown;
};

export function connectRealtime({
  deviceId,
  onChanged,
}: ConnectRealtimeOptions): () => void {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") {
    return () => {};
  }

  const url = toWsUrl();
  let closed = false;
  let suspended = false;
  let ws: WebSocket | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;
  let pongTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let backoffMs = INITIAL_BACKOFF_MS;
  let everConnected = false;
  let lastPingAt = 0;
  let lastPongAt = 0;

  function clearPing(): void {
    if (pingTimer !== null) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (pongTimer !== null) {
      clearTimeout(pongTimer);
      pongTimer = null;
    }
  }

  function startPollFallback(): void {
    if (pollTimer !== null || closed) return;
    pollTimer = setInterval(() => {
      if (!closed) onChanged();
    }, REALTIME_POLL_FALLBACK_MS);
  }

  function stopPollFallback(): void {
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function scheduleReconnect(): void {
    if (closed || suspended) return;
    failures += 1;
    if (failures >= FAILURE_THRESHOLD) startPollFallback();
    const delay = backoffMs * (0.75 + Math.random() * 0.5);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function handleMessage(ev: MessageEvent): void {
    let msg: ServerMessage;
    try {
      const parsed: unknown =
        typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      if (typeof parsed !== "object" || parsed === null) return;
      msg = parsed as ServerMessage;
    } catch {
      return;
    }
    if (msg.t === "pong") {
      lastPongAt = Date.now();
      return;
    }
    if (msg.t !== "changed") return;
    if (typeof msg.device === "string" && msg.device === deviceId) return;
    onChanged();
  }

  function connect(): void {
    if (closed || suspended) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      if (closed || suspended || ws !== socket) {
        socket.close();
        return;
      }
      const reconnected = everConnected;
      everConnected = true;
      failures = 0;
      backoffMs = INITIAL_BACKOFF_MS;
      stopPollFallback();
      clearPing();
      pingTimer = setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        try {
          socket.send(JSON.stringify({ t: "ping" }));
        } catch {
          return;
        }
        lastPingAt = Date.now();
        if (pongTimer !== null) clearTimeout(pongTimer);
        pongTimer = setTimeout(() => {
          pongTimer = null;
          // No pong since this ping: drop the dead socket so the
          // close handler schedules a reconnect.
          if (
            socket.readyState === WebSocket.OPEN &&
            lastPongAt < lastPingAt
          ) {
            try {
              socket.close();
            } catch {
              // onclose/onerror drives the reconnect.
            }
          }
        }, REALTIME_PONG_TIMEOUT_MS);
      }, REALTIME_PING_MS);
      if (reconnected) onChanged();
    };

    socket.onmessage = handleMessage;

    const onDown = (): void => {
      if (ws !== socket) return;
      ws = null;
      clearPing();
      if (!closed && !suspended) scheduleReconnect();
    };
    socket.onclose = onDown;
    socket.onerror = onDown;
  }

  function suspendForHidden(): void {
    suspended = true;
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    clearPing();
    try {
      ws?.close();
    } catch {
      // Already closed; onDown is guarded by the suspended flag.
    }
    ws = null;
  }

  function onVisibility(): void {
    if (document.visibilityState === "visible") {
      if (hiddenTimer !== null) {
        clearTimeout(hiddenTimer);
        hiddenTimer = null;
      }
      if (suspended) {
        suspended = false;
        connect();
        onChanged();
      }
      return;
    }
    if (hiddenTimer !== null) return;
    hiddenTimer = setTimeout(() => {
      hiddenTimer = null;
      if (document.visibilityState === "hidden" && !closed) {
        suspendForHidden();
      }
    }, REALTIME_HIDDEN_CLOSE_MS);
  }

  document.addEventListener("visibilitychange", onVisibility);

  connect();

  return () => {
    closed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    if (hiddenTimer !== null) clearTimeout(hiddenTimer);
    clearPing();
    stopPollFallback();
    try {
      ws?.close();
    } catch {
      // Already closed.
    }
    ws = null;
  };
}
