import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { parseRetryAfterMs, type NotifyProvider, type SendResult } from "./notify-providers";
import type { Rendered } from "./notify-render";

/**
 * Phase 6 email channel (Day 4).
 *
 * Branded Resend sends (inline styles, blue/pink accent) + plain-text part,
 * signed one-click unsubscribe tokens, Svix webhook verification, and the
 * suppression helpers shared by the unsubscribe + webhook routes.
 */

export const RESEND_API_URL = "https://api.resend.com/emails";
/** Long-lived so links in old emails keep working. */
export const UNSUB_TOKEN_TTL_MS = 2 * 365 * 24 * 3600 * 1000;
/** Svix replay window, per backend security standard. */
export const WEBHOOK_TOLERANCE_MS = 300_000;

/** Notification types whose prefs carry an email flag. */
export const EMAIL_PREF_KEYS = [
  "task_reminder",
  "task_overdue",
  "digest_daily",
  "digest_weekly",
  "reminder_summary",
  "away_summary",
] as const;

function b64urlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(input: string): Buffer {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

/** HMAC-signed `{userId, email, exp}` token. Tamper-proof, expiring. */
export function signUnsubscribeToken(
  userId: string,
  email: string,
  secret: string,
  ttlMs: number = UNSUB_TOKEN_TTL_MS,
  nowMs: number = Date.now()
): string {
  const payload = b64urlEncode(JSON.stringify({ u: userId, e: email, exp: nowMs + ttlMs }));
  const sig = b64urlEncode(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyUnsubscribeToken(
  token: string,
  secret: string,
  nowMs: number = Date.now()
): { userId: string; email: string } | null {
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const payload = token.slice(0, dot);
  const provided = token.slice(dot + 1);
  let providedBuf: Buffer;
  let expectedBuf: Buffer;
  try {
    providedBuf = b64urlDecode(provided);
    expectedBuf = createHmac("sha256", secret).update(payload).digest();
  } catch {
    return null;
  }
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;
  let claims: unknown;
  try {
    claims = JSON.parse(b64urlDecode(payload).toString("utf8"));
  } catch {
    return null;
  }
  if (typeof claims !== "object" || claims === null) return null;
  const { u, e, exp } = claims as Record<string, unknown>;
  if (typeof u !== "string" || u === "") return null;
  if (typeof e !== "string" || e === "") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp) || exp <= nowMs) return null;
  return { userId: u, email: e };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

/**
 * Branded HTML (inline styles, blue→pink accent bar) + plain-text fallback.
 * The unsubscribe URL is rendered in the footer when provided.
 */
export function renderEmail(
  message: Pick<Rendered, "title" | "body" | "url">,
  opts: { unsubscribeUrl?: string; ctaUrl?: string; appName?: string } = {}
): RenderedEmail {
  const appName = opts.appName ?? "Todo";
  const subject = message.title || "New notification";
  const body = message.body || "";
  const cta = opts.ctaUrl ?? message.url ?? null;
  const unsub = opts.unsubscribeUrl ?? null;
  const ctaHtml = cta
    ? `<div style="margin:20px 0 8px;"><a href="${escapeHtml(cta)}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;">Open in ${escapeHtml(appName)}</a></div>`
    : "";
  const unsubHtml = unsub
    ? `<p style="margin:16px 0 0;font-size:12px;color:#71717a;">You're receiving this because notifications are on for your account. <a href="${escapeHtml(unsub)}" style="color:#2563eb;">Unsubscribe</a></p>`
    : "";
  const html = `<!doctype html><html><body style="margin:0;padding:24px 12px;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;"><div style="max-width:560px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;"><div style="height:6px;background:linear-gradient(90deg,#2563eb,#ec4899);"></div><div style="padding:28px 28px 12px;"><h1 style="margin:0 0 12px;font-size:20px;line-height:1.4;color:#18181b;">${escapeHtml(subject)}</h1><p style="margin:0;font-size:14px;line-height:1.6;color:#3f3f46;">${escapeHtml(body)}</p>${ctaHtml}</div><div style="padding:16px 28px 24px;border-top:1px solid #f4f4f5;">${unsubHtml}<p style="margin:8px 0 0;font-size:12px;color:#a1a1aa;">${escapeHtml(appName)}</p></div></div></body></html>`;
  const lines = [subject, "", body];
  if (cta) lines.push("", `Open: ${cta}`);
  if (unsub) lines.push("", `Unsubscribe: ${unsub}`);
  return { subject, html, text: lines.join("\n") };
}

/** Insert an email_suppressions row; duplicate emails are a no-op. */
export async function addEmailSuppression(email: string, reason: string): Promise<void> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return;
  try {
    await db.insert(schema.emailSuppressions).values({ email: normalized, reason });
  } catch {
    // Duplicate suppression — already suppressed, nothing to do.
  }
}

/**
 * Turn the email channel off for a user: every known notification-type pref
 * gets `email: false`. Types absent from the map default to on, so each key
 * must be written explicitly.
 */
export async function disableEmailChannel(userId: string): Promise<void> {
  const [prefs] = await db
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId));
  const current = (prefs?.types ?? {}) as Record<string, { webPush?: boolean; email?: boolean }>;
  const next: Record<string, { webPush?: boolean; email?: boolean }> = { ...current };
  for (const key of EMAIL_PREF_KEYS) {
    next[key] = { ...(current[key] ?? {}), email: false };
  }
  if (!prefs) {
    try {
      await db.insert(schema.notificationPrefs).values({ userId, types: next });
    } catch {
      await db
        .update(schema.notificationPrefs)
        .set({ types: next, updatedAt: new Date() })
        .where(eq(schema.notificationPrefs.userId, userId));
    }
  } else {
    await db
      .update(schema.notificationPrefs)
      .set({ types: next, updatedAt: new Date() })
      .where(eq(schema.notificationPrefs.userId, userId));
  }
}

