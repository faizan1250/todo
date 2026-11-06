import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { app } from "../src/index";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import {
  BACKOFF_MS,
  cancelPendingDeliveries,
  runWorkerOnce,
  topicFor,
} from "../src/utils/notify-worker";
import {
  FcmProvider,
  parseRetryAfterMs,
  type Channel,
  type DeliveryInput,
  type NotifyProvider,
  type SendResult,
} from "../src/utils/notify-providers";
import type { Rendered } from "../src/utils/notify-render";
import { createAuthUser } from "./helpers";

const BASE = "http://localhost:3001";
const T0 = Date.parse("2026-03-10T12:00:00Z");

class FakeProvider implements NotifyProvider {
  readonly channel: Channel;
  calls: Array<{ delivery: DeliveryInput; message: Rendered }> = [];
  constructor(
    channel: Channel,
    private behavior: (d: DeliveryInput) => SendResult
  ) {
    this.channel = channel;
  }
  async send(delivery: DeliveryInput, message: Rendered): Promise<SendResult> {
    this.calls.push({ delivery, message });
    return this.behavior(delivery);
  }
}

const okResult = (): SendResult => ({ ok: true, providerId: "fake" });
const retryableResult = (extra: Partial<Extract<SendResult, { ok: false }>> = {}): SendResult => ({
  ok: false,
  errorCode: "boom",
  retryable: true,
  ...extra,
});

