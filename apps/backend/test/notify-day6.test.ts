import { beforeEach, describe, expect, test } from "bun:test";
import { and, eq, sql } from "drizzle-orm";
import { app } from "../src/index";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { runWorkerOnce } from "../src/utils/notify-worker";
import { purgeNotificationRetention } from "../src/utils/purge";
import type { Channel, DeliveryInput, NotifyProvider, SendResult } from "../src/utils/notify-providers";
import type { Rendered } from "../src/utils/notify-render";
import { createAuthUser } from "./helpers";

const BASE = "http://localhost:3001";
const T0 = Date.parse("2026-03-12T12:00:00Z");

class FakeProvider implements NotifyProvider {
  readonly channel: Channel;
  calls = 0;
  constructor(channel: Channel) {
    this.channel = channel;
  }
  async send(_delivery: DeliveryInput, _message: Rendered): Promise<SendResult> {
    this.calls += 1;
    return { ok: true, providerId: "fake" };
  }
}

async function req(
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

async function makeUser(prefix = "NotifyDay6") {
  const auth = await createAuthUser(prefix);
  return { auth, userId: auth.user.id };
}

async function makeAdmin() {
  const u = await makeUser();
  await db.update(schema.users).set({ role: "admin" }).where(eq(schema.users.id, u.userId));
  return u;
}

async function seedDelivery(userId: string, opts: { status?: string; createdAt?: Date; channel?: "web_push" | "fcm" | "email"; updatedAt?: Date } = {}) {
  const [notification] = await db
    .insert(schema.notifications)
    .values({
      userId,
      type: "task_reminder",
      title: "Seed",
      body: "seed",
      dedupeKey: `day6:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      createdAt: opts.createdAt,
      updatedAt: opts.createdAt,
    })
    .returning();
  const channel = opts.channel ?? "email";
  let deviceId: string | null = null;
  if (channel !== "email") {
    const [device] = await db
      .insert(schema.devices)
      .values({
        userId,
        platform: "web",
        pushEnabled: true,
        pushStatus: "active",
        ...(channel === "web_push"
          ? { webPushSub: { endpoint: `https://push.example.com/d6/${Date.now()}`, keys: { p256dh: "p", auth: "a" } } }
          : { fcmToken: `fcm-d6-${Date.now()}` }),
      })
      .returning();
    deviceId = device.id;
  }
  const [delivery] = await db
    .insert(schema.notificationDeliveries)
    .values({
      notificationId: notification.id,
      userId,
      channel,
      deviceId,
      status: (opts.status as never) ?? "pending",
      createdAt: opts.createdAt,
      updatedAt: opts.updatedAt ?? opts.createdAt,
    })
    .returning();
  return { notification, delivery };
}

beforeEach(() => {
  db.delete(schema.users).where(sql`email LIKE 'notifyday6-%'`).run();
  db.delete(schema.schedulerState).where(eq(schema.schedulerState.key, "last_tick_at")).run();
});

