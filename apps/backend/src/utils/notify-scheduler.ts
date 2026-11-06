import { and, asc, eq, gt, isNull, lte } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { now } from "./notify-clock";
import { getNotifyConfig } from "./notify-config";
import { planDelivery, type ListRuleMode } from "./notify-policy";
import { render } from "./notify-render";
import { publishNotification } from "./sync-publisher";

/**
 * Phase 6 reminder scheduler (Day 2).
 *
 * Owns the 30s tick: claims due reminders with a compare-and-set
 * (`UPDATE ... WHERE fired_at IS NULL`, winner = changes === 1) inside a
 * transaction, then plans + enqueues one notification per win.
 *
 * Catch-up is driven by `scheduler_state.last_tick_at`:
 *   gap <= 15min        → fire normally
 *   15min < gap <= 12h  → one "While you were away" summary per user (no pushes)
 *   gap > 12h           → in-app notification only, no pushes
 */

export const TICK_LIMIT = 200;
export const NORMAL_MAX_GAP_MS = 15 * 60 * 1000;
export const CATCHUP_MAX_GAP_MS = 12 * 3600 * 1000;
export const LAST_TICK_KEY = "last_tick_at";

export type TickBucket = "normal" | "catchup" | "stale";

export interface TickStats {
  ran: boolean;
  bucket: TickBucket;
  gapMs: number | null;
  claimed: number;
  sent: number;
  skipped: number;
  coalesced: number;
  missed: number;
  notifications: number;
}

const IDLE_STATS = (bucket: TickBucket, gapMs: number | null): TickStats => ({
  ran: true,
  bucket,
  gapMs,
  claimed: 0,
  sent: 0,
  skipped: 0,
  coalesced: 0,
  missed: 0,
  notifications: 0,
});

let running = false;

type DueRow = {
  reminder: typeof schema.reminders.$inferSelect;
  task: typeof schema.tasks.$inferSelect | null;
};

// Sync transaction context (bun:sqlite). All work inside the tick uses the
// synchronous API so the whole tick is one atomic transaction.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function readLastTickMs(tx: Tx): number | null {
  const row = tx
    .select({ value: schema.schedulerState.value })
    .from(schema.schedulerState)
    .where(eq(schema.schedulerState.key, LAST_TICK_KEY))
    .get();
  if (!row?.value) return null;
  const n = Number(row.value);
  return Number.isFinite(n) ? n : null;
}

function writeLastTickMs(tx: Tx, nowMs: number): void {
  const at = new Date(nowMs);
  tx.insert(schema.schedulerState)
    .values({ key: LAST_TICK_KEY, value: String(nowMs), updatedAt: at })
    .onConflictDoUpdate({
      target: schema.schedulerState.key,
      set: { value: String(nowMs), updatedAt: at },
    })
    .run();
}

function setOutcome(tx: Tx, reminderId: string, outcome: string): void {
  tx.update(schema.reminders).set({ outcome }).where(eq(schema.reminders.id, reminderId)).run();
}

interface LoadedCtx {
  userId: string;
  listRule: ListRuleMode;
  timezone: string;
  email: string;
  taskTitle: string;
  taskPriority: number;
  listName: string | null;
  dueAtIso: string | null;
  prefs: typeof schema.notificationPrefs.$inferSelect;
  webPushDevices: Array<{ id: string }>;
  fcmDevices: Array<{ id: string }>;
  emailSuppressed: boolean;
}

type LoadResult = { skip: { outcome: "skipped_done" | "skipped_off" } } | { skip: null; ctx: LoadedCtx };

