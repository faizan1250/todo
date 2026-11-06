import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, isNull } from "drizzle-orm";
import { app } from "../src/index";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { runTick, LAST_TICK_KEY } from "../src/utils/notify-scheduler";
import { resetNow } from "../src/utils/notify-clock";
import { setServer } from "../src/utils/sync-publisher";
import { createAuthUser } from "./helpers";

const BASE = "http://localhost:3001";
const T0 = Date.parse("2026-01-15T12:00:00Z");

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

async function makeFixture(opts: {
  task?: Partial<typeof schema.tasks.$inferInsert>;
  remindAtMs?: number;
  withDevice?: boolean;
} = {}) {
  const auth = await createAuthUser("NotifyDay2");
  const userId = auth.user.id;
  const [list] = await db
    .insert(schema.lists)
    .values({ userId, name: "Main", position: "a0" })
    .returning();
  const [task] = await db
    .insert(schema.tasks)
    .values({ userId, listId: list.id, title: "Water the plants", position: "a0", ...(opts.task ?? {}) })
    .returning();
  const [reminder] = await db
    .insert(schema.reminders)
    .values({
      userId,
      taskId: task.id,
      kind: "absolute",
      remindAt: new Date(opts.remindAtMs ?? T0 - 60_000),
      firedAt: null,
    })
    .returning();
  if (opts.withDevice) {
    await db.insert(schema.devices).values({
      userId,
      platform: "web",
      pushEnabled: true,
      webPushSub: { endpoint: "https://push.example.com/sub/1", keys: { p256dh: "p", auth: "a" } },
    });
  }
  return { auth, userId, list, task, reminder };
}

function clearSchedulerState() {
  db.delete(schema.schedulerState).where(eq(schema.schedulerState.key, LAST_TICK_KEY)).run();
}

function userNotifications(userId: string) {
  return db
    .select()
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.deletedAt)))
    .all();
}

function deliveriesFor(notificationId: string) {
  return db
    .select()
    .from(schema.notificationDeliveries)
    .where(eq(schema.notificationDeliveries.notificationId, notificationId))
    .all();
}

function reminderById(id: string) {
  return db.select().from(schema.reminders).where(eq(schema.reminders.id, id)).get();
}

let published: Array<{ topic: string; data: string }> = [];

beforeEach(() => {
  clearSchedulerState();
  resetNow();
  published = [];
  setServer({ publish: (topic: string, data: string) => void published.push({ topic, data }) });
});

afterEach(() => {
  setServer(null);
  resetNow();
  clearSchedulerState();
});