describe("admin notifications health", () => {
  test("requires auth and admin role", async () => {
    const unauth = await req("GET", "/api/v1/admin/notifications/health");
    expect(unauth.status).toBe(401);

    const user = await makeUser();
    const forbidden = await req("GET", "/api/v1/admin/notifications/health", user.auth.token);
    expect(forbidden.status).toBe(403);

    const aliasForbidden = await req("GET", "/admin/notifications/health", user.auth.token);
    expect(aliasForbidden.status).toBe(403);
  });

  test("empty queue: shape, no age when nothing queued by this suite, tick warning when never ticked", async () => {
    const admin = await makeAdmin();
    // Baseline first: other suites may leave global rows behind; this test
    // only pins down shape + the missing-tick warning.
    const res = await req("GET", "/api/v1/admin/notifications/health", admin.auth.token);
    expect(res.status).toBe(200);
    expect(typeof res.json.queueDepth).toBe("number");
    expect(Object.keys(res.json.failuresLast24h).sort()).toEqual(["email", "fcm", "web_push"]);
    for (const c of ["web_push", "fcm", "email"]) {
      expect(typeof res.json.failuresLast24h[c]).toBe("number");
    }
    expect(res.json.lastTickAt).toBeNull();
    expect(res.json.warnings).toContain("tick_stale");
  });

  test("queue depth, per-channel failures, oldest age, fresh tick clears warnings", async () => {
    const admin = await makeAdmin();
    const other = await makeUser();
    const baseline = await req("GET", "/api/v1/admin/notifications/health", admin.auth.token);

    // Two queued (1 pending old, 1 retry recent) + failures on two channels.
    await seedDelivery(admin.userId, { status: "pending", createdAt: new Date(T0 - 10 * 60 * 1000) });
    await seedDelivery(other.userId, { status: "retry", createdAt: new Date(T0 - 60 * 1000) });
    // Failures count on updatedAt within the trailing 24h of *real* now.
    const recentMs = Date.now() - 60 * 1000;
    await seedDelivery(admin.userId, { status: "failed", channel: "email", createdAt: new Date(T0 - 3600 * 1000), updatedAt: new Date(recentMs) });
    await seedDelivery(other.userId, { status: "failed", channel: "web_push", createdAt: new Date(T0 - 3600 * 1000), updatedAt: new Date(recentMs - 1000) });
    // Stale failure (>24h) must not count.
    await seedDelivery(other.userId, { status: "failed", channel: "fcm", createdAt: new Date(T0 - 48 * 3600 * 1000), updatedAt: new Date(recentMs - 25 * 3600 * 1000) });
    // Sent delivery must not count toward depth.
    await seedDelivery(admin.userId, { status: "sent", createdAt: new Date(T0 - 1000) });

    // Fresh tick: no warnings except queue_stale (oldest pending is 10min old).
    await db.insert(schema.schedulerState).values({ key: "last_tick_at", value: String(Date.now()) });
    const res = await req("GET", "/api/v1/admin/notifications/health", admin.auth.token);
    expect(res.status).toBe(200);
    expect(res.json.queueDepth).toBe(baseline.json.queueDepth + 2);
    expect(res.json.failuresLast24h.web_push).toBe(baseline.json.failuresLast24h.web_push + 1);
    expect(res.json.failuresLast24h.email).toBe(baseline.json.failuresLast24h.email + 1);
    expect(res.json.failuresLast24h.fcm).toBe(baseline.json.failuresLast24h.fcm);
    expect(typeof res.json.oldestPendingAgeMs).toBe("number");
    expect(res.json.oldestPendingAgeMs).toBeGreaterThan(9 * 60 * 1000);
    expect(typeof res.json.lastTickAt).toBe("string");
    expect(res.json.warnings).toContain("queue_stale");
    expect(res.json.warnings).not.toContain("tick_stale");

    // Stale tick (>2min) raises tick_stale.
    await db
      .update(schema.schedulerState)
      .set({ value: String(Date.now() - 5 * 60 * 1000) })
      .where(eq(schema.schedulerState.key, "last_tick_at"));
    const stale = await req("GET", "/api/v1/admin/notifications/health", admin.auth.token);
    expect(stale.json.warnings).toContain("tick_stale");
    expect(stale.json.warnings).toContain("queue_stale");
  });

  test("alias route returns the same shape", async () => {
    const admin = await makeAdmin();
    const res = await req("GET", "/admin/notifications/health", admin.auth.token);
    expect(res.status).toBe(200);
    expect(typeof res.json.queueDepth).toBe("number");
    expect(Array.isArray(res.json.warnings)).toBe(true);
  });
});

