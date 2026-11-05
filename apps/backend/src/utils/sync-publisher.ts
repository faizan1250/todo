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