import { Elysia } from "elysia";
export const wsRoutes = new Elysia().ws("/ws", {
  maxPayloadLength: 64 * 1024,
  idleTimeout: 60,
  sendPings: true,
  beforeHandle({ request, set }) {
    const origin = request.headers.get("origin");
    const allowed = (process.env.ALLOWED_ORIGINS || "http://localhost:3000").split(",");
    if (origin && !allowed.includes(origin)) { set.status = 403; return { error: "forbidden origin" }; }
  },
  open(ws) { ws.send({ t: "pong" }); },
  message(ws, m: any) { if (m?.t === "ping") ws.send({ t: "pong" }); },
  close(ws) {},
});