export type ResendOptions = {
  apiKey: string;
  from: string;
  appUrl: string;
  actionSecret: string | null;
  fetchImpl?: typeof fetch;
};

/**
 * Resend email provider. `fetchImpl` is injectable so the whole path
 * (request shape, idempotency key, tags, error mapping) is stub-testable.
 */
export class ResendProvider implements NotifyProvider {
  readonly channel = "email" as const;

  constructor(private readonly opts: ResendOptions) {
    if (!opts.apiKey || !opts.from) {
      throw new Error("ResendProvider requires apiKey and from");
    }
  }

  private get fetchImpl(): typeof fetch {
    return this.opts.fetchImpl ?? fetch;
  }

  async send(
    delivery: { notificationId: string; userId: string; deliveryId?: string | null; email?: string },
    message: Rendered
  ): Promise<SendResult> {
    if (!delivery.email) {
      return { ok: false, errorCode: "missing_email", retryable: false };
    }
    let unsubscribeUrl: string | undefined;
    if (this.opts.actionSecret) {
      const token = signUnsubscribeToken(delivery.userId, delivery.email, this.opts.actionSecret);
      unsubscribeUrl = `${this.opts.appUrl}/api/v1/email/unsubscribe?token=${encodeURIComponent(token)}`;
    }
    const ctaUrl =
      message.url && !/^https?:\/\//i.test(message.url) ? `${this.opts.appUrl}${message.url}` : message.url;
    const rendered = renderEmail(message, {
      unsubscribeUrl,
      ctaUrl: ctaUrl ?? undefined,
    });
    const deliveryId = delivery.deliveryId ?? delivery.notificationId;
    const headers: Record<string, string> = {};
    if (unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    let res: Response;
    try {
      res = await this.fetchImpl(RESEND_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Idempotency-Key": `notify-delivery:${deliveryId}`,
        },
        body: JSON.stringify({
          from: this.opts.from,
          to: [delivery.email],
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          tags: [
            { name: "delivery_id", value: deliveryId },
            { name: "notification_id", value: delivery.notificationId },
          ],
          ...(Object.keys(headers).length > 0 ? { headers } : {}),
        }),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, errorCode: "resend_network_error", retryable: true, reason };
    }
    if (res.ok) {
      let providerId: string | undefined;
      try {
        providerId = ((await res.json()) as { id?: string }).id;
      } catch {
        providerId = undefined;
      }
      return { ok: true, providerId };
    }
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      detail = "";
    }
    const reason = detail || `Resend send failed: HTTP ${res.status}`;
    if (res.status === 429) {
      return {
        ok: false,
        errorCode: "resend_rate_limited",
        retryable: true,
        reason,
        retryAfterMs: parseRetryAfterMs(Object.fromEntries(res.headers.entries())),
      };
    }
    if (res.status >= 500) {
      return { ok: false, errorCode: "resend_server_error", retryable: true, reason };
    }
    return { ok: false, errorCode: "resend_rejected", retryable: false, reason };
  }
}