/** Skip rules + context loading. Returns a skip verdict or the full context. */
function enforceAndLoad(tx: Tx, row: DueRow): LoadResult {
  const { reminder, task } = row;
  if (!task || task.deletedAt || task.archivedAt || task.status === "done" || task.status === "cancelled") {
    return { skip: { outcome: "skipped_done" } };
  }
  const [list] = tx.select().from(schema.lists).where(eq(schema.lists.id, task.listId)).all();
  if (!list || list.deletedAt || list.archivedAt) {
    return { skip: { outcome: "skipped_off" } };
  }
  const [rule] = tx
    .select()
    .from(schema.listNotificationRules)
    .where(
      and(
        eq(schema.listNotificationRules.userId, reminder.userId),
        eq(schema.listNotificationRules.listId, task.listId)
      )
    )
    .all();
  if (rule?.mode === "off") {
    return { skip: { outcome: "skipped_off" } };
  }

  const [user] = tx.select().from(schema.users).where(eq(schema.users.id, reminder.userId)).all();
  if (!user) {
    return { skip: { outcome: "skipped_done" } };
  }

  let prefs = tx
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, reminder.userId))
    .get();
  if (!prefs) {
    try {
      tx.insert(schema.notificationPrefs).values({ userId: reminder.userId }).run();
    } catch {
      // Lost an insert race — fall through to re-read.
    }
    prefs =
      tx.select().from(schema.notificationPrefs).where(eq(schema.notificationPrefs.userId, reminder.userId)).get() ??
      undefined;
  }
  if (!prefs) {
    return { skip: { outcome: "skipped_off" } };
  }

  const devices = tx
    .select()
    .from(schema.devices)
    .where(and(eq(schema.devices.userId, reminder.userId), eq(schema.devices.pushEnabled, true)))
    .all();

  const [suppression] = tx
    .select({ email: schema.emailSuppressions.email })
    .from(schema.emailSuppressions)
    .where(eq(schema.emailSuppressions.email, user.email))
    .all();

  return {
    skip: null,
    ctx: {
      userId: reminder.userId,
      listRule: rule?.mode ?? "all",
      timezone: user.timezone || "UTC",
      email: user.email,
      taskTitle: task.title,
      taskPriority: task.priority ?? 0,
      listName: list.name ?? null,
      dueAtIso: task.dueAt ? task.dueAt.toISOString() : null,
      prefs,
      webPushDevices: devices.flatMap((d) => (d.webPushSub ? [{ id: d.id }] : [])),
      fcmDevices: devices.flatMap((d) => (d.fcmToken ? [{ id: d.id }] : [])),
      emailSuppressed: Boolean(suppression),
    },
  };
}

function insertNotification(
  tx: Tx,
  args: {
    userId: string;
    type: string;
    title: string;
    body: string;
    url: string | null;
    entityType: string | null;
    entityId: string | null;
    payload: Record<string, unknown>;
    priority: "normal" | "high";
    dedupeKey: string;
    nowMs: number;
  }
): string | null {
  const nowDate = new Date(args.nowMs);
  const rows = tx
    .insert(schema.notifications)
    .values({
      userId: args.userId,
      type: args.type,
      title: args.title,
      body: args.body,
      url: args.url,
      entityType: args.entityType,
      entityId: args.entityId,
      payload: args.payload,
      priority: args.priority,
      dedupeKey: args.dedupeKey,
      createdAt: nowDate,
      updatedAt: nowDate,
    })
    .onConflictDoNothing({
      target: [schema.notifications.userId, schema.notifications.dedupeKey],
    })
    .returning({ id: schema.notifications.id })
    .all();
  return rows[0]?.id ?? null;
}

function insertDeliveries(
  tx: Tx,
  args: {
    notificationId: string;
    userId: string;
    channels: Array<"web_push" | "fcm" | "email">;
    webPushDevices: Array<{ id: string }>;
    fcmDevices: Array<{ id: string }>;
    notBeforeMs: number | null;
    nowMs: number;
  }
): void {
  const nowDate = new Date(args.nowMs);
  const notBefore = args.notBeforeMs !== null ? new Date(args.notBeforeMs) : null;
  const rows: Array<typeof schema.notificationDeliveries.$inferInsert> = [];
  if (args.channels.includes("web_push")) {
    for (const d of args.webPushDevices) {
      rows.push({
        notificationId: args.notificationId,
        userId: args.userId,
        channel: "web_push",
        deviceId: d.id,
        status: "pending",
        notBefore,
        createdAt: nowDate,
        updatedAt: nowDate,
      });
    }
  }
  if (args.channels.includes("fcm")) {
    for (const d of args.fcmDevices) {
      rows.push({
        notificationId: args.notificationId,
        userId: args.userId,
        channel: "fcm",
        deviceId: d.id,
        status: "pending",
        notBefore,
        createdAt: nowDate,
        updatedAt: nowDate,
      });
    }
  }
  if (args.channels.includes("email")) {
    rows.push({
      notificationId: args.notificationId,
      userId: args.userId,
      channel: "email",
      deviceId: null,
      status: "pending",
      notBefore,
      createdAt: nowDate,
      updatedAt: nowDate,
    });
  }
  if (rows.length > 0) {
    tx.insert(schema.notificationDeliveries).values(rows).run();
  }
}

function taskReminderPayload(row: DueRow, ctx: LoadedCtx): Record<string, unknown> {
  return {
    kind: "task_reminder",
    taskId: row.task!.id,
    taskTitle: ctx.taskTitle,
    dueAt: ctx.dueAtIso,
    listName: ctx.listName,
  };
}

