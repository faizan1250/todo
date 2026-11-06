import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { getNotifyConfig } from "../utils/notify-config";
import {
  addEmailSuppression,
  disableEmailChannel,
  handleResendEvent,
  verifySvixSignature,
  verifyUnsubscribeToken,
} from "../utils/notify-email";

/** Token from a JSON (`{token}`) or form-encoded (`token=`) POST body. */
async function readTokenFromBody(request: Request): Promise<string | null> {
  const ct = request.headers.get("content-type") ?? "";
  try {
    if (ct.includes("application/json")) {
      const parsed = (await request.json()) as { token?: unknown };
      return typeof parsed?.token === "string" && parsed.token !== "" ? parsed.token : null;
    }
    if (ct.includes("application/x-www-form-urlencoded")) {
      const form = await request.formData();
      const v = form.get("token");
      return typeof v === "string" && v !== "" ? v : null;
    }
  } catch {
    return null;
  }
  return null;
}

export const emailRoutes = new Elysia({ name: "routes-email" })
  // Public: the signed token is the credential (HMAC userId+email+expiry).
  .post(
    "/api/v1/email/unsubscribe",
    async ({ query, request, status }) => {
      const secret = getNotifyConfig().actionTokenSecret;
      if (!secret) {
        return status(503, { error: "Unsubscribe is unavailable" });
      }
      const token = query.token ?? (await readTokenFromBody(request));
      if (!token) {
        return status(400, { error: "Missing token" });
      }
      const claims = verifyUnsubscribeToken(token, secret);
      if (!claims) {
        return status(400, { error: "Invalid or expired token" });
      }
      const [user] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, claims.userId));
      if (!user || user.email.toLowerCase() !== claims.email.toLowerCase()) {
        return status(400, { error: "Invalid token" });
      }
      await addEmailSuppression(user.email, "unsubscribed");
      await disableEmailChannel(user.id);
      return { ok: true, email: user.email };
    },
    { query: t.Object({ token: t.Optional(t.String()) }) }
  )
  // Public: guarded by Svix signature over the RAW body, never auth.
  .post("/webhooks/resend", async ({ request, status }) => {
    const secret = getNotifyConfig().webhookSecret;
    if (!secret) {
      return status(503, { error: "Webhook not configured" });
    }
    const id = request.headers.get("svix-id") ?? "";
    const signature = request.headers.get("svix-signature") ?? "";
    const timestamp = request.headers.get("svix-timestamp") ?? "";
    if (!id || !signature || !timestamp) {
      return status(401, { error: "Missing webhook signature" });
    }
    const raw = await request.text();
    if (!verifySvixSignature({ rawBody: raw, id, signature, timestamp, secret })) {
      return status(401, { error: "Invalid webhook signature" });
    }
    let event: { type?: string; data?: Record<string, unknown> };
    try {
      event = JSON.parse(raw) as { type?: string; data?: Record<string, unknown> };
    } catch {
      return status(400, { error: "Invalid JSON" });
    }
    const outcome = await handleResendEvent(event);
    return { received: true, handled: outcome.handled, suppressed: outcome.suppressed };
  });
