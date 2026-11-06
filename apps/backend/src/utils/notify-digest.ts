import { and, asc, desc, eq, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db";
import * as schema from "../db/schema";
import { now } from "./notify-clock";
import { getNotifyConfig } from "./notify-config";
import { planDelivery, type DeliveryChannel } from "./notify-policy";
import { publishNotification } from "./sync-publisher";

/**
 * Phase 6 daily digest + weekly review (Day 5).
 *
 * `runDigestTick()` is the every-minute cron entry: for each user with a
 * digest enabled it converts now to the user's timezone and, when the local
 * time has passed the configured send time but is still inside the 3h grace
 * window, claims the `(userId, kind, localDate)` digest_log slot FIRST
 * (idempotent PK insert — losers skip) and only then builds + sends.
 *
 * Empty digests send nothing but keep the claimed slot, so one build per day
 * is the steady-state cost.
 */

export type DigestKind = "daily" | "weekly";

/** Send window after the configured time. Late ticks (e.g. post-downtime boot) still fire inside it. */
export const DIGEST_GRACE_MS = 3 * 3600 * 1000;

const OPEN_STATUSES = ["todo", "in_progress"] as const;
const DAY_MS = 24 * 3600 * 1000;

export interface BuiltDigest {
  type: "digest_daily" | "digest_weekly";
  title: string;
  body: string;
  url: string | null;
  payload: Record<string, unknown>;
  localDate: string;
}

/* ---------- Phase 8 summary hook (stub) ---------- */

export interface DigestSummaryInput {
  kind: DigestKind;
  userId: string;
  timezone: string;
  localDate: string;
  counts: Record<string, number>;
  titles: string[];
}

/**
 * Phase 8 hook: an AI summarizer can be plugged in via
 * `setDigestSummaryProvider()`. Default is null (no summary line).
 * Fail-soft: provider errors are swallowed, the digest sends without one.
 */
export type DigestSummaryProvider = (
  input: DigestSummaryInput
) => Promise<string | null> | string | null;

let summaryProvider: DigestSummaryProvider | null = null;

export function setDigestSummaryProvider(p: DigestSummaryProvider | null): void {
  summaryProvider = p;
}

export function getDigestSummaryProvider(): DigestSummaryProvider | null {
  return summaryProvider;
}

async function maybeSummarize(input: DigestSummaryInput): Promise<string | null> {
  if (!summaryProvider) return null;
  try {
    const out = await summaryProvider(input);
    return typeof out === "string" && out.trim() !== "" ? out : null;
  } catch {
    return null;
  }
}

/* ---------- timezone helpers ---------- */

function zoned(nowMs: number, tz: string): DateTime {
  let dt = DateTime.fromMillis(nowMs).setZone(tz || "UTC");
  if (!dt.isValid) dt = DateTime.fromMillis(nowMs).setZone("UTC");
  return dt;
}

function parseHhMm(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface DigestLocal {
  localDate: string;
  /** 0=Sun..6=Sat in the user's timezone. */
  weekdaySun0: number;
  minutes: number;
  /** Local midnight as a UTC ms epoch. */
  startMs: number;
}

export function digestLocal(nowMs: number, tz: string): DigestLocal {
  const dt = zoned(nowMs, tz);
  return {
    localDate: dt.toISODate() ?? new Date(nowMs).toISOString().slice(0, 10),
    weekdaySun0: dt.weekday % 7,
    minutes: dt.hour * 60 + dt.minute,
    startMs: dt.startOf("day").toMillis(),
  };
}

/** True when local time has passed today's `timeStr` but is still inside the grace window. */
function isDue(local: DigestLocal, nowMs: number, timeStr: unknown): boolean {
  const mins = parseHhMm(timeStr);
  if (mins === null) return false;
  const scheduled = local.startMs + mins * 60_000;
  return nowMs >= scheduled && nowMs - scheduled <= DIGEST_GRACE_MS;
}

/* ---------- task queries ---------- */

function openFilter(userId: string): SQL {
  return and(
    eq(schema.tasks.userId, userId),
    inArray(schema.tasks.status, [...OPEN_STATUSES]),
    isNull(schema.tasks.deletedAt),
    isNull(schema.tasks.archivedAt)
  )!;
}

function countWhere(cond: SQL): number {
  const row = db.select({ n: sql<number>`count(*)` }).from(schema.tasks).where(cond).get();
  return row?.n ?? 0;
}

function titlesWhere(cond: SQL, limit: number): string[] {
  return db
    .select({ title: schema.tasks.title })
    .from(schema.tasks)
    .where(cond)
    .orderBy(asc(schema.tasks.dueAt))
    .limit(limit)
    .all()
    .map((r) => r.title);
}

function formatTitles(titles: string[], total: number): string {
  if (titles.length === 0) return "";
  const shown = titles.join(", ");
  return total > titles.length ? `${shown} and ${total - titles.length} more` : shown;
}

function formatTime(ms: number, tz: string): string {
  return DateTime.fromMillis(ms).setZone(tz).toFormat("HH:mm");
}

/* ---------- daily builder ---------- */

export async function buildDailyDigest(
  userId: string,
  tz: string,
  nowMs: number = now()
): Promise<BuiltDigest | null> {
  const local = digestLocal(nowMs, tz);
  const endMs = local.startMs + DAY_MS;
  const base = openFilter(userId);

  // SQL aggregates: counts first, titles only when non-empty.
  const overdueCount = countWhere(and(base, lt(schema.tasks.dueAt, new Date(local.startMs)))!);
  const dueCount = countWhere(
    and(base, gte(schema.tasks.dueAt, new Date(local.startMs)), lt(schema.tasks.dueAt, new Date(endMs)))!
  );
  if (overdueCount === 0 && dueCount === 0) return null;

  const overdueTitles = overdueCount > 0 ? titlesWhere(and(base, lt(schema.tasks.dueAt, new Date(local.startMs)))!, 5) : [];
  const todayRows =
    dueCount > 0
      ? db
          .select({ title: schema.tasks.title, dueAt: schema.tasks.dueAt, priority: schema.tasks.priority })
          .from(schema.tasks)
          .where(and(base, gte(schema.tasks.dueAt, new Date(local.startMs)), lt(schema.tasks.dueAt, new Date(endMs)))!)
          .orderBy(asc(schema.tasks.dueAt), desc(schema.tasks.priority))
          .limit(10)
          .all()
      : [];

  const todayTitles = todayRows.map((r) => {
    const t = r.dueAt ? formatTime(r.dueAt.getTime(), tz) : null;
    return t ? `${t} ${r.title}` : r.title;
  });

  const sections: string[] = [];
  if (overdueCount > 0) sections.push(`Overdue (${overdueCount}): ${formatTitles(overdueTitles, overdueCount)}`);
  if (dueCount > 0) sections.push(`Today (${dueCount}): ${formatTitles(todayTitles, dueCount)}`);
  sections.push("Open /today to plan your day.");

  const summary = await maybeSummarize({
    kind: "daily",
    userId,
    timezone: tz,
    localDate: local.localDate,
    counts: { overdue: overdueCount, due: dueCount },
    titles: [...overdueTitles, ...todayRows.map((r) => r.title)],
  });
  const body = summary ? `${summary}\n\n${sections.join("\n")}` : sections.join("\n");

  return {
    type: "digest_daily",
    title: `Your day: ${dueCount} tasks, ${overdueCount} overdue`,
    body,
    url: "/today",
    payload: {
      kind: "digest_daily",
      dueCount,
      overdueCount,
      topTasks: todayRows.map((r) => r.title).slice(0, 3),
      overdueTitles,
      summary,
    },
    localDate: local.localDate,
  };
}

/* ---------- weekly builder ---------- */

export async function buildWeeklyDigest(
  userId: string,
  tz: string,
  nowMs: number = now(),
  weekStartsOn = 1
): Promise<BuiltDigest | null> {
  const local = digestLocal(nowMs, tz);
  const weekStartMs = local.startMs - (((local.weekdaySun0 - (weekStartsOn % 7) + 7) % 7) * DAY_MS);
  const weekEndMs = local.startMs + 7 * DAY_MS;
  const base = openFilter(userId);

  const completedCount =
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.userId, userId),
          eq(schema.tasks.status, "done"),
          gte(schema.tasks.completedAt, new Date(weekStartMs)),
          isNull(schema.tasks.deletedAt),
          isNull(schema.tasks.archivedAt)
        )
      )
      .get()?.n ?? 0;

  const slippedCond = and(base, lt(schema.tasks.dueAt, new Date(local.startMs)))!;
  const upcomingCond = and(
    base,
    gte(schema.tasks.dueAt, new Date(local.startMs)),
    lt(schema.tasks.dueAt, new Date(weekEndMs))
  )!;
  const highCond = and(
    base,
    gte(schema.tasks.priority, 3),
    or(isNull(schema.tasks.dueAt), gte(schema.tasks.dueAt, new Date(weekEndMs)))!
  )!;

  const slippedCount = countWhere(slippedCond);
  const upcomingCount = countWhere(upcomingCond);
  const highCount = countWhere(highCond);
  if (completedCount === 0 && slippedCount === 0 && upcomingCount === 0 && highCount === 0) return null;

  const completedTitles =
    completedCount > 0
      ? db
          .select({ title: schema.tasks.title })
          .from(schema.tasks)
          .where(
            and(
              eq(schema.tasks.userId, userId),
              eq(schema.tasks.status, "done"),
              gte(schema.tasks.completedAt, new Date(weekStartMs)),
              isNull(schema.tasks.deletedAt),
              isNull(schema.tasks.archivedAt)
            )
          )
          .orderBy(desc(schema.tasks.completedAt))
          .limit(5)
          .all()
          .map((r) => r.title)
      : [];
  const slippedTitles = slippedCount > 0 ? titlesWhere(slippedCond, 5) : [];
  const upcomingRows =
    upcomingCount > 0
      ? db
          .select({ title: schema.tasks.title, dueAt: schema.tasks.dueAt })
          .from(schema.tasks)
          .where(upcomingCond)
          .orderBy(asc(schema.tasks.dueAt), desc(schema.tasks.priority))
          .limit(10)
          .all()
      : [];
  const highTitles = highCount > 0 ? titlesWhere(highCond, 5) : [];

  const sections: string[] = [];
  if (completedCount > 0) sections.push(`Completed (${completedCount}): ${formatTitles(completedTitles, completedCount)}`);
  if (slippedCount > 0) sections.push(`Slipped (${slippedCount}): ${formatTitles(slippedTitles, slippedCount)}`);
  if (upcomingCount > 0) {
    const upcomingTitles = upcomingRows.map((r) =>
      r.dueAt ? `${formatTime(r.dueAt.getTime(), tz)} ${r.title}` : r.title
    );
    sections.push(`Coming up (${upcomingCount}): ${formatTitles(upcomingTitles, upcomingCount)}`);
  }
  if (highCount > 0) sections.push(`High priority (${highCount}): ${formatTitles(highTitles, highCount)}`);

  const summary = await maybeSummarize({
    kind: "weekly",
    userId,
    timezone: tz,
    localDate: local.localDate,
    counts: { completed: completedCount, slipped: slippedCount, upcoming: upcomingCount, high: highCount },
    titles: [...completedTitles, ...slippedTitles, ...upcomingRows.map((r) => r.title)],
  });
  const body = summary ? `${summary}\n\n${sections.join("\n")}` : sections.join("\n");

  return {
    type: "digest_weekly",
    title: `Your week: ${completedCount} done, ${slippedCount + upcomingCount} ahead`,
    body,
    url: "/planner",
    payload: {
      kind: "digest_weekly",
      dueCount: upcomingCount,
      overdueCount: slippedCount,
      topTasks: upcomingRows.map((r) => r.title).slice(0, 3),
      completedCount,
      slippedCount,
      upcomingCount,
      highPriorityCount: highCount,
      slippedTitles,
      summary,
    },
    localDate: local.localDate,
  };
}

