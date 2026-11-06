import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { now } from "./notify-clock";
import { getNotifyConfig } from "./notify-config";
import {
  FcmProvider,
  WebPushProvider,
  type Channel,
  type DeliveryInput,
  type NotifyProvider,
  type SendResult,
} from "./notify-providers";
import { ResendProvider } from "./notify-email";
import { publishNotification } from "./sync-publisher";

/**
 * Phase 6 delivery worker (Day 3).
 *
 * Owns the push-delivery outbox (`notification_deliveries` rows in
 * pending/retry). One run:
 *
 *   1. recover expired leases (sending + lease_until < now → pending)
 *   2. coalesce bursts (≥4 ready deliveries, same user+channel+device → one summary)
 *   3. claim due rows (atomic compare-and-set to sending, lease +120s)
 *   4. send with concurrency 5, 10s timeout, task-still-open recheck,
 *      hourly rate cap, backoff retries honoring Retry-After
 *
 * Email-channel rows go through the Resend provider (fail-soft without
 * credentials, suppressed when the address is suppressed).
 */

export const WORKER_BATCH_LIMIT = 50;
export const LEASE_MS = 120_000;
export const SEND_TIMEOUT_MS = 10_000;
export const WORKER_CONCURRENCY = 5;
/** Max push sends per user per rolling hour; excess stays in-app only. */
export const PUSH_HOURLY_CAP = 60;
/** Ready deliveries in one user+channel+device group that trigger a summary. */
export const COALESCE_THRESHOLD = 4;
/** Retry delays after attempt N (1-based): 30s, 2m, 10m, 1h, 3h, then failed. */
export const BACKOFF_MS = [30_000, 120_000, 600_000, 3_600_000, 10_800_000];
export const MAX_ATTEMPTS = BACKOFF_MS.length + 1;
export const REMINDER_TTL_S = 6 * 3600;
export const DIGEST_TTL_S = 24 * 3600;

export interface WorkerStats {
  ran: boolean;
  recovered: number;
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  suppressed: number;
  cancelled: number;
  coalesced: number;
  summaries: number;
}

export type ProviderOverrides = Partial<Record<Channel, NotifyProvider | null>>;

export interface RunWorkerOptions {
  providers?: ProviderOverrides;
  batchLimit?: number;
  coalesceThreshold?: number;
}

const PUSH_CHANNELS = ["web_push", "fcm"] as const;
const ALL_CHANNELS = ["web_push", "fcm", "email"] as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

type DeliveryRow = typeof schema.notificationDeliveries.$inferSelect;

let running = false;

const IDLE_STATS: WorkerStats = {
  ran: false,
  recovered: 0,
  claimed: 0,
  sent: 0,
  retried: 0,
  failed: 0,
  suppressed: 0,
  cancelled: 0,
  coalesced: 0,
  summaries: 0,
};

function readyPredicate(nowDate: Date) {
  return and(
    inArray(schema.notificationDeliveries.channel, [...ALL_CHANNELS]),
    or(
      eq(schema.notificationDeliveries.status, "pending"),
      and(
        eq(schema.notificationDeliveries.status, "retry"),
        lte(schema.notificationDeliveries.nextAttemptAt, nowDate)
      )
    ),
    or(
      isNull(schema.notificationDeliveries.notBefore),
      lte(schema.notificationDeliveries.notBefore, nowDate)
    )
  );
}

/** 1. Leases held past their expiry mean the previous worker died: requeue. */
function recoverExpiredLeases(tx: Tx, nowMs: number): number {
  const rows = tx
    .update(schema.notificationDeliveries)
    .set({ status: "pending", leaseUntil: null, updatedAt: new Date(nowMs) })
    .where(
      and(
        eq(schema.notificationDeliveries.status, "sending"),
        lte(schema.notificationDeliveries.leaseUntil, new Date(nowMs))
      )
    )
    .returning({ id: schema.notificationDeliveries.id })
    .all();
  return rows.length;
}