async function req(method: string, path: string, token: string, body?: unknown) {
  const res = await app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

async function makeSetup(opts: {
  channel?: "web_push" | "fcm";
  taskStatus?: "todo" | "done";
  deliveryStatus?: "pending" | "retry" | "sending";
  leaseUntilMs?: number | null;
  attempts?: number;
  nextAttemptMs?: number | null;
  notBeforeMs?: number | null;
  priority?: "normal" | "high";
  type?: string;
  payload?: Record<string, unknown>;
} = {}) {
  const auth = await createAuthUser("NotifyDay3");
  const userId = auth.user.id;
  const [list] = await db
    .insert(schema.lists)
    .values({ userId, name: "Main", position: "a0" })
    .returning();
  const [task] = await db
    .insert(schema.tasks)
    .values({
      userId,
      listId: list.id,
      title: "Water the plants",
      position: "a0",
      status: opts.taskStatus ?? "todo",
    })
    .returning();
  const channel = opts.channel ?? "web_push";
  const [device] = await db
    .insert(schema.devices)
    .values({
      userId,
      platform: "web",
      pushEnabled: true,
      pushStatus: "active",
      ...(channel === "web_push"
        ? { webPushSub: { endpoint: `https://push.example.com/sub/${deviceSuffix()}`, keys: { p256dh: "p", auth: "a" } } }
        : { fcmToken: `fcm-${deviceSuffix()}` }),
    })
    .returning();
  const [notification] = await db
    .insert(schema.notifications)
    .values({
      userId,
      type: opts.type ?? "task_reminder",
      title: "Water the plants",
      body: "Due now",
      url: `/tasks/${task.id}`,
      entityType: "task",
      entityId: task.id,
      payload: opts.payload ?? { kind: "task_reminder", taskId: task.id, reminderId: `rem-${task.id}` },
      priority: opts.priority ?? "normal",
      dedupeKey: `day3:${task.id}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  const [delivery] = await db
    .insert(schema.notificationDeliveries)
    .values({
      notificationId: notification.id,
      userId,
      channel,
      deviceId: device.id,
      status: opts.deliveryStatus ?? "pending",
      attempts: opts.attempts ?? 0,
      nextAttemptAt: opts.nextAttemptMs === undefined || opts.nextAttemptMs === null ? null : new Date(opts.nextAttemptMs),
      notBefore: opts.notBeforeMs === undefined || opts.notBeforeMs === null ? null : new Date(opts.notBeforeMs),
      leaseUntil: opts.leaseUntilMs === undefined || opts.leaseUntilMs === null ? null : new Date(opts.leaseUntilMs),
    })
    .returning();
  return { auth, userId, list, task, device, notification, delivery };
}

let deviceCounter = 0;
function deviceSuffix(): string {
  deviceCounter += 1;
  return `${Date.now()}-${deviceCounter}`;
}

function deliveryById(id: string) {
  return db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, id)).get();
}

function deviceById(id: string) {
  return db.select().from(schema.devices).where(eq(schema.devices.id, id)).get();
}

describe("delivery worker", () => {
  test("410 removes subscription and fails the delivery", async () => {
    const { delivery, device } = await makeSetup();
    const fake = new FakeProvider("web_push", () => ({
      ok: false,
      errorCode: "subscription_expired",
      retryable: false,
      reason: "gone",
    }));
    const stats = await runWorkerOnce(T0, { providers: { web_push: fake } });
    expect(stats.claimed).toBe(1);
    expect(stats.failed).toBe(1);
    expect(fake.calls).toHaveLength(1);

    const row = deliveryById(delivery.id)!;
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("subscription_expired");

    const dev = deviceById(device.id)!;
    expect(dev.pushStatus).toBe("expired");
    expect(dev.pushEnabled).toBe(false);
    expect(dev.webPushSub).toBeNull();
  });

  test("429 honors Retry-After, then sends after the window", async () => {
    const { delivery } = await makeSetup();
    const limited = new FakeProvider("web_push", () =>
      retryableResult({ errorCode: "send_failed", retryAfterMs: 120_000 })
    );
    const first = await runWorkerOnce(T0, { providers: { web_push: limited } });
    expect(first.retried).toBe(1);
    const row = deliveryById(delivery.id)!;
    expect(row.status).toBe("retry");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt!.getTime()).toBe(T0 + 120_000);

    // Still inside the Retry-After window: nothing claimed.
    const early = await runWorkerOnce(T0 + 30_000, { providers: { web_push: limited } });
    expect(early.claimed).toBe(0);
    expect(limited.calls).toHaveLength(1);

    // After the window the same delivery sends.
    const sender = new FakeProvider("web_push", okResult);
    const late = await runWorkerOnce(T0 + 120_000, { providers: { web_push: sender } });
    expect(late.sent).toBe(1);
    expect(deliveryById(delivery.id)!.status).toBe("sent");
    expect(sender.calls).toHaveLength(1);
  });

  test("exact backoff ladder 30s/2m/10m/1h/3h then failed", async () => {
    const { delivery } = await makeSetup();
    const fake = new FakeProvider("web_push", () => retryableResult());
    const step = async (t: number) => runWorkerOnce(t, { providers: { web_push: fake } });

    let t = T0;
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      const stats = await step(t);
      expect(stats.retried).toBe(1);
      const row = deliveryById(delivery.id)!;
      expect(row.status).toBe("retry");
      expect(row.attempts).toBe(i + 1);
      expect(row.nextAttemptAt!.getTime()).toBe(t + BACKOFF_MS[i]);
      t += BACKOFF_MS[i];
    }
    // Sixth failure exhausts attempts.
    const last = await step(t);
    expect(last.failed).toBe(1);
    const row = deliveryById(delivery.id)!;
    expect(row.status).toBe("failed");
    expect(row.attempts).toBe(BACKOFF_MS.length + 1);
    expect(fake.calls).toHaveLength(BACKOFF_MS.length + 1);
  });

  test("6 reminders coalesce into 1 summary", async () => {
    const auth = await createAuthUser("NotifyDay3");
    const userId = auth.user.id;
    const [list] = await db
      .insert(schema.lists)
      .values({ userId, name: "Main", position: "a0" })
      .returning();
    const [device] = await db
      .insert(schema.devices)
      .values({
        userId,
        platform: "web",
        pushEnabled: true,
        pushStatus: "active",
        webPushSub: { endpoint: `https://push.example.com/sub/${deviceSuffix()}`, keys: { p256dh: "p", auth: "a" } },
      })
      .returning();
    const titles = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "Zeta"];
    for (const [i, title] of titles.entries()) {
      const [task] = await db
        .insert(schema.tasks)
        .values({ userId, listId: list.id, title, position: `a${i}` })
        .returning();
      const [notif] = await db
        .insert(schema.notifications)
        .values({
          userId,
          type: "task_reminder",
          title,
          body: "Due now",
          entityType: "task",
          entityId: task.id,
          payload: { kind: "task_reminder", taskId: task.id },
          priority: "normal",
          dedupeKey: `day3c:${task.id}`,
        })
        .returning();
      await db.insert(schema.notificationDeliveries).values({
        notificationId: notif.id,
        userId,
        channel: "web_push",
        deviceId: device.id,
        status: "pending",
      });
    }
    const fake = new FakeProvider("web_push", okResult);
    const stats = await runWorkerOnce(T0, { providers: { web_push: fake } });
    expect(stats.summaries).toBe(1);
    expect(stats.coalesced).toBe(6);
    expect(stats.sent).toBe(1);
    expect(fake.calls).toHaveLength(1);

    const all = db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, userId)))
      .all();
    const summary = all.find((n) => n.type === "reminder_summary");
    expect(summary).toBeTruthy();
    expect(summary!.title).toBe("6 reminders");
    expect(summary!.body).toContain("+4 more");
    expect(summary!.body).toContain("Alpha");
    expect(summary!.url).toBe("/today");

    const deliveries = db
      .select()
      .from(schema.notificationDeliveries)
      .where(eq(schema.notificationDeliveries.userId, userId))
      .all();
    expect(deliveries.filter((d) => d.status === "suppressed" && d.reason === "coalesced")).toHaveLength(6);
    expect(deliveries.filter((d) => d.status === "sent")).toHaveLength(1);
  });

  test("hourly cap 60 pushes/user: 60 sent blocks, 59 allows one more", async () => {
    async function seedSent(userId: string, n: number) {
      for (let i = 0; i < n; i++) {
        const [notif] = await db
          .insert(schema.notifications)
          .values({
            userId,
            type: "task_reminder",
            title: `Old ${i}`,
            body: "x",
            priority: "normal",
            dedupeKey: `day3cap:${userId}:${i}:${Date.now()}`,
          })
          .returning();
        await db.insert(schema.notificationDeliveries).values({
          notificationId: notif.id,
          userId,
          channel: "web_push",
          deviceId: null,
          status: "sent",
          sentAt: new Date(T0 - 30 * 60_000),
        });
      }
    }

    const full = await makeSetup();
    await seedSent(full.userId, 60);
    const fakeFull = new FakeProvider("web_push", okResult);
    const blocked = await runWorkerOnce(T0, { providers: { web_push: fakeFull } });
    expect(blocked.suppressed).toBe(1);
    expect(fakeFull.calls).toHaveLength(0);
    const blockedRow = deliveryById(full.delivery.id)!;
    expect(blockedRow.status).toBe("suppressed");
    expect(blockedRow.reason).toBe("rate_limited");

    const room = await makeSetup();
    await seedSent(room.userId, 59);
    const fakeRoom = new FakeProvider("web_push", okResult);
    const allowed = await runWorkerOnce(T0, { providers: { web_push: fakeRoom } });
    expect(allowed.sent).toBe(1);
    expect(fakeRoom.calls).toHaveLength(1);
  });

  test("expired lease is recovered and sent", async () => {
    const { delivery } = await makeSetup({
      deliveryStatus: "sending",
      leaseUntilMs: T0 - 1_000,
      attempts: 1,
    });
    const fake = new FakeProvider("web_push", okResult);
    const stats = await runWorkerOnce(T0, { providers: { web_push: fake } });
    expect(stats.recovered).toBe(1);
    expect(stats.sent).toBe(1);
    expect(deliveryById(delivery.id)!.status).toBe("sent");
  });

  test("closed task cancels delivery without sending", async () => {
    const { delivery } = await makeSetup({ taskStatus: "done" });
    const fake = new FakeProvider("web_push", okResult);
    const stats = await runWorkerOnce(T0, { providers: { web_push: fake } });
    expect(stats.cancelled).toBe(1);
    expect(fake.calls).toHaveLength(0);
    expect(deliveryById(delivery.id)!.status).toBe("cancelled");
  });

  test("missing provider suppresses fail-soft (in-app only)", async () => {
    const { delivery } = await makeSetup();
    const stats = await runWorkerOnce(T0, { providers: { web_push: null } });
    expect(stats.suppressed).toBe(1);
    const row = deliveryById(delivery.id)!;
    expect(row.status).toBe("suppressed");
    expect(row.reason).toBe("provider_disabled");
  });

  test("urgent notification sends high urgency with reminder TTL and short topic", async () => {
    const { delivery } = await makeSetup({ priority: "high" });
    const fake = new FakeProvider("web_push", okResult);
    await runWorkerOnce(T0, { providers: { web_push: fake } });
    expect(fake.calls).toHaveLength(1);
    const input = fake.calls[0].delivery;
    expect(input.urgency).toBe("high");
    expect(input.ttlSeconds).toBe(6 * 3600);
    expect(input.topic).toBe(topicFor(delivery.notificationId));
    expect(input.topic!.length).toBeLessThanOrEqual(32);
  });
});