/* ---------- digest tick (every-minute cron) ---------- */

export interface DigestTickStats {
  ran: boolean;
  checked: number;
  sent: number;
  skippedEmpty: number;
  duplicates: number;
  notifications: number;
}

let digestRunning = false;

/** Claim the (user, kind, localDate) slot. True = this tick won and must send. */
function claimDigestSlot(userId: string, kind: DigestKind, localDate: string, nowMs: number): boolean {
  const rows = db
    .insert(schema.digestLog)
    .values({ userId, kind, localDate, sentAt: new Date(nowMs) })
    .onConflictDoNothing()
    .returning({ userId: schema.digestLog.userId })
    .all();
  return rows.length === 1;
}

interface DigestTargets {
  webPushDevices: Array<{ id: string }>;
  fcmDevices: Array<{ id: string }>;
  emailSuppressed: boolean;
}

function loadTargets(userId: string, email: string): DigestTargets {
  const devices = db
    .select()
    .from(schema.devices)
    .where(
      and(
        eq(schema.devices.userId, userId),
        eq(schema.devices.pushEnabled, true),
        eq(schema.devices.pushStatus, "active")
      )
    )
    .all();
  const lower = email.toLowerCase();
  const suppression = db
    .select({ email: schema.emailSuppressions.email })
    .from(schema.emailSuppressions)
    .where(inArray(schema.emailSuppressions.email, lower === email ? [email] : [email, lower]))
    .get();
  return {
    webPushDevices: devices.flatMap((d) => (d.webPushSub ? [{ id: d.id }] : [])),
    fcmDevices: devices.flatMap((d) => (d.fcmToken ? [{ id: d.id }] : [])),
    emailSuppressed: Boolean(suppression),
  };
}