interface CoalesceResult {
  summaries: number;
  coalesced: number;
  published: Array<{ userId: string; notificationId: string }>;
}

/**
 * 2. Burst protection: ≥4 ready deliveries for one user+channel+device become
 * a single "N reminders: A, B, +M more" summary (→ /today). Originals are
 * marked suppressed; the summary gets one fresh pending delivery that the
 * claim phase below picks up in the same run.
 */
function coalesceReady(tx: Tx, nowMs: number, threshold: number): CoalesceResult {
  const nowDate = new Date(nowMs);
  const rows = tx
    .select({
      delivery: schema.notificationDeliveries,
      title: schema.notifications.title,
    })
    .from(schema.notificationDeliveries)
    .innerJoin(
      schema.notifications,
      eq(schema.notifications.id, schema.notificationDeliveries.notificationId)
    )
    .where(and(readyPredicate(nowDate), isNull(schema.notifications.deletedAt)))
    .orderBy(asc(schema.notificationDeliveries.createdAt))
    .all();

  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const d = row.delivery;
    if (!d.deviceId) continue;
    const key = `${d.userId}|${d.channel}|${d.deviceId}`;
    const g = groups.get(key);
    if (g) g.push(row);
    else groups.set(key, [row]);
  }

  const out: CoalesceResult = { summaries: 0, coalesced: 0, published: [] };
  for (const group of groups.values()) {
    if (group.length < threshold) continue;
    const first = group[0].delivery;
    const titles = group.map((r) => r.title);
    const shown = titles.slice(0, 2).map((t) => (t.length > 60 ? `${t.slice(0, 57)}...` : t));
    const rest = titles.length - shown.length;
    const body = rest > 0 ? `${shown.join(", ")}, +${rest} more` : shown.join(", ");
    const at = new Date(nowMs);
    const inserted = tx
      .insert(schema.notifications)
      .values({
        userId: first.userId,
        type: "reminder_summary",
        title: `${group.length} reminders`,
        body,
        url: "/today",
        entityType: null,
        entityId: null,
        payload: {
          kind: "reminder_summary",
          count: group.length,
          taskTitles: titles.slice(0, 10),
          notificationIds: group.map((r) => r.delivery.notificationId),
        },
        priority: "normal",
        dedupeKey: `coalesce:${first.userId}:${first.channel}:${first.deviceId}:${nowMs}`,
        createdAt: at,
        updatedAt: at,
      })
      .onConflictDoNothing({
        target: [schema.notifications.userId, schema.notifications.dedupeKey],
      })
      .returning({ id: schema.notifications.id })
      .all();
    // Same-ms rerun guard: leave the group for the next tick instead of
    // double-summarizing.
    if (inserted.length === 0) continue;
    const summaryId = inserted[0].id;
    tx.insert(schema.notificationDeliveries)
      .values({
        notificationId: summaryId,
        userId: first.userId,
        channel: first.channel,
        deviceId: first.deviceId,
        status: "pending",
        notBefore: null,
        createdAt: at,
        updatedAt: at,
      })
      .run();
    tx.update(schema.notificationDeliveries)
      .set({ status: "suppressed", reason: "coalesced", updatedAt: at })
      .where(
        inArray(
          schema.notificationDeliveries.id,
          group.map((r) => r.delivery.id)
        )
      )
      .run();
    out.summaries += 1;
    out.coalesced += group.length;
    out.published.push({ userId: first.userId, notificationId: summaryId });
  }
  return out;
}

/** 3. Atomic claim: only one worker (or run) wins each row. */
function claimReady(tx: Tx, nowMs: number, batchLimit: number): DeliveryRow[] {
  const nowDate = new Date(nowMs);
  const ready = tx
    .select()
    .from(schema.notificationDeliveries)
    .where(readyPredicate(nowDate))
    .orderBy(asc(schema.notificationDeliveries.createdAt))
    .limit(batchLimit)
    .all();
  const claimed: DeliveryRow[] = [];
  for (const row of ready) {
    const won = tx
      .update(schema.notificationDeliveries)
      .set({
        status: "sending",
        leaseUntil: new Date(nowMs + LEASE_MS),
        attempts: row.attempts + 1,
        updatedAt: nowDate,
      })
      .where(
        and(
          eq(schema.notificationDeliveries.id, row.id),
          inArray(schema.notificationDeliveries.status, ["pending", "retry"])
        )
      )
      .returning()
      .all();
    if (won.length === 1) claimed.push(won[0]);
  }
  return claimed;
}

