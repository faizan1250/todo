import { Elysia, t } from "elysia";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";

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