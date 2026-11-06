import { describe, expect, test } from "bun:test";
import { app } from "../src/index";
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

describe("notification prefs", () => {
  test("GET auto-creates defaults on first read", async () => {
    const { token } = await createAuthUser("NotifPrefs");
    const { status, json } = await req("GET", "/api/v1/notification-prefs", token);
    expect(status).toBe(200);
    expect(json.quietEnabled).toBe(false);
    expect(json.quietStart).toBe("22:00");
    expect(json.quietEnd).toBe("07:00");
    expect(json.digestTime).toBe("08:00");
    expect(json.pausedUntil).toBeNull();
  });

  test("PATCH updates prefs and rejects bad HH:MM", async () => {
    const { token } = await createAuthUser("NotifPrefs");
    const ok = await req("PATCH", "/api/v1/notification-prefs", token, {
      quietEnabled: true,
      quietStart: "23:00",
      digestDailyEnabled: true,
    });
    expect(ok.status).toBe(200);
    expect(ok.json.quietEnabled).toBe(true);
    expect(ok.json.quietStart).toBe("23:00");
    expect(ok.json.digestDailyEnabled).toBe(true);

    const bad = await req("PATCH", "/api/v1/notification-prefs", token, {
      quietStart: "25:99",
    });
    expect(bad.status).toBe(422);
  });

  test("pause and unpause", async () => {
    const { token } = await createAuthUser("NotifPrefs");
    const future = new Date(Date.now() + 3600_000).toISOString();
    const paused = await req("POST", "/api/v1/notifications/pause", token, { until: future });
    expect(paused.status).toBe(200);
    expect(paused.json.pausedUntil).toBe(future);

    const past = await req("POST", "/api/v1/notifications/pause", token, {
      until: new Date(Date.now() - 1000).toISOString(),
    });
    expect(past.status).toBe(400);

    const cleared = await req("DELETE", "/api/v1/notifications/pause", token);
    expect(cleared.status).toBe(200);
    expect(cleared.json.pausedUntil).toBeNull();
  });

  test("list notification rule requires ownership", async () => {
    const alice = await createAuthUser("NotifPrefs");
    const bob = await createAuthUser("NotifPrefs");

    const created = await req("POST", "/api/v1/lists", alice.token, { name: "Alerts" });
    expect(created.status).toBe(201);
    const listId = created.json.id as string;

    const set = await req("PUT", `/api/v1/lists/${listId}/notification-rule`, alice.token, {
      mode: "silent",
    });
    expect(set.status).toBe(200);
    expect(set.json.mode).toBe("silent");

    const stolen = await req("PUT", `/api/v1/lists/${listId}/notification-rule`, bob.token, {
      mode: "off",
    });
    expect(stolen.status).toBe(404);

    const missing = await req("PUT", "/api/v1/lists/does-not-exist/notification-rule", alice.token, {
      mode: "off",
    });
    expect(missing.status).toBe(404);
  });
});