function buildProviders(overrides?: ProviderOverrides): {
  web_push: NotifyProvider | null;
  fcm: NotifyProvider | null;
  email: NotifyProvider | null;
} {
  const cfg = getNotifyConfig();
  const fromCfg = {
    web_push: cfg.webPush
      ? new WebPushProvider({
          publicKey: cfg.webPush.publicKey,
          privateKey: cfg.webPush.privateKey,
          subject: cfg.webPush.subject,
        })
      : null,
    fcm: cfg.fcm
      ? new FcmProvider({
          projectId: cfg.fcm.projectId,
          clientEmail: cfg.fcm.clientEmail,
          privateKey: cfg.fcm.privateKey,
        })
      : null,
    email: cfg.email
      ? new ResendProvider({
          apiKey: cfg.email.apiKey,
          from: cfg.email.from,
          appUrl: cfg.appUrl,
          actionSecret: cfg.actionTokenSecret,
        })
      : null,
  };
  return {
    web_push: overrides?.web_push ?? fromCfg.web_push,
    fcm: overrides?.fcm ?? fromCfg.fcm,
    email: overrides?.email ?? fromCfg.email,
  };
}

/** Collapse key for push fan-out, `rem-` + short id, max 32 chars. */
export function topicFor(notificationId: string): string {
  return `rem-${notificationId.replace(/-/g, "").slice(0, 28)}`;
}

