import { Elysia } from "elysia";
export const wsRoutes = new Elysia().ws("/ws", {
  maxPayloadLength: 64 * 1024,
  idleTimeout: 60,
  sendPings: true,
  open(ws) { ws.send({ t: "pong" }); },
  message(ws, m: any) { if (m?.t === "ping") ws.send({ t: "pong" }); },
  close(ws) {},
});