/** Build the value for the `svix-signature` header (test + tooling use). */
export function signSvixPayload(
  rawBody: string,
  secret: string,
  id: string,
  timestamp: string
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  return `v1,${sig}`;
}

/**
 * Verify an Svix-style webhook signature against the RAW request body.
 * Enforces the ±300s replay window. All comparisons constant-time.
 */
export function verifySvixSignature(args: {
  rawBody: string;
  id: string;
  signature: string;
  timestamp: string;
  secret: string;
  nowMs?: number;
}): boolean {
  const { rawBody, id, signature, timestamp, secret } = args;
  const nowMs = args.nowMs ?? Date.now();
  if (!id || !signature || !timestamp) return false;
  const tsSec = Number(timestamp);
  if (!Number.isFinite(tsSec)) return false;
  if (Math.abs(nowMs - tsSec * 1000) > WEBHOOK_TOLERANCE_MS) return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    if (key.length === 0) return false;
  } catch {
    return false;
  }
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  for (const entry of signature.split(" ")) {
    const comma = entry.indexOf(",");
    if (comma <= 0) continue;
    if (entry.slice(0, comma) !== "v1") continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(entry.slice(comma + 1), "base64");
    } catch {
      continue;
    }
    if (candidate.length !== expected.length) continue;
    if (timingSafeEqual(candidate, expected)) return true;
  }
  return false;
}

export interface ResendEventOutcome {
  handled: boolean;
  suppressed: number;
}

/**
 * Apply a Resend webhook event. Hard bounces and complaints suppress the
 * recipient address and turn the user's email channel off. Soft/transient
 * bounces are acknowledged without suppression.
 */
export async function handleResendEvent(event: {
  type?: string;
  data?: Record<string, unknown>;
}): Promise<ResendEventOutcome> {
  const type = typeof event?.type === "string" ? event.type : "";
  if (type !== "email.bounced" && type !== "email.complained") {
    return { handled: false, suppressed: 0 };
  }
  const data = (event.data ?? {}) as Record<string, unknown>;
  if (type === "email.bounced") {
    const bounce = data["bounce"];
    const bounceType =
      typeof bounce === "object" && bounce !== null
        ? String((bounce as Record<string, unknown>)["type"] ?? "")
        : String(data["bounce_type"] ?? "");
    // Unknown bounce shape → treat as hard (fail-closed for reputation).
    // Explicitly soft/transient signals are skipped.
    if (bounceType !== "" && /soft|temporar|transient|grey|throttl|rate|mailboxfull|mailbox_full/i.test(bounceType)) {
      return { handled: true, suppressed: 0 };
    }
  }
  const rawTo = data["to"];
  const recipients: string[] = Array.isArray(rawTo)
    ? rawTo.filter((t): t is string => typeof t === "string")
    : typeof rawTo === "string"
      ? [rawTo]
      : [];
  const reason = type === "email.complained" ? "complaint" : "bounce";
  let suppressed = 0;
  for (const addr of recipients) {
    const normalized = addr.trim().toLowerCase();
    if (!normalized) continue;
    await addEmailSuppression(normalized, reason);
    const users = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(inArray(schema.users.email, [addr, normalized]));
    for (const u of users) {
      await disableEmailChannel(u.id);
    }
    suppressed += 1;
  }
  return { handled: true, suppressed };
}
