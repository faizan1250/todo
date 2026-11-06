import { createHash } from "node:crypto";
import { Elysia, t } from "elysia";
import { and, eq, ne } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { getNotifyConfig } from "../utils/notify-config";
import { now } from "../utils/notify-clock";
import { runWorkerOnce } from "../utils/notify-worker";

const WebPushSubscription = t.Object({
  endpoint: t.String({ minLength: 1 }),
  keys: t.Object({
    p256dh: t.String({ minLength: 1 }),
    auth: t.String({ minLength: 1 }),
  }),
});

function hashCredential(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function toDeviceDTO(d: typeof schema.devices.$inferSelect) {
  return {
    id: d.id,
    pushEnabled: d.pushEnabled,
    pushStatus: d.pushStatus,
    pushFailures: d.pushFailures,
    lastPushAt: d.lastPushAt ? d.lastPushAt.getTime() : null,
    hasWebPush: d.webPushSub != null,
    hasFcmToken: d.fcmToken != null,
  };
}

export const pushRoutes = new Elysia({ name: "routes-push" })
  .use(authMacro)
  .get("/api/v1/push/public-key", async () => {
    const cfg = getNotifyConfig();
    return { publicKey: cfg.webPush?.publicKey ?? null };
  })
  .put(
    "/api/v1/devices/:id/push",
    async ({ user, params: { id }, body, status }) => {
      const [device] = await db
        .select()
        .from(schema.devices)
        .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, user.id)));
      if (!device) {
        return status(404, { error: "Device not found" });
      }

      const hasSub = body.subscription !== undefined && body.subscription !== null;
      const hasFcm = body.fcmToken !== undefined && body.fcmToken !== null;
      if (hasSub === hasFcm) {
        return status(400, { error: "Provide exactly one of subscription or fcmToken" });
      }

      const identity = hasSub
        ? hashCredential(body.subscription!.endpoint)
        : hashCredential(`fcm:${body.fcmToken!}`);

      // Endpoint-move: the same push credential must belong to exactly one device.
      // If it lives on another row (another user, or a stale row of this user),
      // detach it there before attaching here.
      const others = await db
        .select({ id: schema.devices.id, userId: schema.devices.userId })
        .from(schema.devices)
        .where(and(eq(schema.devices.pushEndpointHash, identity), ne(schema.devices.id, id)));
      for (const other of others) {
        await db
          .update(schema.devices)
          .set({
            webPushSub: null,
            fcmToken: null,
            pushEndpointHash: null,
            pushStatus: "disabled",
            pushEnabled: false,
          })
          .where(eq(schema.devices.id, other.id));
      }

      const patch: Partial<typeof schema.devices.$inferInsert> = {
        pushEndpointHash: identity,
        pushEnabled: true,
        pushStatus: "active",
        pushFailures: 0,
      };
      if (hasSub) {
        patch.webPushSub = {
          endpoint: body.subscription!.endpoint,
          keys: {
            p256dh: body.subscription!.keys.p256dh,
            auth: body.subscription!.keys.auth,
          },
        };
        patch.fcmToken = null;
      } else {
        patch.fcmToken = body.fcmToken!;
        patch.webPushSub = null;
      }

      await db
        .update(schema.devices)
        .set(patch)
        .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, user.id)));

      const [updated] = await db
        .select()
        .from(schema.devices)
        .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, user.id)));
      if (!updated) {
        return status(404, { error: "Device not found" });
      }
      return toDeviceDTO(updated);
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({
        subscription: t.Optional(WebPushSubscription),
        fcmToken: t.Optional(t.String({ minLength: 1 })),
      }),
    }
  )
  .delete("/api/v1/devices/:id/push", async ({ user, params: { id }, status }) => {
    const [device] = await db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, user.id)));
    if (!device) {
      return status(404, { error: "Device not found" });
    }
    await db
      .update(schema.devices)
      .set({
        webPushSub: null,
        fcmToken: null,
        pushEndpointHash: null,
        pushEnabled: false,
        pushStatus: "disabled",
        pushFailures: 0,
      })
      .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, user.id)));
    return { ok: true };
  }, { auth: true, params: t.Object({ id: t.String() }) })
  .post("/api/v1/devices/:id/push/test", async ({ user, params: { id }, status }) => {
    const [device] = await db
      .select()
      .from(schema.devices)
      .where(and(eq(schema.devices.id, id), eq(schema.devices.userId, user.id)));
    if (!device) {
      return status(404, { error: "Device not found" });
    }
    if (!device.webPushSub && !device.fcmToken) {
      return status(400, { error: "No push subscription on this device" });
    }
    const channel = device.webPushSub ? "web_push" : "fcm";
    // Real send through the worker path: enqueue a test notification, run
    // the worker once, and return the resulting delivery status.
    const nowMs = now();
    const at = new Date(nowMs);
    const [notif] = await db
      .insert(schema.notifications)
      .values({
        userId: user.id,
        type: "test",
        title: "Test notification",
        body: "Push registration works.",
        url: null,
        entityType: "device",
        entityId: device.id,
        payload: { kind: "test_push", deviceId: device.id },
        priority: "normal",
        dedupeKey: `test:${device.id}:${nowMs}`,
        createdAt: at,
        updatedAt: at,
      })
      .returning();
    await db.insert(schema.notificationDeliveries).values({
      notificationId: notif.id,
      userId: user.id,
      channel,
      deviceId: device.id,
      status: "pending",
      notBefore: null,
      createdAt: at,
      updatedAt: at,
    });
    // A scheduler-tick worker may be in flight; wait for an owned run.
    for (let i = 0; i < 50; i++) {
      const run = await runWorkerOnce();
      if (run.ran) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const [delivery] = await db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.notificationId, notif.id));
    if (!delivery) {
      return status(500, { error: "Test delivery was not created" });
    }
    return {
      sent: delivery.status === "sent",
      channel,
      status: delivery.status,
      errorCode: delivery.errorCode,
    };
  }, { auth: true, params: t.Object({ id: t.String() }) });