/** Full normal-path fire for one claimed reminder. Returns notification id or null. */
function fireNormal(
  tx: Tx,
  row: DueRow,
  ctx: LoadedCtx,
  nowMs: number,
  cfgEnabled: boolean
): { outcome: "sent" | "skipped_off"; notificationId: string | null } {
  const plan = planDelivery({
    notificationsEnabled: cfgEnabled,
    pausedUntilMs: ctx.prefs.pausedUntil ? ctx.prefs.pausedUntil.getTime() : null,
    nowMs,
    typePref: (ctx.prefs.types as Record<string, { webPush?: boolean; email?: boolean }>)?.["task_reminder"],
    listRule: ctx.listRule,
    quiet: {
      enabled: ctx.prefs.quietEnabled,
      start: ctx.prefs.quietStart,
      end: ctx.prefs.quietEnd,
      urgentBreaksQuiet: ctx.prefs.urgentBreaksQuiet,
    },
    timezone: ctx.timezone,
    priority: ctx.taskPriority,
    hasWebPushTarget: ctx.webPushDevices.length > 0,
    hasFcmTarget: ctx.fcmDevices.length > 0,
    hasEmailTarget: Boolean(ctx.email),
    emailSuppressed: ctx.emailSuppressed,
    hideContent: ctx.prefs.hideContent,
  });

  if (!plan.inApp) {
    return { outcome: "skipped_off", notificationId: null };
  }

  const rendered = render(
    "task_reminder",
    {
      kind: "task_reminder",
      taskId: row.task!.id,
      taskTitle: ctx.taskTitle,
      dueAt: ctx.dueAtIso,
      listName: ctx.listName,
    },
    { timezone: ctx.timezone }
  );
  const notificationId = insertNotification(tx, {
    userId: ctx.userId,
    type: "task_reminder",
    title: rendered.title,
    body: rendered.body,
    url: `/tasks/${row.task!.id}`,
    entityType: "task",
    entityId: row.task!.id,
    payload: taskReminderPayload(row, ctx),
    priority: ctx.taskPriority >= 4 ? "high" : "normal",
    dedupeKey: `rem:${row.reminder.id}:${row.reminder.remindAt.getTime()}`,
    nowMs,
  });
  if (notificationId) {
    insertDeliveries(tx, {
      notificationId,
      userId: ctx.userId,
      channels: plan.channels,
      webPushDevices: ctx.webPushDevices,
      fcmDevices: ctx.fcmDevices,
      notBeforeMs: plan.notBeforeMs,
      nowMs,
    });
  }
  return { outcome: "sent", notificationId };
}

/** In-app-only fire (stale bucket): notification row, no deliveries. */
function fireInAppOnly(tx: Tx, row: DueRow, ctx: LoadedCtx, nowMs: number): string | null {
  const rendered = render(
    "task_reminder",
    {
      kind: "task_reminder",
      taskId: row.task!.id,
      taskTitle: ctx.taskTitle,
      dueAt: ctx.dueAtIso,
      listName: ctx.listName,
    },
    { timezone: ctx.timezone }
  );
  return insertNotification(tx, {
    userId: ctx.userId,
    type: "task_reminder",
    title: rendered.title,
    body: rendered.body,
    url: `/tasks/${row.task!.id}`,
    entityType: "task",
    entityId: row.task!.id,
    payload: taskReminderPayload(row, ctx),
    priority: ctx.taskPriority >= 4 ? "high" : "normal",
    dedupeKey: `rem:${row.reminder.id}:${row.reminder.remindAt.getTime()}`,
    nowMs,
  });
}

/**
 * Run one scheduler tick. Safe to call concurrently (in-flight guard) and
 * repeatedly (CAS claim + dedupeKey unique guard make it idempotent).
 */