describe("notification retention purge", () => {
  test("purges notifications >90d, deliveries >30d, digest_log >1yr; keeps recent", async () => {
    const u = await makeUser();
    const oldNotifAt = new Date(T0 - 91 * 24 * 3600 * 1000);
    const recentNotifAt = new Date(T0 - 10 * 24 * 3600 * 1000);

    const oldN = await db
      .insert(schema.notifications)
      .values({ userId: u.userId, type: "task_reminder", title: "Old", dedupeKey: `d6-old-${u.userId}`, createdAt: oldNotifAt, updatedAt: oldNotifAt })
      .returning();
    const recentN = await db
      .insert(schema.notifications)
      .values({ userId: u.userId, type: "task_reminder", title: "Recent", dedupeKey: `d6-recent-${u.userId}`, createdAt: recentNotifAt, updatedAt: recentNotifAt })
      .returning();

    // Orphan deliveries (their own 30d clock) on the recent notification.
    const oldD = new Date(T0 - 31 * 24 * 3600 * 1000);
    const recentD = new Date(T0 - 5 * 24 * 3600 * 1000);
    await db.insert(schema.notificationDeliveries).values({
      notificationId: recentN[0].id, userId: u.userId, channel: "email", status: "sent",
      createdAt: oldD, updatedAt: oldD,
    });
    await db.insert(schema.notificationDeliveries).values({
      notificationId: recentN[0].id, userId: u.userId, channel: "email", status: "sent",
      createdAt: recentD, updatedAt: recentD,
    });
    // Delivery attached to the old notification (removed via cascade).
    await db.insert(schema.notificationDeliveries).values({
      notificationId: oldN[0].id, userId: u.userId, channel: "email", status: "sent",
      createdAt: recentD, updatedAt: recentD,
    });

    await db.insert(schema.digestLog).values({
      userId: u.userId, kind: "daily", localDate: "2020-01-01", sentAt: new Date(T0 - 400 * 24 * 3600 * 1000),
    });
    await db.insert(schema.digestLog).values({
      userId: u.userId, kind: "daily", localDate: "2026-03-12", sentAt: new Date(T0 - 1000),
    });

    const out = await purgeNotificationRetention(new Date(T0));
    // Other suites / stale shared-DB rows may also be eligible; assert at
    // least ours went and verify row-level outcomes below.
    expect(out.notifications).toBeGreaterThanOrEqual(1);
    expect(out.deliveries).toBeGreaterThanOrEqual(1);
    expect(out.digestLogs).toBeGreaterThanOrEqual(1);

    const remainingNotifs = db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, u.userId))
      .all();
    expect(remainingNotifs.map((n) => n.id)).toEqual([recentN[0].id]);

    const remainingDeliveries = db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.userId, u.userId))
      .all();
    // Recent orphan + old-notification delivery is gone via cascade.
    expect(remainingDeliveries).toHaveLength(1);
    expect(remainingDeliveries[0].createdAt.getTime()).toBe(recentD.getTime());

    const remainingLogs = db
      .select()
      .from(schema.digestLog)
      .where(eq(schema.digestLog.userId, u.userId))
      .all();
    expect(remainingLogs.map((l) => l.localDate)).toEqual(["2026-03-12"]);

    // Second run is a no-op (idempotent).
    const again = await purgeNotificationRetention(new Date(T0));
    expect(again).toMatchObject({ notifications: 0, deliveries: 0, digestLogs: 0 });
  });
});

describe("worker structured logging", () => {
  test("one JSON line per delivery, ids+status only", async () => {
    const u = await makeUser();
    const [list] = await db.insert(schema.lists).values({ userId: u.userId, name: "Main", position: "a0" }).returning();
    const [task] = await db
      .insert(schema.tasks)
      .values({ userId: u.userId, listId: list.id, title: "Secret task title", position: "a0" })
      .returning();
    const [device] = await db
      .insert(schema.devices)
      .values({
        userId: u.userId,
        platform: "web",
        pushEnabled: true,
        pushStatus: "active",
        webPushSub: { endpoint: "https://push.example.com/d6-log", keys: { p256dh: "p", auth: "a" } },
      })
      .returning();
    const [notification] = await db
      .insert(schema.notifications)
      .values({
        userId: u.userId,
        type: "task_reminder",
        title: "Secret task title",
        body: "Secret body",
        entityType: "task",
        entityId: task.id,
        payload: { kind: "task_reminder", taskId: task.id },
        dedupeKey: `d6-log:${u.userId}`,
      })
      .returning();
    await db.insert(schema.notificationDeliveries).values({
      notificationId: notification.id,
      userId: u.userId,
      channel: "web_push",
      deviceId: device.id,
      status: "pending",
    });

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.map(String).join(" "));
    try {
      const stats = await runWorkerOnce(T0, { providers: { web_push: new FakeProvider("web_push") } });
      expect(stats.sent).toBeGreaterThanOrEqual(1);
    } finally {
      console.log = origLog;
    }

    const deliveryLines = lines.filter((l) => l.includes('"notify.delivery"'));
    // Other suites may leave globally-ready rows behind; ours must be among them.
    const mine = deliveryLines.map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean)
      .filter((p) => p.notificationId === notification.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      event: "notify.delivery",
      userId: u.userId,
      channel: "web_push",
      status: "sent",
    });
    expect(typeof mine[0].deliveryId).toBe("string");
    const blob = deliveryLines.join(" ");
    expect(blob).not.toContain("Secret task title");
    expect(blob).not.toContain("Secret body");
    expect(blob).not.toContain("@");
  });
});
