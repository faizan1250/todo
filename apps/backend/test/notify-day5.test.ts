import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, isNull, sql } from "drizzle-orm";
import { app } from "../src/index";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import {
  buildDailyDigest,
  buildWeeklyDigest,
  runDigestTick,
  setDigestSummaryProvider,
} from "../src/utils/notify-digest";
import { setServer } from "../src/utils/sync-publisher";
import { createAuthUser } from "./helpers";

const BASE = "http://localhost:3001";

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

async function makeUser(tz: string) {
  const auth = await createAuthUser("NotifyDay5");
  const userId = auth.user.id;
  await db.update(schema.users).set({ timezone: tz }).where(eq(schema.users.id, userId));
  const [list] = await db
    .insert(schema.lists)
    .values({ userId, name: "Main", position: "a0" })
    .returning();
  return { auth, userId, listId: list.id };
}

async function setPrefs(userId: string, partial: Partial<typeof schema.notificationPrefs.$inferInsert>) {
  await db.insert(schema.notificationPrefs).values({ userId, ...partial });
}

async function addTask(
  userId: string,
  listId: string,
  partial: Partial<typeof schema.tasks.$inferInsert> = {}
) {
  const [t] = await db
    .insert(schema.tasks)
    .values({ userId, listId, title: "Task", position: "a0", ...partial })
    .returning();
  return t;
}

function digestNotifs(userId: string, type: "digest_daily" | "digest_weekly") {
  return db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, userId),
        eq(schema.notifications.type, type),
        isNull(schema.notifications.deletedAt)
      )
    )
    .all();
}

function digestLogs(userId: string, kind: "daily" | "weekly") {
  return db
    .select()
    .from(schema.digestLog)
    .where(and(eq(schema.digestLog.userId, userId), eq(schema.digestLog.kind, kind)))
    .all();
}

let published: Array<{ topic: string; data: string }> = [];

beforeEach(() => {
  // Fresh-DB semantics on the shared sqlite file: drop this file's users
  // (cascades clean tasks, notifications, logs, prefs). Makes every test
  // re-runnable and immune to leftovers from previous runs.
  db.delete(schema.users).where(sql`email LIKE 'notifyday5-%'`).run();
  published = [];
  setServer({ publish: (topic: string, data: string) => void published.push({ topic, data }) });
});

afterEach(() => {
  setServer(null);
  setDigestSummaryProvider(null);
});