/** Insert the inbox row + channel deliveries for a built digest. Returns the notification id or null. */
export function enqueueDigest(
  user: typeof schema.users.$inferSelect,
  prefs: typeof schema.notificationPrefs.$inferSelect,
  content: BuiltDigest,
  nowMs: number
): string | null {
  const cfg = getNotifyConfig();
  const targets = loadTargets(user.id, user.email);
  const typeKey = content.type === "digest_daily" ? "digest_daily" : "digest_weekly";
  const plan = planDelivery({
    notificationsEnabled: cfg.enabled,
    pausedUntilMs: prefs.pausedUntil ? prefs.pausedUntil.getTime() : null,
    nowMs,
    typePref: (prefs.types as Record<string, { webPush?: boolean; email?: boolean }>)?.[typeKey],
    listRule: "all",
    quiet: {
      enabled: prefs.quietEnabled,
      start: prefs.quietStart,
      end: prefs.quietEnd,
      urgentBreaksQuiet: prefs.urgentBreaksQuiet,
    },
    timezone: user.timezone || "UTC",
    priority: 0,
    hasWebPushTarget: targets.webPushDevices.length > 0,
    hasFcmTarget: targets.fcmDevices.length > 0,
    hasEmailTarget: Boolean(user.email),
    emailSuppressed: targets.emailSuppressed,
    hideContent: prefs.hideContent,
  });
  if (!plan.inApp) return null;

  const at = new Date(nowMs);
  const inserted = db
    .insert(schema.notifications)
    .values({
      userId: user.id,
      type: content.type,
      title: content.title,
      body: content.body,
      url: content.url,
      entityType: null,
      entityId: null,
      payload: content.payload,
      priority: "normal",
      dedupeKey: `digest:${content.type}:${content.localDate}`,
      createdAt: at,
      updatedAt: at,
    })
    .onConflictDoNothing({ target: [schema.notifications.userId, schema.notifications.dedupeKey] })
    .returning({ id: schema.notifications.id })
    .all();
  if (inserted.length === 0) return null;
  const notificationId = inserted[0].id;

  const notBefore = plan.notBeforeMs !== null ? new Date(plan.notBeforeMs) : null;
  const rows: Array<typeof schema.notificationDeliveries.$inferInsert> = [];
  if (plan.channels.includes("web_push")) {
    for (const d of targets.webPushDevices) {
      rows.push({ notificationId, userId: user.id, channel: "web_push", deviceId: d.id, status: "pending", notBefore, createdAt: at, updatedAt: at });
    }
  }
  if (plan.channels.includes("fcm")) {
    for (const d of targets.fcmDevices) {
      rows.push({ notificationId, userId: user.id, channel: "fcm", deviceId: d.id, status: "pending", notBefore, createdAt: at, updatedAt: at });
    }
  }
  if (plan.channels.includes("email")) {
    rows.push({ notificationId, userId: user.id, channel: "email", deviceId: null, status: "pending", notBefore, createdAt: at, updatedAt: at });
  }
  if (rows.length > 0) {
    db.insert(schema.notificationDeliveries).values(rows).run();
  }
  publishNotification(user.id, notificationId);
  return notificationId;
}