describe("cancellation hooks", () => {
  test("cancelPendingDeliveries by taskId and reminderId", async () => {
    const s = await makeSetup();
    expect(cancelPendingDeliveries({ taskId: s.task.id })).toBe(1);
    expect(deliveryById(s.delivery.id)!.status).toBe("cancelled");
    // Idempotent: second call cancels nothing.
    expect(cancelPendingDeliveries({ taskId: s.task.id })).toBe(0);

    const r = await makeSetup({
      payload: { kind: "task_reminder", taskId: "t", reminderId: "rem-123" },
    });
    expect(cancelPendingDeliveries({ reminderId: "rem-123" })).toBe(1);
    expect(deliveryById(r.delivery.id)!.status).toBe("cancelled");
    // Other reminder ids are untouched.
    expect(cancelPendingDeliveries({ reminderId: "rem-nope" })).toBe(0);
  });

  test("task complete cancels pending deliveries (HTTP)", async () => {
    const { auth, task, delivery } = await makeSetup();
    const res = await req("POST", `/api/v1/tasks/${task.id}/complete`, auth.token, {});
    expect(res.status).toBe(200);
    expect(deliveryById(delivery.id)!.status).toBe("cancelled");
  });

  test("task archive and delete cancel pending deliveries (HTTP)", async () => {
    const a = await makeSetup();
    const archived = await req("POST", `/api/v1/tasks/${a.task.id}/archive`, a.auth.token, {});
    expect(archived.status).toBe(200);
    expect(deliveryById(a.delivery.id)!.status).toBe("cancelled");

    const d = await makeSetup();
    const deleted = await req("DELETE", `/api/v1/tasks/${d.task.id}`, d.auth.token);
    expect(deleted.status).toBe(200);
    expect(deliveryById(d.delivery.id)!.status).toBe("cancelled");
  });

  test("reminder snooze and dismiss cancel pending deliveries (HTTP)", async () => {
    const s = await makeSetup();
    const [reminder] = await db
      .insert(schema.reminders)
      .values({ userId: s.userId, taskId: s.task.id, kind: "absolute", remindAt: new Date(T0 - 60_000) })
      .returning();
    await db
      .update(schema.notifications)
      .set({ payload: { kind: "task_reminder", taskId: s.task.id, reminderId: reminder.id } })
      .where(eq(schema.notifications.id, s.notification.id));

    const snoozed = await req("POST", `/api/v1/reminders/${reminder.id}/snooze`, s.auth.token, {
      preset: "1h",
    });
    expect(snoozed.status).toBe(200);
    expect(deliveryById(s.delivery.id)!.status).toBe("cancelled");

    // Fresh delivery, then dismiss cancels it too.
    const [notif2] = await db
      .insert(schema.notifications)
      .values({
        userId: s.userId,
        type: "task_reminder",
        title: "x",
        body: "y",
        entityType: "task",
        entityId: s.task.id,
        payload: { kind: "task_reminder", taskId: s.task.id, reminderId: reminder.id },
        priority: "normal",
        dedupeKey: `day3d:${reminder.id}:${Date.now()}`,
      })
      .returning();
    const [del2] = await db
      .insert(schema.notificationDeliveries)
      .values({ notificationId: notif2.id, userId: s.userId, channel: "web_push", deviceId: s.device.id, status: "pending" })
      .returning();
    const dismissed = await req("POST", `/api/v1/reminders/${reminder.id}/dismiss`, s.auth.token, {});
    expect(dismissed.status).toBe(200);
    expect(deliveryById(del2.id)!.status).toBe("cancelled");
  });
});

