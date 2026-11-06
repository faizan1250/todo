import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { app } from "../src/index";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { resetNotifyConfig } from "../src/utils/notify-config";
import {
  ResendProvider,
  renderEmail,
  signSvixPayload,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
} from "../src/utils/notify-email";
import { runWorkerOnce } from "../src/utils/notify-worker";
import { createAuthUser } from "./helpers";

const BASE = "http://localhost:3001";
const T0 = Date.parse("2026-03-10T12:00:00Z");

const ACTION_SECRET = "test-action-token-secret";
const WEBHOOK_RAW_SECRET = "test-webhook-secret-key-32bytes!!";
const WEBHOOK_SECRET = `whsec_${Buffer.from(WEBHOOK_RAW_SECRET).toString("base64")}`;

const SAVED_ENV = {
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM: process.env.RESEND_FROM,
  ACTION_TOKEN_SECRET: process.env.ACTION_TOKEN_SECRET,
  RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
};

beforeEach(() => {
  process.env.RESEND_API_KEY = "test-resend-key";
  process.env.RESEND_FROM = "Todo <notify@example.com>";
  process.env.ACTION_TOKEN_SECRET = ACTION_SECRET;
  process.env.RESEND_WEBHOOK_SECRET = WEBHOOK_SECRET;
  resetNotifyConfig();
});

afterEach(() => {
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetNotifyConfig();
});

async function reqRaw(
  method: string,
  path: string,
  opts: { body?: string; contentType?: string; headers?: Record<string, string> } = {}
): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.contentType) headers["Content-Type"] = opts.contentType;
  const res = await app.handle(
    new Request(`${BASE}${path}`, { method, headers, body: opts.body })
  );
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function svixHeaders(rawBody: string, timestampSec?: number) {
  const ts = String(timestampSec ?? Math.floor(Date.now() / 1000));
  const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    "svix-id": id,
    "svix-signature": signSvixPayload(rawBody, WEBHOOK_SECRET, id, ts),
    "svix-timestamp": ts,
  };
}

