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
}

export type SendOk = { ok: true; providerId?: string };
export type SendFail = {
  ok: false;
  errorCode: string;
  retryable: boolean;
  reason?: string;
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
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
        payload
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
      return { ok: false, errorCode: "send_failed", retryable: true, reason };
    }
  }
}

/** Generate a VAPID keypair (convenience re-export for tests/setup scripts). */
export function generateVapidKeys(): { publicKey: string; privateKey: string } {
  return webpush.generateVAPIDKeys();
}