describe("scheduler tick", () => {
  test("tick-twice-fires-once: one notification, second tick claims nothing", async () => {
    const { userId, reminder } = await makeFixture({ withDevice: true });
    const first = await runTick(T0);
    expect(first.bucket).toBe("normal");
    expect(first.claimed).toBe(1);
    expect(first.sent).toBe(1);

    const notifs = userNotifications(userId);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("task_reminder");
    const d = deliveriesFor(notifs[0].id);
    expect(d.map((x) => x.channel).sort()).toEqual(["email", "web_push"]);

    const r = reminderById(reminder.id)!;
    expect(r.firedAt).not.toBeNull();
    expect(r.outcome).toBe("sent");

    // Realtime hint published on user topic. Filter to notification hints:
    // the shared mock also collects debounced `{t:"changed"}` sync hints
    // from schedulePublish timers armed by earlier tests (100ms fuse can
    // expire inside this test when files run back-to-back).
    const hints = published.filter((p) => JSON.parse(p.data).t === "notification");
    expect(hints).toHaveLength(1);
    expect(hints[0].topic).toBe(`user:${userId}`);
    expect(JSON.parse(hints[0].data)).toEqual({ t: "notification", id: notifs[0].id });

    const second = await runTick(T0 + 30_000);
    expect(second.claimed).toBe(0);
    expect(userNotifications(userId)).toHaveLength(1);
  });

  test("skip rules: done/cancelled/deleted/archived/list-off mark fired without notifying", async () => {
    const cases: Array<{ name: string; task?: Record<string, unknown>; listRule?: boolean; outcome: string }> = [
      { name: "done", task: { status: "done" }, outcome: "skipped_done" },
      { name: "cancelled", task: { status: "cancelled" }, outcome: "skipped_done" },
      { name: "deleted", task: { deletedAt: new Date(T0 - 10_000) }, outcome: "skipped_done" },
      { name: "archived", task: { archivedAt: new Date(T0 - 10_000) }, outcome: "skipped_done" },
      { name: "list-off", listRule: true, outcome: "skipped_off" },
    ];
    for (const c of cases) {
      const { userId, task, reminder, list } = await makeFixture({ task: c.task as never });
      if (c.listRule) {
        await db.insert(schema.listNotificationRules).values({ userId, listId: list.id, mode: "off" });
      }
      const stats = await runTick(T0);
      expect(stats.skipped).toBe(1);
      expect(userNotifications(userId)).toHaveLength(0);
      const r = reminderById(reminder.id)!;
      expect(r.firedAt).not.toBeNull();
      expect(r.outcome).toBe(c.outcome);
      expect(task.id).toBeTruthy();
    }
  });

  test("no-date reminders never fire", async () => {
    const { userId, reminder } = await makeFixture();
    await db.update(schema.reminders).set({ remindAt: new Date(0) }).where(eq(schema.reminders.id, reminder.id));
    const stats = await runTick(T0);
    expect(stats.claimed).toBe(0);
    expect(userNotifications(userId)).toHaveLength(0);
    expect(reminderById(reminder.id)!.firedAt).toBeNull();
  });

  test("snooze refires: new remindAt produces a second notification", async () => {
    const { userId, reminder } = await makeFixture();
    await runTick(T0);
    expect(userNotifications(userId)).toHaveLength(1);

    // Snooze: new fire time, firedAt cleared.
    const later = T0 + 5 * 60_000;
    await db
      .update(schema.reminders)
      .set({ remindAt: new Date(later), firedAt: null })
      .where(eq(schema.reminders.id, reminder.id));
    const stats = await runTick(later);
    expect(stats.sent).toBe(1);
    const notifs = userNotifications(userId);
    expect(notifs).toHaveLength(2);
    expect(new Set(notifs.map((n) => n.dedupeKey)).size).toBe(2);
  });

  test("quiet hours defer pushes via notBefore but still notify in-app", async () => {
    const { userId } = await makeFixture({ remindAtMs: Date.parse("2026-01-15T23:30:00Z"), withDevice: true });
    await db.insert(schema.notificationPrefs).values({
      userId,
      quietEnabled: true,
      quietStart: "22:00",
      quietEnd: "07:00",
    });
    const t = Date.parse("2026-01-15T23:30:00Z");
    const stats = await runTick(t);
    expect(stats.sent).toBe(1);
    const [notif] = userNotifications(userId);
    expect(notif).toBeTruthy();
    const d = deliveriesFor(notif.id);
    expect(d.length).toBeGreaterThan(0);
    for (const row of d) {
      expect(row.notBefore!.getTime()).toBe(Date.parse("2026-01-16T07:00:00Z"));
    }
  });
});

