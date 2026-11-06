import { Elysia, t } from "elysia";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { now } from "../utils/notify-clock";

async function listDevicesForUser(userId: string) {
  const devices = await db
    .select()
    .from(schema.devices)
    .where(eq(schema.devices.userId, userId));

  const pendingCounts: Record<string, number> = {};
  const allCounts: Record<string, number> = {};
  for (const d of devices) {
    const pendingRow = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.processedMutations)
      .where(
        and(
          eq(schema.processedMutations.userId, userId),
          eq(schema.processedMutations.deviceId, d.id),
          sql`${schema.processedMutations.status} IN ('pending', 'queued')`
        )
      )
      .get();
    pendingCounts[d.id] = Number(pendingRow?.c ?? 0);

    const allRow = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.processedMutations)
      .where(
        and(
          eq(schema.processedMutations.userId, userId),
          eq(schema.processedMutations.deviceId, d.id)
        )
      )
      .get();
    allCounts[d.id] = Number(allRow?.c ?? 0);
  }

  return devices.map((d) => {
    const clientVersion = (d as any).clientVersion ?? null;
    const pending = pendingCounts[d.id] ?? 0;
    return {
      id: d.id,
      userId: d.userId,
      name: d.name,
      platform: d.platform,
      lastSeenAt: d.lastSeenAt,
      lastSyncSeq: d.lastSyncSeq ?? null,
      lastSyncAt: d.lastSyncAt ?? null,
      pendingMutationCount: pending,
      pendingMutations: pending,
      processedMutationCount: allCounts[d.id] ?? 0,
      clientVersion,
      client_version: clientVersion,
    };
  });
}

export const adminRoutes = new Elysia({ name: "routes-admin" })
  .use(authMacro)
  .get(
    "/admin/sync",
    async ({ user, query, status }) => {
      if (user.role !== "admin") {
        return status(403, { error: "Forbidden" });
      }
      const targetUserId = (query?.userId as string) || user.id;
      return await listDevicesForUser(targetUserId);
    },
    {
      auth: true,
      query: t.Object({
        userId: t.Optional(t.String()),
      }),
    }
  )
  .get(
    "/api/v1/admin/sync",
    async ({ user, query, status }) => {
      if (user.role !== "admin") {
        return status(403, { error: "Forbidden" });
      }
      const targetUserId = (query?.userId as string) || user.id;
      return await listDevicesForUser(targetUserId);
    },
    {
      auth: true,
      query: t.Object({
        userId: t.Optional(t.String()),
      }),
    }
  );

/** Queue considered stale when the oldest pending delivery waits this long. */
export const HEALTH_QUEUE_STALE_MS = 5 * 60 * 1000;
/** Scheduler tick considered stale when last_tick_at is this old (or missing). */
export const HEALTH_TICK_STALE_MS = 2 * 60 * 1000;
export const HEALTH_FAILURE_WINDOW_MS = 24 * 3600 * 1000;

const QUEUED_STATUSES = ["pending", "retry"] as const;

export interface NotificationsHealth {
  queueDepth: number;
  failuresLast24h: Record<string, number>;
  oldestPendingAgeMs: number | null;
  lastTickAt: string | null;
  warnings: string[];
}

export function getNotificationsHealth(nowMs: number = now()): NotificationsHealth {
  const queueRow = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.notificationDeliveries)
    .where(inArray(schema.notificationDeliveries.status, [...QUEUED_STATUSES]))
    .get();
  const queueDepth = Number(queueRow?.c ?? 0);

  const cutoffMs = nowMs - HEALTH_FAILURE_WINDOW_MS;
  const failures = db
    .select({
      channel: schema.notificationDeliveries.channel,
      c: sql<number>`count(*)`,
    })
    .from(schema.notificationDeliveries)
    .where(
      and(
        eq(schema.notificationDeliveries.status, "failed"),
        sql`${schema.notificationDeliveries.updatedAt} >= ${cutoffMs}`
      )
    )
    .groupBy(schema.notificationDeliveries.channel)
    .all();
  const failuresLast24h: Record<string, number> = {
    web_push: 0,
    fcm: 0,
    email: 0,
  };
  for (const f of failures) {
    failuresLast24h[f.channel] = Number(f.c ?? 0);
  }

  const oldest = db
    .select({ createdAt: schema.notificationDeliveries.createdAt })
    .from(schema.notificationDeliveries)
    .where(inArray(schema.notificationDeliveries.status, [...QUEUED_STATUSES]))
    .orderBy(sql`${schema.notificationDeliveries.createdAt} ASC`)
    .limit(1)
    .get();
  const oldestPendingAgeMs = oldest ? Math.max(0, nowMs - oldest.createdAt.getTime()) : null;

  const tick = db
    .select({ value: schema.schedulerState.value })
    .from(schema.schedulerState)
    .where(eq(schema.schedulerState.key, "last_tick_at"))
    .get();
  const tickMs = tick?.value ? Number(tick.value) : NaN;
  const lastTickAt =
    tick?.value && Number.isFinite(tickMs) ? new Date(tickMs).toISOString() : null;

  const warnings: string[] = [];
  if (oldestPendingAgeMs !== null && oldestPendingAgeMs > HEALTH_QUEUE_STALE_MS) {
    warnings.push("queue_stale");
  }
  if (lastTickAt === null || nowMs - tickMs > HEALTH_TICK_STALE_MS) {
    warnings.push("tick_stale");
  }

  return { queueDepth, failuresLast24h, oldestPendingAgeMs, lastTickAt, warnings };
}

export const notificationsHealthRoutes = new Elysia({ name: "routes-admin-notify-health" })
  .use(authMacro)
  .get("/api/v1/admin/notifications/health", async ({ user, status }) => {
    if (user.role !== "admin") {
      return status(403, { error: "Forbidden" });
    }
    return getNotificationsHealth();
  }, { auth: true })
  .get("/admin/notifications/health", async ({ user, status }) => {
    if (user.role !== "admin") {
      return status(403, { error: "Forbidden" });
    }
    return getNotificationsHealth();
  }, { auth: true });