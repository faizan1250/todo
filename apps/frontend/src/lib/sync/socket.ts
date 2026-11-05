import { API_BASE_URL } from "../auth-client";
import { getOrCreateDeviceId } from "./device";

const HEARTBEAT_MS = 30_000;
const POLL_FALLBACK_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const FAILURE_THRESHOLD = 3;

function toWsUrl(): string {
  const base = API_BASE_URL.replace(/\/+$/, "");
  const wsBase = base.startsWith("https://")
    ? "wss://" + base.slice("https://".length)
    : base.startsWith("http://")
      ? "ws://" + base.slice("http://".length)
      : base.replace(/^http/, "ws");
  return wsBase + "/ws";
}

type SyncMessage = { t?: unknown; device?: unknown };

export function connectSyncSocket(onChanged: () => void): () => void {
  if (typeof window === "undefined" || typeof WebSocket === "undefined") {
    return () => {};
  }

  const url = toWsUrl();
  let closed = false;
  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let failures = 0;
  let backoffMs = INITIAL_BACKOFF_MS;
  let deviceId: string | null = null;

  async function ownDeviceId(): Promise<string | null> {
    if (deviceId) return deviceId;
    try {
      deviceId = await getOrCreateDeviceId();
    } catch {
      return null;
    }
    return deviceId;
  }

  function clearHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function startPollFallback() {
    if (pollTimer || closed) return;
    pollTimer = setInterval(() => {
      if (!closed) onChanged();
    }, POLL_FALLBACK_MS);
  }

  function stopPollFallback() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function scheduleReconnect() {
    if (closed) return;
    failures += 1;
    if (failures >= FAILURE_THRESHOLD) startPollFallback();
    const jittered = backoffMs * (0.75 + Math.random() * 0.5);
    backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, jittered);
  }

  function handleMessage(ev: MessageEvent) {
    let msg: SyncMessage;
    try {
      const parsed: unknown =
        typeof ev.data === "string" ? JSON.parse(ev.data) : ev.data;
      if (typeof parsed !== "object" || parsed === null) return;
      msg = parsed as SyncMessage;
    } catch {
      return;
    }
    if (msg.t === "pong") return;
    if (msg.t !== "changed") return;
    void ownDeviceId().then((own) => {
      if (closed) return;
      if (typeof msg.device === "string" && own !== null && msg.device === own) {
        return;
      }
      onChanged();
    });
  }

  function connect() {
    if (closed) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      scheduleReconnect();
      return;
    }
    ws = socket;

    socket.onopen = () => {
      if (closed || ws !== socket) {
        socket.close();
        return;
      }
      failures = 0;
      backoffMs = INITIAL_BACKOFF_MS;
      stopPollFallback();
      clearHeartbeat();
      heartbeatTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          try {
            socket.send(JSON.stringify({ t: "ping" }));
          } catch {
            // send failure surfaces via onclose/onerror -> reconnect
          }
        }
      }, HEARTBEAT_MS);
    };

    socket.onmessage = handleMessage;

    const onDown = () => {
      if (ws !== socket) return;
      ws = null;
      clearHeartbeat();
      if (!closed) scheduleReconnect();
    };
    socket.onclose = onDown;
    socket.onerror = onDown;
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    clearHeartbeat();
    stopPollFallback();
    try {
      ws?.close();
    } catch {
      // already closed
    }
    ws = null;
  };
}