describe("FCM provider with stubbed fetch", () => {
  function rsaPem(): string {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    return privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  }

  function stubFetch(handler: (url: string) => Response): typeof fetch {
    return (async (url: unknown) => handler(String(url))) as unknown as typeof fetch;
  }

  const input = (token = "tok123"): DeliveryInput => ({
    notificationId: "n1",
    userId: "u1",
    deviceId: "d1",
    channel: "fcm",
    fcmToken: token,
  });
  const message = { title: "T", body: "B" };

  test("token grant cached, send succeeds", async () => {
    const calls: string[] = [];
    const fetchImpl = stubFetch((url) => {
      calls.push(url);
      if (url.includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
      return Response.json({ name: "projects/p/messages/1" });
    });
    const fcm = new FcmProvider(
      { projectId: "p", clientEmail: "a@b.c", privateKey: rsaPem() },
      fetchImpl
    );
    const first = await fcm.send(input(), message);
    expect(first.ok).toBe(true);
    expect(calls).toHaveLength(2);
    // Second send reuses the cached access token (55min TTL).
    const second = await fcm.send(input(), message);
    expect(second.ok).toBe(true);
    expect(calls).toHaveLength(3);
  });

  test("UNREGISTERED maps permanent; token deleted by worker", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
      return new Response(
        JSON.stringify({
          error: { status: "NOT_FOUND", message: "Requested entity was not found.", details: [{ errorCode: "UNREGISTERED" }] },
        }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    });
    const fcm = new FcmProvider(
      { projectId: "p", clientEmail: "a@b.c", privateKey: rsaPem() },
      fetchImpl
    );
    const res = await fcm.send(input(), message);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.retryable).toBe(false);
      expect(res.errorCode).toBe("token_unregistered");
    }

    // Worker path: failed delivery + FCM token deleted from device.
    const s = await makeSetup({ channel: "fcm" });
    const stats = await runWorkerOnce(T0, { providers: { fcm } });
    expect(stats.failed).toBe(1);
    expect(deliveryById(s.delivery.id)!.errorCode).toBe("token_unregistered");
    const dev = deviceById(s.device.id)!;
    expect(dev.fcmToken).toBeNull();
    expect(dev.pushStatus).toBe("expired");
  });

  test("429 with Retry-After is retryable with the server delay", async () => {
    const fetchImpl = stubFetch((url) => {
      if (url.includes("oauth2")) return Response.json({ access_token: "tok", expires_in: 3600 });
      return new Response("{}", { status: 429, headers: { "retry-after": "90" } });
    });
    const fcm = new FcmProvider(
      { projectId: "p", clientEmail: "a@b.c", privateKey: rsaPem() },
      fetchImpl
    );
    const res = await fcm.send(input(), message);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.retryable).toBe(true);
      expect(res.retryAfterMs).toBe(90_000);
    }
  });

  test("parseRetryAfterMs handles seconds, dates, and junk", () => {
    expect(parseRetryAfterMs({ "retry-after": "30" }, T0)).toBe(30_000);
    expect(parseRetryAfterMs({}, T0)).toBeUndefined();
    expect(parseRetryAfterMs({ "retry-after": "junk" }, T0)).toBeUndefined();
    const date = new Date(T0 + 60_000).toUTCString();
    expect(parseRetryAfterMs({ "retry-after": date }, T0)).toBe(60_000);
  });
});

describe("test-push endpoint", () => {
  test("enqueues a test notification and returns worker status", async () => {
    const { token } = await createAuthUser("NotifyDay3");
    const deviceId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const created = await app.handle(
      new Request(`${BASE}/api/v1/sync/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ deviceId, name: "laptop", platform: "web" }),
      })
    );
    expect([200, 201]).toContain(created.status);

    const put = await req("PUT", `/api/v1/devices/${deviceId}/push`, token, {
      subscription: {
        endpoint: `https://push.example.com/sub/${deviceSuffix()}`,
        keys: { p256dh: "p", auth: "a" },
      },
    });
    expect(put.status).toBe(200);

    const tst = await req("POST", `/api/v1/devices/${deviceId}/push/test`, token);
    expect(tst.status).toBe(200);
    expect(tst.json.channel).toBe("web_push");
    // No VAPID credentials in test env → fail-soft, in-app only.
    expect(tst.json.sent).toBe(false);
    expect(tst.json.status).toBe("suppressed");
    expect(tst.json.errorCode).toBe("provider_disabled");
  });
});
