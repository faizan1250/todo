import { Elysia } from "elysia";
import { auth } from "../auth";
import { db } from "../db";
import * as schema from "../db/schema";
import { eq } from "drizzle-orm";

export const userConnections = new Map<string, Set<any>>();

export const wsRoutes = new Elysia().ws("/ws", {
  maxPayloadLength: 64 * 1024,
  idleTimeout: 60,
  sendPings: true,
  beforeHandle({ request, set }) {
    const origin = request.headers.get("origin");
    const allowed = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",");
    if (origin && !allowed.includes(origin)) { set.status = 403; return { error: "forbidden origin" }; }
  },
  open(ws) {
    const w = ws as any;
    (async () => {
      try {
        const sessionData = await auth.api.getSession({ headers: w.data?.headers ?? w.data?.request?.headers });
        const userId = sessionData?.user?.id;
        if (userId) {
          w.data.userId = userId;
          let set = userConnections.get(userId);
          if (!set) { set = new Set(); userConnections.set(userId, set); }
          if (set.size >= 5) { ws.close(); return; }
          set.add(ws);
          ws.subscribe(`user:${userId}`);
          return;
        }
      } catch {
        // fall through to unauthenticated handling
      }
      w.data.userId = null;
      setTimeout(() => {
        if (!w.data?.userId) ws.close();
      }, 5000);
    })();
  },
  message(ws, m: any) {
    const w = ws as any;
    if (m?.t === "ping") { ws.send({ t: "pong" }); return; }
    if (m?.t === "auth" && !w.data?.userId) {
      (async () => {
        try {
          const token = m?.token;
          const [session] = await db
            .select()
            .from(schema.sessions)
            .where(eq(schema.sessions.token, token));
          if (session && (!session.expiresAt || new Date(session.expiresAt).getTime() > Date.now())) {
            const userId = session.userId;
            w.data.userId = userId;
            let set = userConnections.get(userId);
            if (!set) { set = new Set(); userConnections.set(userId, set); }
            if (set.size >= 5) { ws.close(); return; }
            set.add(ws);
            ws.subscribe(`user:${userId}`);
            return;
          }
        } catch {
          // fall through to close
        }
        ws.close();
      })();
    }
  },
  close(ws) {
    const w = ws as any;
    const userId = w.data?.userId;
    if (userId) {
      const set = userConnections.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) userConnections.delete(userId);
      }
      ws.unsubscribe(`user:${userId}`);
    }
  },
});