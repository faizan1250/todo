import { createSign } from "node:crypto";
import webpush from "web-push";
import type { Rendered } from "./notify-render";

export type Channel = "web_push" | "fcm" | "email";

export type DeliveryStatus =
  | "pending"
  | "sending"
  | "retry"
  | "sent"
  | "failed"
  | "cancelled"
  | "suppressed";

/** Channel-agnostic delivery target passed to providers. */
export interface DeliveryInput {
  notificationId: string;
  userId: string;
  deviceId: string | null;
  channel: Channel;
  webPushSubscription?: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  };
  fcmToken?: string;
  email?: string;
  /** Outbox row id. Used as the Resend idempotency key + delivery tag. */
  deliveryId?: string | null;
  /** Push TTL in seconds. Reminders 6h, digests 24h. */
  ttlSeconds?: number;
  /** Push urgency. High iff the notification priority is high (task priority 4). */
  urgency?: "very-low" | "low" | "normal" | "high";
  /** Collapse key, `rem-` + short hash, max 32 chars. */
  topic?: string;
}

export type SendOk = { ok: true; providerId?: string };
export type SendFail = {
  ok: false;
  errorCode: string;
  retryable: boolean;
  reason?: string;
  /** Server-asked delay (parsed Retry-After). Worker honors instead of backoff. */
  retryAfterMs?: number;
};
export type SendResult = SendOk | SendFail;

export interface NotifyProvider {
  readonly channel: Channel;
  send(delivery: DeliveryInput, message: Rendered): Promise<SendResult>;
}

/** Test/placeholder provider. Records sends in memory, always succeeds. */
export class NoopProvider implements NotifyProvider {
  readonly channel: Channel;
  sent: Array<{ delivery: DeliveryInput; message: Rendered }> = [];

  constructor(channel: Channel = "web_push") {
    this.channel = channel;
  }

  async send(delivery: DeliveryInput, message: Rendered): Promise<SendResult> {
    this.sent.push({ delivery, message });
    return { ok: true, providerId: "noop" };
  }
}

export type WebPushOptions = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

/**
 * Web-push provider backed by the `web-push` npm package (spike verified on Bun).
 * NOTE: `webpush.setVapidDetails` mutates the library-global VAPID config, so all
 * instances share the most recently constructed credentials. Single-tenant app:
 * acceptable for Day 1; revisit if multi-credential support is ever needed.
 */
export class WebPushProvider implements NotifyProvider {
  readonly channel: Channel = "web_push";

  constructor(opts: WebPushOptions) {
    if (!opts.publicKey || !opts.privateKey) {
      throw new Error("WebPushProvider requires VAPID public and private keys");
    }
    webpush.setVapidDetails(opts.subject, opts.publicKey, opts.privateKey);
  }

  async send(delivery: DeliveryInput, message: Rendered): Promise<SendResult> {
    const sub = delivery.webPushSubscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return { ok: false, errorCode: "missing_subscription", retryable: false };
    }
    const payload = JSON.stringify({
      title: message.title,
      body: message.body,
      url: message.url,
      tag: message.tag,
      actions: message.actions,
    });
    const options: { TTL?: number; urgency?: "very-low" | "low" | "normal" | "high"; topic?: string } = {};
    if (delivery.ttlSeconds !== undefined) options.TTL = delivery.ttlSeconds;
    if (delivery.urgency !== undefined) options.urgency = delivery.urgency;
    if (delivery.topic !== undefined) options.topic = delivery.topic;
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        payload,
        options
      );
      return { ok: true };
    } catch (err: unknown) {
      const statusCode =
        typeof err === "object" && err !== null && "statusCode" in err
          ? Number((err as { statusCode: unknown }).statusCode)
          : NaN;
      const reason = err instanceof Error ? err.message : String(err);
      // 404/410 = subscription gone (unsubscribed or expired): never retry.
      if (statusCode === 404 || statusCode === 410) {
        return { ok: false, errorCode: "subscription_expired", retryable: false, reason };
      }
      const headers =
        typeof err === "object" && err !== null && "headers" in err
          ? (err as { headers?: unknown }).headers
          : undefined;
      if (statusCode === 429) {
        return {
          ok: false,
          errorCode: "web_push_rate_limited",
          retryable: true,
          reason,
          retryAfterMs: parseRetryAfterMs(headers),
        };
      }
      if (Number.isFinite(statusCode) && statusCode >= 500) {
        return { ok: false, errorCode: "web_push_server_error", retryable: true, reason };
      }
      return { ok: false, errorCode: "send_failed", retryable: true, reason };
    }
  }
}

/**
 * Parse a Retry-After value (seconds or HTTP-date) into ms.
 * Returns undefined when absent/unparseable. Clamped to [0, 24h].
 */
