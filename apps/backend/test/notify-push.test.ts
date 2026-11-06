import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../src/index";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { createAuthUser } from "./helpers";

const BASE = "http://localhost:3001";

async function req(
  method: string,
  path: string,
  token: string,
  body?: unknown
): Promise<{ status: number; json: any }> {
  const res = await app.handle(
    new Request(`${BASE}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
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

async function createDevice(token: string, name: string): Promise<string> {
  const deviceId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await app.handle(
    new Request(`${BASE}/api/v1/sync/devices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ deviceId, name, platform: "web" }),
    })
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`device create failed: ${res.status} ${await res.text()}`);
  }
  return deviceId;
}

const SUB = {
  endpoint: "https://push.example.com/sub/abc123",
  keys: { p256dh: "p256dh-key", auth: "auth-key" },
};

describe("push registration", () => {
  test("public key is null when VAPID unconfigured", async () => {
    const { status, json } = await req("GET", "/api/v1/push/public-key", "bogus");
    expect(status).toBe(200);
    expect(json.publicKey).toBeNull();
  });

  test("register, test-send, unregister", async () => {
    const { token } = await createAuthUser("NotifPush");
    const deviceId = await createDevice(token, "laptop");

    const put = await req("PUT", `/api/v1/devices/${deviceId}/push`, token, {
      subscription: SUB,
    });
    expect(put.status).toBe(200);
    expect(put.json.hasWebPush).toBe(true);
    expect(put.json.pushStatus).toBe("active");

    const both = await req("PUT", `/api/v1/devices/${deviceId}/push`, token, {
      subscription: SUB,
      fcmToken: "fcm-xyz",
    });
    expect(both.status).toBe(400);

    const tst = await req("POST", `/api/v1/devices/${deviceId}/push/test`, token);
    expect(tst.status).toBe(200);
    expect(tst.json.sent).toBe(true);
    expect(tst.json.channel).toBe("web_push");

    const del = await req("DELETE", `/api/v1/devices/${deviceId}/push`, token);
    expect(del.status).toBe(200);

    const tst2 = await req("POST", `/api/v1/devices/${deviceId}/push/test`, token);
    expect(tst2.status).toBe(400);
  });

  test("endpoint moves across users", async () => {
    const alice = await createAuthUser("NotifPush");
    const bob = await createAuthUser("NotifPush");
    const devA = await createDevice(alice.token, "alice-phone");
    const devB = await createDevice(bob.token, "bob-phone");

    const r1 = await req("PUT", `/api/v1/devices/${devA}/push`, alice.token, {
      subscription: SUB,
    });
    expect(r1.status).toBe(200);

    // Same endpoint now registered by Bob: credential moves to Bob's device.
    const r2 = await req("PUT", `/api/v1/devices/${devB}/push`, bob.token, {
      subscription: SUB,
    });
    expect(r2.status).toBe(200);
    expect(r2.json.hasWebPush).toBe(true);

    const [rowA] = await db
      .select()
      .from(schema.devices)
      .where(eq(schema.devices.id, devA));
    expect(rowA.webPushSub).toBeNull();
    expect(rowA.pushStatus).toBe("disabled");

    // Alice can no longer test-send on the moved credential.
    const tst = await req("POST", `/api/v1/devices/${devA}/push/test`, alice.token);
    expect(tst.status).toBe(400);
  });

  test("cross-user device access is 404", async () => {
    const alice = await createAuthUser("NotifPush");
    const bob = await createAuthUser("NotifPush");
    const devA = await createDevice(alice.token, "alice-tablet");

    const r = await req("PUT", `/api/v1/devices/${devA}/push`, bob.token, {
      fcmToken: "fcm-evil",
    });
    expect(r.status).toBe(404);
  });
});