export async function runTick(nowMs: number = now()): Promise<TickStats> {
  if (running) {
    return { ...IDLE_STATS("normal", null), ran: false };
  }
  running = true;
  try {
    const cfg = getNotifyConfig();
    if (!cfg.enabled) {
      // Kill switch: do not process and do not advance last_tick_at, so that
      // re-enabling falls into a catch-up bucket instead of firing the backlog.
      return { ...IDLE_STATS("normal", null), ran: true };
    }

    const published: Array<{ userId: string; notificationId: string }> = [];
    const stats: TickStats = { ...IDLE_STATS("normal", 0) };

    db.transaction((tx: Tx) => {
      const lastTick = readLastTickMs(tx);
      const gapMs = lastTick === null ? 0 : Math.max(0, nowMs - lastTick);
      const bucket: TickBucket =
        lastTick === null || gapMs <= NORMAL_MAX_GAP_MS
          ? "normal"
          : gapMs <= CATCHUP_MAX_GAP_MS
            ? "catchup"
            : "stale";
      stats.bucket = bucket;
      stats.gapMs = lastTick === null ? null : gapMs;
      writeLastTickMs(tx, nowMs);

      const due = tx
        .select({ reminder: schema.reminders, task: schema.tasks })
        .from(schema.reminders)
        .leftJoin(schema.tasks, eq(schema.tasks.id, schema.reminders.taskId))
        .where(
          and(
            isNull(schema.reminders.firedAt),
            gt(schema.reminders.remindAt, new Date(0)),
            lte(schema.reminders.remindAt, new Date(nowMs))
          )
        )
        .orderBy(asc(schema.reminders.remindAt))
        .limit(TICK_LIMIT)
        .all() as DueRow[];

      // Compare-and-set claim: only the winner (one returned row) processes.
      const claimed: DueRow[] = [];
      for (const row of due) {
        const won = tx
          .update(schema.reminders)
          .set({ firedAt: new Date(nowMs) })
          .where(and(eq(schema.reminders.id, row.reminder.id), isNull(schema.reminders.firedAt)))
          .returning({ id: schema.reminders.id })
          .all();
        if (won.length === 1) {
          claimed.push(row);
        }
      }
      stats.claimed = claimed.length;

      if (bucket === "catchup") {
        // Group wins by user: skips still apply, the rest coalesce into one
        // summary notification per user (no push deliveries).
        const groups = new Map<string, { rows: DueRow[]; ctx: LoadedCtx }>();
        for (const row of claimed) {
          const loaded = enforceAndLoad(tx, row);
          if (loaded.skip) {
            setOutcome(tx, row.reminder.id, loaded.skip.outcome);
            stats.skipped += 1;
            continue;
          }
          const c = loaded.ctx;
          let g = groups.get(c.userId);
          if (!g) {
            g = { rows: [], ctx: c };
            groups.set(c.userId, g);
          }
          g.rows.push(row);
        }
        for (const [, g] of groups) {
          const titles = g.rows.map((r) => (r.task ? r.task.title : "Task"));
          const shown = titles.slice(0, 3).join(", ");
          const extra = titles.length > 3 ? ` and ${titles.length - 3} more` : "";
          const id = insertNotification(tx, {
            userId: g.ctx.userId,
            type: "away_summary",
            title: "While you were away",
            body: `${titles.length} reminder${titles.length === 1 ? "" : "s"}: ${shown}${extra}`,
            url: null,
            entityType: null,
            entityId: null,
            payload: {
              kind: "away_summary",
              count: titles.length,
              taskTitles: titles.slice(0, 10),
              reminderIds: g.rows.map((r) => r.reminder.id),
            },
            priority: "normal",
            dedupeKey: `away:${g.ctx.userId}:${nowMs}`,
            nowMs,
          });
          for (const r of g.rows) {
            setOutcome(tx, r.reminder.id, "coalesced");
            stats.coalesced += 1;
          }
          if (id) {
            stats.notifications += 1;
            published.push({ userId: g.ctx.userId, notificationId: id });
          }
        }
        return;
      }

      for (const row of claimed) {
        const loaded = enforceAndLoad(tx, row);
        if (loaded.skip) {
          setOutcome(tx, row.reminder.id, loaded.skip.outcome);
          stats.skipped += 1;
          continue;
        }
        const ctx = loaded.ctx;

        if (bucket === "stale") {
          const id = fireInAppOnly(tx, row, ctx, nowMs);
          setOutcome(tx, row.reminder.id, "missed");
          stats.missed += 1;
          if (id) {
            stats.notifications += 1;
            published.push({ userId: ctx.userId, notificationId: id });
          }
          continue;
        }

        const fired = fireNormal(tx, row, ctx, nowMs, cfg.enabled);
        setOutcome(tx, row.reminder.id, fired.outcome);
        if (fired.outcome === "sent") stats.sent += 1;
        else stats.skipped += 1;
        if (fired.notificationId) {
          stats.notifications += 1;
          published.push({ userId: ctx.userId, notificationId: fired.notificationId });
        }
      }
    });

    for (const p of published) {
      publishNotification(p.userId, p.notificationId);
    }
    return stats;
  } finally {
    running = false;
  }
}

/**
 * Nudge the scheduler after a reminder write. Fire-and-forget: never throws,
 * never blocks the write path. The tick itself is cheap (one indexed scan)
 * and idempotent when nothing is due.
 */
export function nudge(): void {
  try {
    void runTick().catch((err) => {
      console.error("[notify] nudge tick failed", err);
    });
  } catch (err) {
    console.error("[notify] nudge tick failed", err);
  }
}