export function parseRetryAfterMs(headers: unknown, nowMs: number = Date.now()): number | undefined {
  if (!headers || typeof headers !== "object") return undefined;
  const raw = (headers as Record<string, unknown>)["retry-after"];
  if (raw === undefined || raw === null) return undefined;
  const s = String(raw).trim();
  if (s === "") return undefined;
  let ms: number;
  if (/^\d+$/.test(s)) {
    ms = Number(s) * 1000;
  } else {
    const t = Date.parse(s);
    if (Number.isNaN(t)) return undefined;
    ms = t - nowMs;
  }
  if (!Number.isFinite(ms)) return undefined;
  return Math.min(Math.max(0, Math.round(ms)), 24 * 3600 * 1000);
}

/** Generate a VAPID keypair (convenience re-export for tests/setup scripts). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}

export type FcmOptions = {
  projectId: string;
  clientEmail: string;
  /** Service-account PEM private key. */
  privateKey: string;
};

const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
/** Google access tokens live 1h; refresh at 55min so sends never use an expired one. */
const FCM_TOKEN_TTL_MS = 55 * 60 * 1000;

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Self-signed JWT for the OAuth2 JWT-bearer grant (RS256, node:crypto only). */
function signServiceAccountJwt(clientEmail: string, privateKey: string): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({ iss: clientEmail, scope: FCM_SCOPE, aud: FCM_TOKEN_URL, iat, exp: iat + 3600 })
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer.sign(privateKey);
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * FCM HTTP v1 provider. `fetchImpl` is injectable so the whole code path
 * (token grant + send + error mapping) is testable with a stubbed fetch.
 */
export class FcmProvider implements NotifyProvider {
  readonly channel: Channel = "fcm";

  private accessToken: string | null = null;
  private accessTokenExpMs = 0;

  constructor(
    private readonly opts: FcmOptions,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    if (!opts.projectId || !opts.clientEmail || !opts.privateKey) {
      throw new Error("FcmProvider requires projectId, clientEmail, and privateKey");
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.accessTokenExpMs) {
      return this.accessToken;
    }
    const assertion = signServiceAccountJwt(this.opts.clientEmail, this.opts.privateKey);
    const res = await this.fetchImpl(FCM_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(assertion)}`,
    });
    if (!res.ok) {
      throw new Error(`FCM token grant failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new Error("FCM token grant returned no access_token");
    }
    this.accessToken = body.access_token;
    this.accessTokenExpMs = Date.now() + FCM_TOKEN_TTL_MS;
    return this.accessToken;
  }

  async send(delivery: DeliveryInput, message: Rendered): Promise<SendResult> {
    if (!delivery.fcmToken) {
      return { ok: false, errorCode: "missing_token", retryable: false };
    }
    let token: string;
    try {
      token = await this.getAccessToken();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, errorCode: "fcm_auth_failed", retryable: true, reason };
    }
    const fcmMessage: Record<string, unknown> = {
      token: delivery.fcmToken,
      notification: { title: message.title, body: message.body },
      data: { notificationId: delivery.notificationId },
    };
    if (delivery.urgency === "high") {
      fcmMessage.android = { priority: "HIGH" };
      fcmMessage.webpush = { headers: { Urgency: "high" } };
    }
    if (delivery.ttlSeconds !== undefined) {
      fcmMessage.android = { ...(fcmMessage.android as Record<string, unknown>), ttl: `${delivery.ttlSeconds}s` };
    }
    let res: Response;
    try {
      res = await this.fetchImpl(
        `https://fcm.googleapis.com/v1/projects/${this.opts.projectId}/messages:send`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ message: fcmMessage, validate_only: false }),
        }
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { ok: false, errorCode: "fcm_network_error", retryable: true, reason };
    }
    if (res.ok) {
      return { ok: true };
    }
    let status = "";
    let detail = "";
    try {
      const body = (await res.json()) as {
        error?: { status?: string; message?: string; details?: Array<{ type?: string; errorCode?: string }> };
      };
      status = body.error?.status ?? "";
      detail = body.error?.message ?? "";
      const codes = (body.error?.details ?? []).map((d) => d.errorCode ?? d.type ?? "");
      if (codes.some((c) => c === "UNREGISTERED")) status = "UNREGISTERED";
    } catch {
      // Non-JSON error body: fall through to HTTP-status mapping.
    }
    const reason = detail || `FCM send failed: HTTP ${res.status} ${status}`.trim();
    if (res.status === 404 || status === "NOT_FOUND" || status === "UNREGISTERED") {
      return { ok: false, errorCode: "token_unregistered", retryable: false, reason };
    }
    if (res.status === 429) {
      return {
        ok: false,
        errorCode: "fcm_rate_limited",
        retryable: true,
        reason,
        retryAfterMs: parseRetryAfterMs(Object.fromEntries(res.headers.entries())),
      };
    }
    if (res.status >= 500) {
      return { ok: false, errorCode: "fcm_server_error", retryable: true, reason };
    }
    return { ok: false, errorCode: "fcm_invalid", retryable: false, reason };
  }
}