async function makeEmailSetup(opts: { type?: string; title?: string; body?: string } = {}) {
  const auth = await createAuthUser("NotifyDay4");
  const userId = auth.user.id;
  const [notification] = await db
    .insert(schema.notifications)
    .values({
      userId,
      type: opts.type ?? "digest_daily",
      title: opts.title ?? "Your day: 2 tasks, 1 overdue",
      body: opts.body ?? "Water the plants, Pay rent",
      url: "/today",
      entityType: null,
      entityId: null,
      payload: { kind: "digest_daily", dueCount: 2, overdueCount: 1 },
      priority: "normal",
      dedupeKey: `day4:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    })
    .returning();
  const [delivery] = await db
    .insert(schema.notificationDeliveries)
    .values({
      notificationId: notification.id,
      userId,
      channel: "email",
      deviceId: null,
      status: "pending",
    })
    .returning();
  return { auth, userId, email: auth.user.email, notification, delivery };
}

type CapturedCall = { url: string; init: RequestInit };
function stubFetch(handler: (call: CapturedCall) => Response): typeof fetch {
  return (async (url: unknown, init?: RequestInit) => {
    captured.push({ url: String(url), init: init ?? {} });
    return handler(captured[captured.length - 1]);
  }) as unknown as typeof fetch;
}
let captured: CapturedCall[] = [];

function okResend(capturedCall: CapturedCall): Response {
  void capturedCall;
  return Response.json({ id: "email-id-123" });
}

function prefsTypes(userId: string): Record<string, { webPush?: boolean; email?: boolean }> {
  const row = db
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId))
    .get();
  return (row?.types ?? {}) as Record<string, { webPush?: boolean; email?: boolean }>;
}

function deliveryById(id: string) {
  return db.select().from(schema.notificationDeliveries).where(eq(schema.notificationDeliveries.id, id)).get();
}

function suppressionFor(email: string) {
  return db
    .select()
    .from(schema.emailSuppressions)
    .where(eq(schema.emailSuppressions.email, email.toLowerCase()))
    .get();
}

describe("email render", () => {
  test("branded html + text contain the unsubscribe link, content escaped", () => {
    const unsub = "http://localhost:3001/api/v1/email/unsubscribe?token=abc";
    const out = renderEmail(
      { title: "Water <plants> & more", body: "Due now", url: "/today" },
      { unsubscribeUrl: unsub, ctaUrl: "http://localhost:3001/today" }
    );
    expect(out.subject).toBe("Water <plants> & more");
    expect(out.html).toContain("linear-gradient(90deg,#2563eb,#ec4899)");
    expect(out.html).toContain('href="http://localhost:3001/today"');
    expect(out.html).toContain(`href="${unsub}"`);
    expect(out.html).toContain("Water &lt;plants&gt; &amp; more");
    expect(out.html).not.toContain("<plants>");
    expect(out.text).toContain(`Unsubscribe: ${unsub}`);
  });
});

describe("unsubscribe tokens", () => {
  test("round-trip verifies; tampered and expired tokens rejected", () => {
    const good = signUnsubscribeToken("u1", "a@example.com", ACTION_SECRET);
    expect(verifyUnsubscribeToken(good, ACTION_SECRET)).toEqual({
      userId: "u1",
      email: "a@example.com",
    });
    // Tamper with the payload half.
    const [payload, sig] = good.split(".");
    const tampered = `${payload.slice(0, -1)}${payload.endsWith("A") ? "B" : "A"}.${sig}`;
    expect(verifyUnsubscribeToken(tampered, ACTION_SECRET)).toBeNull();
    // Tamper with the signature half.
    expect(verifyUnsubscribeToken(`${payload}.${sig.slice(0, -1)}xx`, ACTION_SECRET)).toBeNull();
    // Wrong secret.
    expect(verifyUnsubscribeToken(good, "other-secret")).toBeNull();
    // Expired.
    const old = signUnsubscribeToken("u1", "a@example.com", ACTION_SECRET, -1000);
    expect(verifyUnsubscribeToken(old, ACTION_SECRET)).toBeNull();
    // Garbage.
    expect(verifyUnsubscribeToken("not-a-token", ACTION_SECRET)).toBeNull();
  });
});

describe("POST /api/v1/email/unsubscribe", () => {
  test("valid token flips email prefs off and suppresses the address", async () => {
    const { userId, email } = await makeEmailSetup();
    const token = signUnsubscribeToken(userId, email, ACTION_SECRET);
    const res = await reqRaw("POST", "/api/v1/email/unsubscribe", {
      body: JSON.stringify({ token }),
      contentType: "application/json",
    });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);

    const types = prefsTypes(userId);
    for (const key of ["task_reminder", "digest_daily", "digest_weekly"]) {
      expect(types[key]?.email).toBe(false);
    }
    expect(suppressionFor(email)?.reason).toBe("unsubscribed");

    // Query-param form also works.
    const again = await reqRaw(
      "POST",
      `/api/v1/email/unsubscribe?token=${encodeURIComponent(token)}`
    );
    expect(again.status).toBe(200);
  });

  test("tampered token is 400 and changes nothing", async () => {
    const { userId, email } = await makeEmailSetup();
    const token = signUnsubscribeToken(userId, email, ACTION_SECRET);
    const bad = `${token.slice(0, -2)}xx`;
    const res = await reqRaw("POST", "/api/v1/email/unsubscribe", {
      body: JSON.stringify({ token: bad }),
      contentType: "application/json",
    });
    expect(res.status).toBe(400);
    expect(suppressionFor(email)).toBeUndefined();
    expect(prefsTypes(userId)["task_reminder"]?.email).not.toBe(false);
  });

  test("missing token is 400", async () => {
    const res = await reqRaw("POST", "/api/v1/email/unsubscribe", {
      body: JSON.stringify({}),
      contentType: "application/json",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /webhooks/resend", () => {
  test("bad signature is 401 and changes nothing", async () => {
    const { userId, email } = await makeEmailSetup();
    const raw = JSON.stringify({
      type: "email.bounced",
      data: { to: [email], bounce: { type: "HardBounce" } },
    });
    const res = await reqRaw("POST", "/webhooks/resend", {
      body: raw,
      contentType: "application/json",
      headers: { "svix-id": "msg-1", "svix-signature": "v1,bogus", "svix-timestamp": String(Math.floor(Date.now() / 1000)) },
    });
    expect(res.status).toBe(401);
    expect(suppressionFor(email)).toBeUndefined();
    expect(prefsTypes(userId)["task_reminder"]?.email).not.toBe(false);
  });

  test("missing signature headers are 401", async () => {
    const raw = JSON.stringify({ type: "email.bounced", data: {} });
    const res = await reqRaw("POST", "/webhooks/resend", {
      body: raw,
      contentType: "application/json",
    });
    expect(res.status).toBe(401);
  });

  test("stale timestamp is 401 (replay window)", async () => {
    const raw = JSON.stringify({ type: "email.bounced", data: {} });
    const res = await reqRaw("POST", "/webhooks/resend", {
      body: raw,
      contentType: "application/json",
      headers: svixHeaders(raw, Math.floor(Date.now() / 1000) - 3600),
    });
    expect(res.status).toBe(401);
  });

  test("hard bounce suppresses the address and disables the email channel", async () => {
    const { userId, email } = await makeEmailSetup();
    const raw = JSON.stringify({
      type: "email.bounced",
      data: { email_id: "e1", from: "Todo <notify@example.com>", to: [email], bounce: { type: "HardBounce" } },
    });
    const res = await reqRaw("POST", "/webhooks/resend", {
      body: raw,
      contentType: "application/json",
      headers: svixHeaders(raw),
    });
    expect(res.status).toBe(200);
    expect(res.json.received).toBe(true);
    expect(suppressionFor(email)?.reason).toBe("bounce");
    const types = prefsTypes(userId);
    expect(types["task_reminder"]?.email).toBe(false);
    expect(types["digest_daily"]?.email).toBe(false);
  });

  test("complaint suppresses and disables", async () => {
    const { userId, email } = await makeEmailSetup();
    const raw = JSON.stringify({ type: "email.complained", data: { to: [email] } });
    const res = await reqRaw("POST", "/webhooks/resend", {
      body: raw,
      contentType: "application/json",
      headers: svixHeaders(raw),
    });
    expect(res.status).toBe(200);
    expect(suppressionFor(email)?.reason).toBe("complaint");
    expect(prefsTypes(userId)["task_reminder"]?.email).toBe(false);
  });

  test("soft bounce is acknowledged without suppression", async () => {
    const { userId, email } = await makeEmailSetup();
    const raw = JSON.stringify({
      type: "email.bounced",
      data: { to: [email], bounce: { type: "SoftBounce" } },
    });
    const res = await reqRaw("POST", "/webhooks/resend", {
      body: raw,
      contentType: "application/json",
      headers: svixHeaders(raw),
    });
    expect(res.status).toBe(200);
    expect(suppressionFor(email)).toBeUndefined();
    expect(prefsTypes(userId)["task_reminder"]?.email).not.toBe(false);
  });

  test("unknown event types are ignored", async () => {
    const raw = JSON.stringify({ type: "email.opened", data: { to: ["x@example.com"] } });
    const res = await reqRaw("POST", "/webhooks/resend", {
      body: raw,
      contentType: "application/json",
      headers: svixHeaders(raw),
    });
    expect(res.status).toBe(200);
    expect(res.json.handled).toBe(false);
  });
});

describe("worker email routing", () => {
  beforeEach(() => {
    captured = [];
    // Earlier tests in this file intentionally leave email deliveries pending
    // (route tests only need the user). Drain them so each worker test owns
    // exactly the rows it creates — all belong to this file's users.
    db.delete(schema.notificationDeliveries)
      .where(
        and(
          eq(schema.notificationDeliveries.channel, "email"),
          inArray(schema.notificationDeliveries.status, ["pending", "retry"])
        )
      )
      .run();
  });

  function emailProvider(fetchImpl: typeof fetch = stubFetch(okResend)) {
    return new ResendProvider({
      apiKey: "test-resend-key",
      from: "Todo <notify@example.com>",
      appUrl: "http://localhost:3001",
      actionSecret: ACTION_SECRET,
      fetchImpl,
    });
  }

  test("digest email sends with idempotency key, delivery tag, unsubscribe headers", async () => {
    const { delivery } = await makeEmailSetup({ type: "digest_daily" });
    const stats = await runWorkerOnce(T0, { providers: { email: emailProvider() } });
    expect(stats.sent).toBe(1);
    expect(captured).toHaveLength(1);

    const call = captured[0];
    expect(call.url).toBe("https://api.resend.com/emails");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe(`notify-delivery:${delivery.id}`);
    expect(headers["Authorization"]).toBe("Bearer test-resend-key");

    const body = JSON.parse(String(call.init.body)) as {
      subject: string;
      html: string;
      text: string;
      tags: Array<{ name: string; value: string }>;
      headers: Record<string, string>;
    };
    expect(body.tags).toContainEqual({ name: "delivery_id", value: delivery.id });
    expect(body.tags).toContainEqual({ name: "notification_id", value: delivery.notificationId });
    expect(body.headers["List-Unsubscribe"]).toContain("/api/v1/email/unsubscribe?token=");
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(body.html).toContain("/api/v1/email/unsubscribe?token=");
    expect(body.subject).toBe("Your day: 2 tasks, 1 overdue");

    const row = deliveryById(delivery.id)!;
    expect(row.status).toBe("sent");
    expect(row.providerId).toBe("email-id-123");
  });

  test("suppressed address never reaches Resend", async () => {
    const { delivery, email } = await makeEmailSetup();
    await db.insert(schema.emailSuppressions).values({ email: email.toLowerCase(), reason: "bounce" });
    const stats = await runWorkerOnce(T0, { providers: { email: emailProvider() } });
    expect(stats.suppressed).toBe(1);
    expect(captured).toHaveLength(0);
    const row = deliveryById(delivery.id)!;
    expect(row.status).toBe("suppressed");
    expect(row.reason).toBe("email_suppressed");
  });

  test("hide_content sends a generic subject without task details", async () => {
    const { userId, delivery } = await makeEmailSetup({ title: "Secret task title" });
    await db.insert(schema.notificationPrefs).values({ userId, hideContent: true });
    const stats = await runWorkerOnce(T0, { providers: { email: emailProvider() } });
    expect(stats.sent).toBe(1);
    expect(captured).toHaveLength(1);
    const body = JSON.parse(String(captured[0].init.body)) as { subject: string; html: string };
    expect(body.subject).toBe("You have a new notification");
    expect(body.subject).not.toContain("Secret task title");
    expect(body.html).not.toContain("Secret task title");
  });

  test("missing provider suppresses fail-soft", async () => {
    const { delivery } = await makeEmailSetup();
    const stats = await runWorkerOnce(T0, { providers: { email: null } });
    expect(stats.suppressed).toBe(1);
    expect(deliveryById(delivery.id)!.reason).toBe("provider_disabled");
  });

  test("resend 429 retries with the server delay", async () => {
    const { delivery } = await makeEmailSetup();
    const limited = emailProvider(
      stubFetch(() => new Response("{}", { status: 429, headers: { "retry-after": "90" } }))
    );
    const first = await runWorkerOnce(T0, { providers: { email: limited } });
    expect(first.retried).toBe(1);
    const row = deliveryById(delivery.id)!;
    expect(row.status).toBe("retry");
    expect(row.nextAttemptAt!.getTime()).toBe(T0 + 90_000);

    const sender = emailProvider();
    const late = await runWorkerOnce(T0 + 90_000, { providers: { email: sender } });
    expect(late.sent).toBe(1);
  });
});