function ttlFor(notificationType: string | null): number {
  return notificationType === "digest_daily" || notificationType === "digest_weekly"
    ? DIGEST_TTL_S
    : REMINDER_TTL_S;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`send timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface SendOutcome {
  kind: "sent" | "retried" | "failed" | "suppressed" | "cancelled";
}

function markSent(deliveryId: string, nowMs: number, providerId: string | undefined): void {
  const at = new Date(nowMs);
  db.update(schema.notificationDeliveries)
    .set({ status: "sent", sentAt: at, leaseUntil: null, providerId, errorCode: null, updatedAt: at })
    .where(eq(schema.notificationDeliveries.id, deliveryId))
    .run();
}

function markRetried(
  deliveryId: string,
  nowMs: number,
  attempts: number,
  result: Extract<SendResult, { ok: false }>
): { exhausted: boolean } {
  const at = new Date(nowMs);
  if (attempts >= MAX_ATTEMPTS) {
    db.update(schema.notificationDeliveries)
      .set({
        status: "failed",
        reason: result.reason ?? result.errorCode,
        errorCode: result.errorCode,
        leaseUntil: null,
        updatedAt: at,
      })
      .where(eq(schema.notificationDeliveries.id, deliveryId))
      .run();
    return { exhausted: true };
  }
  const delay = result.retryAfterMs ?? BACKOFF_MS[attempts - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
  db.update(schema.notificationDeliveries)
    .set({
      status: "retry",
      reason: result.reason ?? result.errorCode,
      errorCode: result.errorCode,
      nextAttemptAt: new Date(nowMs + Math.min(Math.max(0, delay), 24 * 3600 * 1000)),
      leaseUntil: null,
      updatedAt: at,
    })
    .where(eq(schema.notificationDeliveries.id, deliveryId))
    .run();
  return { exhausted: false };
}

function markFailed(
  deliveryId: string,
  nowMs: number,
  result: Extract<SendResult, { ok: false }>
): void {
  const at = new Date(nowMs);
  db.update(schema.notificationDeliveries)
    .set({
      status: "failed",
      reason: result.reason ?? result.errorCode,
      errorCode: result.errorCode,
      leaseUntil: null,
      updatedAt: at,
    })
    .where(eq(schema.notificationDeliveries.id, deliveryId))
    .run();
}

function markSuppressed(deliveryId: string, nowMs: number, reason: string): void {
  db.update(schema.notificationDeliveries)
    .set({ status: "suppressed", reason, errorCode: reason, leaseUntil: null, updatedAt: new Date(nowMs) })
    .where(eq(schema.notificationDeliveries.id, deliveryId))
    .run();
}

function markCancelled(deliveryId: string, nowMs: number, reason: string): void {
  db.update(schema.notificationDeliveries)
    .set({ status: "cancelled", reason, leaseUntil: null, updatedAt: new Date(nowMs) })
    .where(eq(schema.notificationDeliveries.id, deliveryId))
    .run();
}

function bumpDeviceOnSend(deviceId: string, nowMs: number): void {
  db.update(schema.devices)
    .set({ lastPushAt: new Date(nowMs), pushFailures: 0 })
    .where(eq(schema.devices.id, deviceId))
    .run();
}

/**
 * Dead push targets are cleaned up, not retried: 410/404 web-push
 * subscriptions are removed, FCM UNREGISTERED/NOT_FOUND tokens deleted.
 */
function expireDevice(deviceId: string, channel: Channel): void {
  if (channel === "web_push") {
    db.update(schema.devices)
      .set({
        webPushSub: null,
        pushEndpointHash: null,
        pushEnabled: false,
        pushStatus: "expired",
      })
      .where(eq(schema.devices.id, deviceId))
      .run();
  } else {
    db.update(schema.devices)
      .set({
        fcmToken: null,
        pushEndpointHash: null,
        pushEnabled: false,
        pushStatus: "expired",
      })
      .where(eq(schema.devices.id, deviceId))
      .run();
  }
}

function bumpDeviceFailure(deviceId: string): void {
  db.update(schema.devices)
    .set({ pushFailures: sql`${schema.devices.pushFailures} + 1` })
    .where(eq(schema.devices.id, deviceId))
    .run();
}

async function sendOne(
  delivery: DeliveryRow,
  nowMs: number,
  providers: { web_push: NotifyProvider | null; fcm: NotifyProvider | null; email: NotifyProvider | null },
  hourlySent: Map<string, number>
): Promise<SendOutcome> {
  const notification = db
    .select()
    .from(schema.notifications)
    .where(eq(schema.notifications.id, delivery.notificationId))
    .get();
  if (!notification || notification.deletedAt) {
    markCancelled(delivery.id, nowMs, "notification_gone");
    return { kind: "cancelled" };
  }

  // Task-still-open recheck: the task may have been completed, deleted, or
  // archived after the scheduler enqueued this delivery.
  if (notification.entityType === "task" && notification.entityId) {
    const task = db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, notification.entityId))
      .get();
    if (
      !task ||
      task.deletedAt ||
      task.archivedAt ||
      task.status === "done" ||
      task.status === "cancelled"
    ) {
      markCancelled(delivery.id, nowMs, "task_closed");
      return { kind: "cancelled" };
    }
  }

  // Email rows have no device: resolve the address, honor the suppressions
  // list, and read hide_content here instead of the push-device path below.
  let emailAddr: string | null = null;
  let emailHideContent = false;
  if (delivery.channel === "email") {
    const [user] = db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, delivery.userId))
      .all();
    if (!user) {
      markCancelled(delivery.id, nowMs, "user_gone");
      return { kind: "cancelled" };
    }
    emailAddr = user.email;
    const lower = user.email.toLowerCase();
    const [suppression] = db
      .select({ email: schema.emailSuppressions.email })
      .from(schema.emailSuppressions)
      .where(
        inArray(
          schema.emailSuppressions.email,
          lower === user.email ? [user.email] : [user.email, lower]
        )
      )
      .all();
    if (suppression) {
      markSuppressed(delivery.id, nowMs, "email_suppressed");
      return { kind: "suppressed" };
    }
    const [prefs] = db
      .select()
      .from(schema.notificationPrefs)
      .where(eq(schema.notificationPrefs.userId, delivery.userId))
      .all();
    emailHideContent = prefs?.hideContent ?? false;
  }

  // Expired/disabled devices stop sending.
  const device = delivery.deviceId
    ? db.select().from(schema.devices).where(eq(schema.devices.id, delivery.deviceId)).get()
    : undefined;
  if (delivery.deviceId && (!device || !device.pushEnabled || device.pushStatus !== "active")) {
    markCancelled(delivery.id, nowMs, "device_inactive");
    return { kind: "cancelled" };
  }

  // Hourly push cap per user (web_push + fcm). Excess stays in-app only.
  if (delivery.channel === "web_push" || delivery.channel === "fcm") {
    let sent = hourlySent.get(delivery.userId);
    if (sent === undefined) {
      const rows = db
        .select({ id: schema.notificationDeliveries.id })
        .from(schema.notificationDeliveries)
        .where(
          and(
            eq(schema.notificationDeliveries.userId, delivery.userId),
            eq(schema.notificationDeliveries.status, "sent"),
            inArray(schema.notificationDeliveries.channel, [...PUSH_CHANNELS]),
            sql`${schema.notificationDeliveries.sentAt} >= ${nowMs - 3600_000}`
          )
        )
        .all();
      sent = rows.length;
      hourlySent.set(delivery.userId, sent);
    }
    if (sent >= PUSH_HOURLY_CAP) {
      markSuppressed(delivery.id, nowMs, "rate_limited");
      return { kind: "suppressed" };
    }
  }

  const provider =
    delivery.channel === "web_push"
      ? providers.web_push
      : delivery.channel === "fcm"
        ? providers.fcm
        : providers.email;
  if (!provider) {
    // Fail-soft: no credentials for this channel — inbox row already exists.
    markSuppressed(delivery.id, nowMs, "provider_disabled");
    return { kind: "suppressed" };
  }

  const input: DeliveryInput = {
    notificationId: notification.id,
    userId: delivery.userId,
    deviceId: delivery.deviceId,
    channel: delivery.channel,
    webPushSubscription: device?.webPushSub ?? undefined,
    fcmToken: device?.fcmToken ?? undefined,
    email: emailAddr ?? undefined,
    deliveryId: delivery.id,
    ttlSeconds: ttlFor(notification.type),
    urgency: notification.priority === "high" ? "high" : "normal",
    topic: topicFor(notification.id),
  };
  // hide_content redacts email send-time: generic subject, no task details.
  const message = emailHideContent
    ? {
        title: "You have a new notification",
        body: "Details are hidden by your notification settings. Open the app to view.",
        url: notification.url ?? undefined,
        tag: notification.id,
      }
    : {
        title: notification.title,
        body: notification.body ?? "",
        url: notification.url ?? undefined,
        tag: notification.id,
      };

  let result: SendResult;
  try {
    result = await withTimeout(provider.send(input, message), SEND_TIMEOUT_MS);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    result = { ok: false, errorCode: "send_timeout", retryable: true, reason };
  }

  if (result.ok) {
    markSent(delivery.id, nowMs, result.providerId);
    hourlySent.set(delivery.userId, (hourlySent.get(delivery.userId) ?? 0) + 1);
    if (delivery.deviceId) bumpDeviceOnSend(delivery.deviceId, nowMs);
    return { kind: "sent" };
  }

  if (!result.retryable) {
    markFailed(delivery.id, nowMs, result);
    if (
      delivery.deviceId &&
      (result.errorCode === "subscription_expired" || result.errorCode === "token_unregistered")
    ) {
      expireDevice(delivery.deviceId, delivery.channel);
    }
    return { kind: "failed" };
  }

  if (delivery.deviceId) bumpDeviceFailure(delivery.deviceId);
  const { exhausted } = markRetried(delivery.id, nowMs, delivery.attempts, result);
  return { kind: exhausted ? "failed" : "retried" };
}

/**
 * Run one delivery pass. Safe to call concurrently (in-flight guard) and
 * repeatedly (atomic claims make it idempotent).
 */
export async function runWorkerOnce(
  nowMs: number = now(),
  opts: RunWorkerOptions = {}
): Promise<WorkerStats> {
  if (running) {
    return { ...IDLE_STATS };
  }
  running = true;
  try {
    const stats: WorkerStats = { ...IDLE_STATS, ran: true };
    const providers = buildProviders(opts.providers);
    const hourlySent = new Map<string, number>();

    const published: Array<{ userId: string; notificationId: string }> = [];
    let claimed: DeliveryRow[] = [];
    db.transaction((tx: Tx) => {
      stats.recovered = recoverExpiredLeases(tx, nowMs);
      const coalesced = coalesceReady(tx, nowMs, opts.coalesceThreshold ?? COALESCE_THRESHOLD);
      stats.summaries = coalesced.summaries;
      stats.coalesced = coalesced.coalesced;
      stats.suppressed += coalesced.coalesced;
      published.push(...coalesced.published);
      claimed = claimReady(tx, nowMs, opts.batchLimit ?? WORKER_BATCH_LIMIT);
      stats.claimed = claimed.length;
    });

    const outcomes = await mapPool(claimed, WORKER_CONCURRENCY, (d) =>
      sendOne(d, nowMs, providers, hourlySent)
    );
    for (const o of outcomes) {
      if (o.kind === "sent") stats.sent += 1;
      else if (o.kind === "retried") stats.retried += 1;
      else if (o.kind === "failed") stats.failed += 1;
      else if (o.kind === "suppressed") stats.suppressed += 1;
      else stats.cancelled += 1;
    }

    for (const p of published) {
      publishNotification(p.userId, p.notificationId);
    }
    return stats;
  } finally {
    running = false;
  }
}

/**
 * Cancel pending/retry deliveries for tasks or a reminder. Called from
 * task complete/delete/archive and reminder snooze/dismiss/delete handlers.
 * Returns the number of deliveries cancelled.
 */
export function cancelPendingDeliveries(
  filter: { taskId?: string; taskIds?: string[]; reminderId?: string },
  nowMs: number = now()
): number {
  const at = new Date(nowMs);
  const pending = inArray(schema.notificationDeliveries.status, ["pending", "retry"]);
  if (filter.reminderId) {
    const rows = db
      .select({ id: schema.notificationDeliveries.id })
      .from(schema.notificationDeliveries)
      .innerJoin(
        schema.notifications,
        eq(schema.notifications.id, schema.notificationDeliveries.notificationId)
      )
      .where(
        and(
          pending,
          sql`json_extract(${schema.notifications.payload}, '$.reminderId') = ${filter.reminderId}`
        )
      )
      .all();
    if (rows.length === 0) return 0;
    const updated = db
      .update(schema.notificationDeliveries)
      .set({ status: "cancelled", reason: "reminder_cancelled", updatedAt: at })
      .where(
        and(
          inArray(
            schema.notificationDeliveries.id,
            rows.map((r) => r.id)
          ),
          pending
        )
      )
      .returning({ id: schema.notificationDeliveries.id })
      .all();
    return updated.length;
  }
  const taskIds = filter.taskIds ?? (filter.taskId ? [filter.taskId] : []);
  if (taskIds.length === 0) return 0;
  const notifIds = db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.entityType, "task"),
        inArray(schema.notifications.entityId, taskIds)
      )
    )
    .all()
    .map((r) => r.id);
  if (notifIds.length === 0) return 0;
  const updated = db
    .update(schema.notificationDeliveries)
    .set({ status: "cancelled", reason: "task_closed", updatedAt: at })
    .where(
      and(inArray(schema.notificationDeliveries.notificationId, notifIds), pending)
    )
    .returning({ id: schema.notificationDeliveries.id })
    .all();
  return updated.length;
}