describe("digest tick: 08:00 local fires exactly once (3 timezones, DST day)", () => {
  // 2026-03-08: US springs forward (EDT from 07:00Z). EU still on CET.
  test("five ticks, three users, three sends", async () => {
    const tokyo = await makeUser("Asia/Tokyo");
    const berlin = await makeUser("Europe/Berlin");
    const ny = await makeUser("America/New_York");
    for (const u of [tokyo, berlin, ny]) {
      await setPrefs(u.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    }
    // One "today" task + one overdue task per user (UTC instants chosen so
    // each falls in the right local bucket on 2026-03-08).
    await addTask(tokyo.userId, tokyo.listId, { title: "Tokyo today", dueAt: new Date("2026-03-07T22:00:00Z") });
    await addTask(tokyo.userId, tokyo.listId, { title: "Tokyo late", dueAt: new Date("2026-03-06T00:00:00Z") });
    await addTask(berlin.userId, berlin.listId, { title: "Berlin today", dueAt: new Date("2026-03-08T06:00:00Z") });
    await addTask(berlin.userId, berlin.listId, { title: "Berlin late", dueAt: new Date("2026-03-07T00:00:00Z") });
    await addTask(ny.userId, ny.listId, { title: "NY today", dueAt: new Date("2026-03-08T11:00:00Z") });
    await addTask(ny.userId, ny.listId, { title: "NY late", dueAt: new Date("2026-03-07T00:00:00Z") });

    const T1 = Date.parse("2026-03-07T22:55:00Z"); // nothing due yet
    const T2 = Date.parse("2026-03-07T23:05:00Z"); // Tokyo 08:05 JST
    const T3 = Date.parse("2026-03-08T07:05:00Z"); // Berlin 08:05 CET
    const T4 = Date.parse("2026-03-08T12:05:00Z"); // NY 08:05 EDT (DST)
    const T5 = Date.parse("2026-03-08T12:06:00Z"); // duplicate sweep

    const s1 = await runDigestTick(T1);
    expect(s1.sent).toBe(0);
    const s2 = await runDigestTick(T2);
    expect(s2.sent).toBe(1);
    const s3 = await runDigestTick(T3);
    expect(s3.sent).toBe(1);
    const s4 = await runDigestTick(T4);
    expect(s4.sent).toBe(1);
    const s5 = await runDigestTick(T5);
    expect(s5.sent).toBe(0);
    expect(s5.duplicates).toBe(1); // NY re-claims inside grace, loses

    for (const u of [tokyo, berlin, ny]) {
      const notifs = digestNotifs(u.userId, "digest_daily");
      expect(notifs).toHaveLength(1);
      expect(digestLogs(u.userId, "daily")).toHaveLength(1);
      expect(digestLogs(u.userId, "daily")[0].localDate).toBe("2026-03-08");
    }

    const nyBody = digestNotifs(ny.userId, "digest_daily")[0].body!;
    expect(nyBody).toContain("NY today");
    expect(nyBody).toContain("NY late");

    // Email channel is on by default: one pending email delivery each.
    for (const u of [tokyo, berlin, ny]) {
      const deliveries = db
        .select()
        .from(schema.notificationDeliveries)
        .where(eq(schema.notificationDeliveries.notificationId, digestNotifs(u.userId, "digest_daily")[0].id))
        .all();
      expect(deliveries.map((d) => d.channel)).toEqual(["email"]);
    }
    expect(published.filter((p) => JSON.parse(p.data).t === "notification")).toHaveLength(3);
  });
});

describe("digest skip + grace + catch-up", () => {
  test("empty day claims the slot but sends nothing", async () => {
    const u = await makeUser("UTC");
    await setPrefs(u.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    const s = await runDigestTick(Date.parse("2026-03-09T08:05:00Z"));
    expect(s.skippedEmpty).toBeGreaterThanOrEqual(1);
    expect(digestNotifs(u.userId, "digest_daily")).toHaveLength(0);
    const again = await runDigestTick(Date.parse("2026-03-09T08:06:00Z"));
    expect(digestNotifs(u.userId, "digest_daily")).toHaveLength(0);
    expect(again.duplicates).toBeGreaterThanOrEqual(1);
  });

  test("inside the 3h grace window sends, outside it skips", async () => {
    const inside = await makeUser("UTC");
    await setPrefs(inside.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    await addTask(inside.userId, inside.listId, { title: "Grace", dueAt: new Date("2026-03-10T09:00:00Z") });
    const s = await runDigestTick(Date.parse("2026-03-10T10:59:00Z"));
    expect(s.sent).toBeGreaterThanOrEqual(1);
    expect(digestNotifs(inside.userId, "digest_daily")).toHaveLength(1);

    const outside = await makeUser("UTC");
    await setPrefs(outside.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    await addTask(outside.userId, outside.listId, { title: "Too late", dueAt: new Date("2026-03-10T09:00:00Z") });
    const late = await runDigestTick(Date.parse("2026-03-10T11:01:00Z"));
    expect(late.sent).toBe(0);
    expect(digestNotifs(outside.userId, "digest_daily")).toHaveLength(0);
    expect(digestLogs(outside.userId, "daily")).toHaveLength(0);
  });

  test("post-downtime catch-up: first tick after an outage still sends once", async () => {
    const u = await makeUser("Europe/Paris");
    await setPrefs(u.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    await addTask(u.userId, u.listId, { title: "Outage task", dueAt: new Date("2026-03-11T07:30:00Z") });
    // Server was down at 08:00 local; first tick lands 09:30 local (08:30Z).
    const first = await runDigestTick(Date.parse("2026-03-11T08:30:00Z"));
    expect(first.sent).toBeGreaterThanOrEqual(1);
    expect(digestNotifs(u.userId, "digest_daily")).toHaveLength(1);
    const second = await runDigestTick(Date.parse("2026-03-11T08:31:00Z"));
    expect(second.sent).toBe(0);
    expect(digestNotifs(u.userId, "digest_daily")).toHaveLength(1);
  });
});

describe("weekly digest", () => {
  test("Sunday 17:00 tick sends review sections, Saturday tick skips", async () => {
    const u = await makeUser("UTC");
    await setPrefs(u.userId, { weeklyEnabled: true, weeklyDay: 0, weeklyTime: "17:00" });
    // Sunday 2026-03-08. Week starts Monday 2026-03-02.
    await addTask(u.userId, u.listId, {
      title: "Done this week",
      status: "done",
      completedAt: new Date("2026-03-05T10:00:00Z"),
    });
    await addTask(u.userId, u.listId, { title: "Slipped", dueAt: new Date("2026-03-06T10:00:00Z") });
    await addTask(u.userId, u.listId, { title: "Coming up", dueAt: new Date("2026-03-10T10:00:00Z") });
    await addTask(u.userId, u.listId, { title: "Big no date", priority: 4 });
    await addTask(u.userId, u.listId, { title: "Old done", status: "done", completedAt: new Date("2026-02-20T10:00:00Z") });

    // Saturday: wrong weekday, no send.
    const sat = await runDigestTick(Date.parse("2026-03-07T17:05:00Z"));
    expect(digestNotifs(u.userId, "digest_weekly")).toHaveLength(0);
    expect(sat.sent).toBe(0);

    const sun = await runDigestTick(Date.parse("2026-03-08T17:05:00Z"));
    expect(sun.sent).toBeGreaterThanOrEqual(1);
    const [notif] = digestNotifs(u.userId, "digest_weekly");
    expect(notif).toBeTruthy();
    expect(notif.url).toBe("/planner");
    const payload = notif.payload as Record<string, unknown>;
    expect(payload.kind).toBe("digest_weekly");
    expect(payload.completedCount).toBe(1);
    expect(payload.slippedCount).toBe(1);
    expect(payload.upcomingCount).toBe(1);
    expect(payload.highPriorityCount).toBe(1);
    expect(notif.body).toContain("Done this week");
    expect(notif.body).toContain("Slipped");
    expect(notif.body).toContain("Big no date");
    expect(notif.body).not.toContain("Old done");
  });

  test("empty week skips", async () => {
    const u = await makeUser("UTC");
    await setPrefs(u.userId, { weeklyEnabled: true, weeklyDay: 0, weeklyTime: "17:00" });
    const s = await runDigestTick(Date.parse("2026-03-08T17:05:00Z"));
    expect(digestNotifs(u.userId, "digest_weekly")).toHaveLength(0);
    expect(s.sent).toBe(0);
  });
});

describe("digest builders", () => {
  test("daily caps overdue titles with 'and N more'", async () => {
    const u = await makeUser("UTC");
    for (let i = 0; i < 7; i++) {
      await addTask(u.userId, u.listId, { title: `Late ${i}`, dueAt: new Date("2026-03-01T10:00:00Z") });
    }
    const content = await buildDailyDigest(u.userId, "UTC", Date.parse("2026-03-08T12:00:00Z"));
    expect(content).not.toBeNull();
    expect(content!.payload.overdueCount).toBe(7);
    expect(content!.body).toContain("and 2 more");
    expect(content!.url).toBe("/today");
  });

  test("summary provider hook injects a summary line, fail-soft on error", async () => {
    const u = await makeUser("UTC");
    await addTask(u.userId, u.listId, { title: "Hook task", dueAt: new Date("2026-03-08T09:00:00Z") });
    setDigestSummaryProvider(() => "AI says: easy day.");
    const withHook = await buildDailyDigest(u.userId, "UTC", Date.parse("2026-03-08T12:00:00Z"));
    expect(withHook!.body.startsWith("AI says: easy day.")).toBe(true);
    expect(withHook!.payload.summary).toBe("AI says: easy day.");

    setDigestSummaryProvider(() => {
      throw new Error("llm down");
    });
    const failed = await buildDailyDigest(u.userId, "UTC", Date.parse("2026-03-08T12:00:00Z"));
    expect(failed!.payload.summary).toBeNull();
    expect(failed!.body.startsWith("AI says")).toBe(false);
  });

  test("weekly builder respects weekStartsOn", async () => {
    const u = await makeUser("UTC");
    // Completed Saturday 2026-03-07; an open upcoming task keeps every
    // variant non-empty. Now Sunday 2026-03-08 12:00Z.
    await addTask(u.userId, u.listId, {
      title: "Saturday done",
      status: "done",
      completedAt: new Date("2026-03-07T10:00:00Z"),
    });
    await addTask(u.userId, u.listId, { title: "Anchor", dueAt: new Date("2026-03-10T10:00:00Z") });
    const sundayStart = await buildWeeklyDigest(u.userId, "UTC", Date.parse("2026-03-08T12:00:00Z"), 0);
    expect(sundayStart!.payload.completedCount).toBe(0);
    const mondayStart = await buildWeeklyDigest(u.userId, "UTC", Date.parse("2026-03-08T12:00:00Z"), 1);
    expect(mondayStart!.payload.completedCount).toBe(1);
    const saturdayStart = await buildWeeklyDigest(u.userId, "UTC", Date.parse("2026-03-08T12:00:00Z"), 6);
    expect(saturdayStart!.payload.completedCount).toBe(1);
  });
});

describe("digest routes", () => {
  test("preview requires auth and renders shape", async () => {
    const unauth = await req("GET", "/api/v1/digest/preview?kind=daily");
    expect(unauth.status).toBe(401);

    const empty = await makeUser("UTC");
    await setPrefs(empty.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    const e = await req("GET", "/api/v1/digest/preview?kind=daily", empty.auth.token);
    expect(e.status).toBe(200);
    expect(e.json.kind).toBe("daily");
    expect(e.json.empty).toBe(true);
    expect(e.json.digest).toBeNull();
    expect(typeof e.json.localDate).toBe("string");
    expect(e.json.timezone).toBe("UTC");
    expect(e.json.scheduledFor).toBe("08:00");
    expect(e.json.enabled).toBe(true);

    const bad = await req("GET", "/api/v1/digest/preview?kind=monthly", empty.auth.token);
    expect(bad.status).toBe(422);

    const busy = await makeUser("UTC");
    await setPrefs(busy.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    await db.insert(schema.lists).values({ userId: busy.userId, name: "Extra", position: "a0" });
    await addTask(busy.userId, busy.listId, { title: "Right now", dueAt: new Date(Date.now() + 60_000) });
    const p = await req("GET", "/api/v1/digest/preview?kind=daily", busy.auth.token);
    expect(p.status).toBe(200);
    expect(p.json.empty).toBe(false);
    expect(p.json.digest.type).toBe("digest_daily");
    expect(typeof p.json.digest.title).toBe("string");
    expect(p.json.digest.body).toContain("Right now");
    expect(p.json.digest.url).toBe("/today");
    expect(p.json.digest.payload.kind).toBe("digest_daily");
  });

  test("send-test sends to the caller only, empty stays silent", async () => {
    const caller = await makeUser("UTC");
    await setPrefs(caller.userId, { digestDailyEnabled: true, digestTime: "08:00" });
    await addTask(caller.userId, caller.listId, { title: "Call me", dueAt: new Date(Date.now() + 60_000) });
    const other = await makeUser("UTC");
    await setPrefs(other.userId, { digestDailyEnabled: true, digestTime: "08:00" });

    const res = await req("POST", "/api/v1/digest/send-test", caller.auth.token, { kind: "daily" });
    expect(res.status).toBe(200);
    expect(res.json.sent).toBe(true);
    expect(typeof res.json.notificationId).toBe("string");
    expect(digestNotifs(caller.userId, "digest_daily")).toHaveLength(1);
    expect(digestNotifs(other.userId, "digest_daily")).toHaveLength(0);
    // Send-test never consumes the scheduled slot.
    expect(digestLogs(caller.userId, "daily")).toHaveLength(0);

    const emptyRes = await req("POST", "/api/v1/digest/send-test", other.auth.token, {});
    expect(emptyRes.status).toBe(200);
    expect(emptyRes.json).toMatchObject({ sent: false, reason: "empty" });
  });
});
