import { Type, type Static } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Phase 6 notification configuration.
 *
 * Read once at boot from env. Fail-soft: missing provider keys do NOT crash the
 * server — the corresponding channel is disabled and a warning is logged.
 * Only hard-fails on structurally invalid values (e.g. bad tick seconds).
 */
const NotifyConfigSchema = Type.Object({
  NOTIFICATIONS_ENABLED: Type.Optional(Type.Boolean()),
  APP_URL: Type.Optional(Type.String()),
  VAPID_PUBLIC_KEY: Type.Optional(Type.String()),
  VAPID_PRIVATE_KEY: Type.Optional(Type.String()),
  VAPID_SUBJECT: Type.Optional(Type.String()),
  FCM_PROJECT_ID: Type.Optional(Type.String()),
  FCM_CLIENT_EMAIL: Type.Optional(Type.String()),
  FCM_PRIVATE_KEY: Type.Optional(Type.String()),
  RESEND_API_KEY: Type.Optional(Type.String()),
  RESEND_FROM: Type.Optional(Type.String()),
  RESEND_WEBHOOK_SECRET: Type.Optional(Type.String()),
  ACTION_TOKEN_SECRET: Type.Optional(Type.String()),
  NOTIFY_TICK_SECONDS: Type.Optional(Type.Number()),
});

type RawConfig = Static<typeof NotifyConfigSchema>;

function parseBoolean(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === "") return undefined;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  throw new Error(`Invalid boolean env value: ${raw}`);
}

function parseNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid numeric env value: ${raw}`);
  return n;
}

function readRawEnv(e: NodeJS.ProcessEnv): RawConfig {
  return {
    NOTIFICATIONS_ENABLED: parseBoolean(e.NOTIFICATIONS_ENABLED),
    APP_URL: e.APP_URL || undefined,
    VAPID_PUBLIC_KEY: e.VAPID_PUBLIC_KEY || undefined,
    VAPID_PRIVATE_KEY: e.VAPID_PRIVATE_KEY || undefined,
    VAPID_SUBJECT: e.VAPID_SUBJECT || undefined,
    FCM_PROJECT_ID: e.FCM_PROJECT_ID || undefined,
    FCM_CLIENT_EMAIL: e.FCM_CLIENT_EMAIL || undefined,
    FCM_PRIVATE_KEY: e.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n") || undefined,
    RESEND_API_KEY: e.RESEND_API_KEY || undefined,
    RESEND_FROM: e.RESEND_FROM || undefined,
    RESEND_WEBHOOK_SECRET: e.RESEND_WEBHOOK_SECRET || undefined,
    ACTION_TOKEN_SECRET: e.ACTION_TOKEN_SECRET || undefined,
    NOTIFY_TICK_SECONDS: parseNumber(e.NOTIFY_TICK_SECONDS),
  };
}

export interface NotifyConfig {
  enabled: boolean;
  appUrl: string;
  tickSeconds: number;
  webPush: { publicKey: string; privateKey: string; subject: string } | null;
  fcm: { projectId: string; clientEmail: string; privateKey: string } | null;
  email: { apiKey: string; from: string } | null;
  webhookSecret: string | null;
  actionTokenSecret: string | null;
}

function toNotifyConfig(raw: RawConfig): NotifyConfig {
  const tick = raw.NOTIFY_TICK_SECONDS ?? 30;
  if (!Number.isInteger(tick) || tick < 5 || tick > 3600) {
    throw new Error(`NOTIFY_TICK_SECONDS must be an integer between 5 and 3600, got ${tick}`);
  }

  const hasVapid = Boolean(raw.VAPID_PUBLIC_KEY && raw.VAPID_PRIVATE_KEY);
  if (!hasVapid && (raw.VAPID_PUBLIC_KEY || raw.VAPID_PRIVATE_KEY)) {
    console.warn("[notify] VAPID keys incomplete — web_push channel disabled");
  }

  const hasFcm = Boolean(raw.FCM_PROJECT_ID && raw.FCM_CLIENT_EMAIL && raw.FCM_PRIVATE_KEY);
  if (!hasFcm && (raw.FCM_PROJECT_ID || raw.FCM_CLIENT_EMAIL || raw.FCM_PRIVATE_KEY)) {
    console.warn("[notify] FCM credentials incomplete — fcm channel disabled");
  }

  const hasEmail = Boolean(raw.RESEND_API_KEY && raw.RESEND_FROM);
  if (!hasEmail && (raw.RESEND_API_KEY || raw.RESEND_FROM)) {
    console.warn("[notify] Resend credentials incomplete — email channel disabled");
  }

  if (!raw.ACTION_TOKEN_SECRET) {
    console.warn("[notify] ACTION_TOKEN_SECRET not set — signed action links disabled");
  }

  const enabled = raw.NOTIFICATIONS_ENABLED ?? true;
  if (!enabled) {
    console.warn("[notify] NOTIFICATIONS_ENABLED=false — all notification channels disabled");
  }

  return {
    enabled,
    appUrl: raw.APP_URL ?? "http://localhost:3001",
    tickSeconds: tick,
    webPush: hasVapid
      ? {
          publicKey: raw.VAPID_PUBLIC_KEY!,
          privateKey: raw.VAPID_PRIVATE_KEY!,
          subject: raw.VAPID_SUBJECT ?? "mailto:admin@example.com",
        }
      : null,
    fcm: hasFcm
      ? {
          projectId: raw.FCM_PROJECT_ID!,
          clientEmail: raw.FCM_CLIENT_EMAIL!,
          privateKey: raw.FCM_PRIVATE_KEY!,
        }
      : null,
    email: hasEmail ? { apiKey: raw.RESEND_API_KEY!, from: raw.RESEND_FROM! } : null,
    webhookSecret: raw.RESEND_WEBHOOK_SECRET ?? null,
    actionTokenSecret: raw.ACTION_TOKEN_SECRET ?? null,
  };
}

export function loadNotifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyConfig {
  const raw = readRawEnv(env);
  if (!Value.Check(NotifyConfigSchema, raw)) {
    const errors = [...Value.Errors(NotifyConfigSchema, raw)].map((e) => e.message).join("; ");
    throw new Error(`Invalid notification config: ${errors}`);
  }
  return toNotifyConfig(raw);
}

let cached: NotifyConfig | null = null;

/** Read-once accessor used by providers/scheduler. Safe to call repeatedly. */
export function getNotifyConfig(): NotifyConfig {
  if (!cached) cached = loadNotifyConfig();
  return cached;
}

/** Test-only: reset the cached config so env changes take effect. */
export function resetNotifyConfig(): void {
  cached = null;
}