async function tickUser(
  user: typeof schema.users.$inferSelect,
  prefs: typeof schema.notificationPrefs.$inferSelect,
  nowMs: number,
  stats: DigestTickStats
): Promise<void> {
  const tz = user.timezone || "UTC";
  const local = digestLocal(nowMs, tz);

  if (prefs.digestDailyEnabled && isDue(local, nowMs, prefs.digestTime)) {
    if (!claimDigestSlot(user.id, "daily", local.localDate, nowMs)) {
      stats.duplicates += 1;
    } else {
      const content = await buildDailyDigest(user.id, tz, nowMs);
      if (!content) {
        stats.skippedEmpty += 1;
      } else if (enqueueDigest(user, prefs, content, nowMs)) {
        stats.sent += 1;
        stats.notifications += 1;
      } else {
        stats.skippedEmpty += 1;
      }
    }
  }

  if (prefs.weeklyEnabled && local.weekdaySun0 === prefs.weeklyDay && isDue(local, nowMs, prefs.weeklyTime)) {
    if (!claimDigestSlot(user.id, "weekly", local.localDate, nowMs)) {
      stats.duplicates += 1;
    } else {
      const content = await buildWeeklyDigest(user.id, tz, nowMs, user.weekStartsOn ?? 1);
      if (!content) {
        stats.skippedEmpty += 1;
      } else if (enqueueDigest(user, prefs, content, nowMs)) {
        stats.sent += 1;
        stats.notifications += 1;
      } else {
        stats.skippedEmpty += 1;
      }
    }
  }
}

/**
 * Run one digest pass. Safe to call repeatedly (digest_log PK claim makes it
 * idempotent) and concurrently (in-flight guard).
 */
export async function runDigestTick(nowMs: number = now()): Promise<DigestTickStats> {
  const stats: DigestTickStats = {
    ran: false,
    checked: 0,
    sent: 0,
    skippedEmpty: 0,
    duplicates: 0,
    notifications: 0,
  };
  if (digestRunning) return stats;
  digestRunning = true;
  try {
    stats.ran = true;
    const cfg = getNotifyConfig();
    if (!cfg.enabled) return stats;

    const rows = db
      .select({ prefs: schema.notificationPrefs, user: schema.users })
      .from(schema.notificationPrefs)
      .innerJoin(schema.users, eq(schema.users.id, schema.notificationPrefs.userId))
      .where(
        or(eq(schema.notificationPrefs.digestDailyEnabled, true), eq(schema.notificationPrefs.weeklyEnabled, true))
      )
      .all();
    for (const row of rows) {
      stats.checked += 1;
      await tickUser(row.user, row.prefs, nowMs, stats);
    }
    return stats;
  } finally {
    digestRunning = false;
  }
}