describe("scheduler catch-up buckets", () => {
  function seedLastTick(ms: number) {
    db.insert(schema.schedulerState)
      .values({ key: LAST_TICK_KEY, value: String(ms), updatedAt: new Date(ms) })
      .run();
  }

  test("10min gap fires normally with pushes", async () => {
    const { userId } = await makeFixture({ remindAtMs: T0 - 5 * 60_000, withDevice: true });
    seedLastTick(T0 - 10 * 60_000);
    const stats = await runTick(T0);
    expect(stats.bucket).toBe("normal");
    expect(stats.sent).toBe(1);
    const [notif] = userNotifications(userId);
    expect(deliveriesFor(notif.id).length).toBeGreaterThan(0);
  });

  test("3h gap coalesces into one summary, no pushes", async () => {
    const { userId, task } = await makeFixture({ remindAtMs: T0 - 60_000 });
    // Second due reminder for the same user.
    await db.insert(schema.reminders).values({
      userId,
      taskId: task.id,
      kind: "absolute",
      remindAt: new Date(T0 - 120_000),
      firedAt: null,
    });
    seedLastTick(T0 - 3 * 3600_000);
    const stats = await runTick(T0);
    expect(stats.bucket).toBe("catchup");
    expect(stats.coalesced).toBe(2);
    const notifs = userNotifications(userId);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("away_summary");
    expect(notifs[0].title).toBe("While you were away");
    expect(deliveriesFor(notifs[0].id)).toHaveLength(0);
    const outcomes = db.select().from(schema.reminders).where(eq(schema.reminders.userId, userId)).all();
    expect(outcomes.map((r) => r.outcome).sort()).toEqual(["coalesced", "coalesced"]);
  });

  test("20h gap notifies in-app only, no pushes", async () => {
    const { userId, reminder } = await makeFixture({ remindAtMs: T0 - 3600_000, withDevice: true });
    seedLastTick(T0 - 20 * 3600_000);
    const stats = await runTick(T0);
    expect(stats.bucket).toBe("stale");
    expect(stats.missed).toBe(1);
    const notifs = userNotifications(userId);
    expect(notifs).toHaveLength(1);
    expect(notifs[0].type).toBe("task_reminder");
    expect(deliveriesFor(notifs[0].id)).toHaveLength(0);
    expect(reminderById(reminder.id)!.outcome).toBe("missed");
  });
});

describe("notifications inbox", () => {
  test("list, unread-count, read, read-all, delete with ownership", async () => {
    const { auth, userId, task } = await makeFixture({ withDevice: true });
    await runTick(T0);
    // Second notification via a fresh reminder.
    const [rem2] = await db
      .insert(schema.reminders)
      .values({ userId, taskId: task.id, kind: "absolute", remindAt: new Date(T0 - 1000), firedAt: null })
      .returning();
    clearSchedulerState();
    await runTick(T0 + 60_000);
    expect(reminderById(rem2.id)!.outcome).toBe("sent");

    const list1 = await req("GET", "/api/v1/notifications?limit=1", auth.token);
    expect(list1.status).toBe(200);
    expect(list1.json.items).toHaveLength(1);
    expect(list1.json.hasMore).toBe(true);
    expect(typeof list1.json.nextCursor).toBe("string");

    const page2 = await req("GET", `/api/v1/notifications?cursor=${encodeURIComponent(list1.json.nextCursor)}`, auth.token);
    expect(page2.status).toBe(200);
    expect(page2.json.items).toHaveLength(1);
    expect(page2.json.hasMore).toBe(false);

    // Newest first.
    expect(list1.json.items[0].createdAt >= page2.json.items[0].createdAt).toBe(true);

    const unread1 = await req("GET", "/api/v1/notifications?unread=1", auth.token);
    expect(unread1.json.items).toHaveLength(2);

    const count1 = await req("GET", "/api/v1/notifications/unread-count", auth.token);
    expect(count1.json).toEqual({ count: 2 });

    const id = list1.json.items[0].id as string;
    const read = await req("POST", `/api/v1/notifications/${id}/read`, auth.token);
    expect(read.status).toBe(200);
    expect(read.json.read).toBe(true);

    const count2 = await req("GET", "/api/v1/notifications/unread-count", auth.token);
    expect(count2.json).toEqual({ count: 1 });

    const readAll = await req("POST", "/api/v1/notifications/read-all", auth.token);
    expect(readAll.json).toEqual({ success: true, updated: 1 });

    const other = await createAuthUser("NotifyDay2");
    const stolen = await req("POST", `/api/v1/notifications/${id}/read`, other.token);
    expect(stolen.status).toBe(404);
    const missing = await req("POST", "/api/v1/notifications/does-not-exist/read", auth.token);
    expect(missing.status).toBe(404);

    const del = await req("DELETE", `/api/v1/notifications/${id}`, auth.token);
    expect(del.json).toEqual({ success: true });
    const after = await req("GET", "/api/v1/notifications", auth.token);
    expect(after.json.items.map((n: { id: string }) => n.id)).not.toContain(id);
    const delMissing = await req("DELETE", "/api/v1/notifications/does-not-exist", auth.token);
    expect(delMissing.status).toBe(404);

    const unauth = await app.handle(new Request(`${BASE}/api/v1/notifications`));
    expect(unauth.status).toBe(401);
  });
});
