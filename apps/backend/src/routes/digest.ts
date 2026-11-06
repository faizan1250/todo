import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { ensurePrefs } from "./notification-prefs";
import {
  buildDailyDigest,
  buildWeeklyDigest,
  digestLocal,
  enqueueDigest,
  type BuiltDigest,
  type DigestKind,
} from "../utils/notify-digest";

const Kind = t.Union([t.Literal("daily"), t.Literal("weekly")]);

function toDTO(c: BuiltDigest) {
  return { type: c.type, title: c.title, body: c.body, url: c.url, payload: c.payload };
}

async function loadCtx(userId: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user) return null;
  const prefs = await ensurePrefs(userId);
  return { user, prefs, tz: user.timezone || "UTC" };
}

export const digestRoutes = new Elysia({ name: "routes-digest" })
  .use(authMacro)
  // Render today's (or this week's) digest for the caller without sending
  // anything: no digest_log claim, no notification row.
  .get(
    "/api/v1/digest/preview",
    async ({ user, query, status }) => {
      const kind: DigestKind = query.kind ?? "daily";
      const ctx = await loadCtx(user.id);
      if (!ctx) return status(404, { error: "User not found" });
      const nowMs = Date.now();
      const local = digestLocal(nowMs, ctx.tz);
      const enabled = kind === "daily" ? ctx.prefs.digestDailyEnabled : ctx.prefs.weeklyEnabled;
      const scheduledFor = kind === "daily" ? ctx.prefs.digestTime : ctx.prefs.weeklyTime;
      const content =
        kind === "daily"
          ? await buildDailyDigest(user.id, ctx.tz, nowMs)
          : await buildWeeklyDigest(user.id, ctx.tz, nowMs, ctx.user.weekStartsOn ?? 1);
      return {
        kind,
        localDate: local.localDate,
        timezone: ctx.tz,
        scheduledFor,
        enabled,
        empty: content === null,
        digest: content ? toDTO(content) : null,
      };
    },
    { auth: true, query: t.Object({ kind: t.Optional(Kind) }) }
  )
  // Send the current digest to the caller only. Never touches digest_log,
  // so it can't consume (or duplicate) the scheduled send.
  .post(
    "/api/v1/digest/send-test",
    async ({ user, body, status }) => {
      const kind: DigestKind = body.kind ?? "daily";
      const ctx = await loadCtx(user.id);
      if (!ctx) return status(404, { error: "User not found" });
      const nowMs = Date.now();
      const content =
        kind === "daily"
          ? await buildDailyDigest(user.id, ctx.tz, nowMs)
          : await buildWeeklyDigest(user.id, ctx.tz, nowMs, ctx.user.weekStartsOn ?? 1);
      if (!content) {
        return { sent: false as const, reason: "empty", kind, localDate: digestLocal(nowMs, ctx.tz).localDate };
      }
      const notificationId = enqueueDigest(ctx.user, ctx.prefs, content, nowMs);
      if (!notificationId) {
        return { sent: false as const, reason: "suppressed", kind, localDate: content.localDate };
      }
      return { sent: true as const, kind, notificationId, title: content.title };
    },
    { auth: true, body: t.Object({ kind: t.Optional(Kind) }) }
  );
