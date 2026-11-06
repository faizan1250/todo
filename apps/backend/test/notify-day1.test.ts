import { describe, expect, test } from "bun:test";
import { render } from "../src/utils/notify-render";
import { loadNotifyConfig, resetNotifyConfig } from "../src/utils/notify-config";
import { now, setNow, resetNow } from "../src/utils/notify-clock";
import { NoopProvider, WebPushProvider, generateVapidKeys } from "../src/utils/notify-providers";

describe("notify-render", () => {
  test("task title + due now without dueAt", () => {
    const r = render("task_reminder", { kind: "task_reminder", taskTitle: "Buy milk" }, { timezone: "UTC" });
    expect(r.title).toBe("Buy milk");
    expect(r.body).toBe("Due now");
  });

  test("due in 1 hour with user tz time", () => {
    const dueAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const r = render(
      "task_reminder",
      { kind: "task_reminder", taskId: "t1", taskTitle: "Standup", dueAt },
      { timezone: "America/New_York" }
    );
    expect(r.body).toMatch(/^Due in 1 hour \(.+\)$/);
  });

  test("due today / overdue wording", () => {
    const today = render("task_overdue", { kind: "task_overdue", taskTitle: "X", overdueDays: 0 }, { timezone: "UTC" });
    expect(today.body).toBe("Due today");
    const late = render("task_overdue", { kind: "task_overdue", taskTitle: "X", overdueDays: 3 }, { timezone: "UTC" });
    expect(late.body).toBe("Overdue by 3 days");
    const one = render("task_overdue", { kind: "task_overdue", taskTitle: "X", overdueDays: 1 }, { timezone: "UTC" });
    expect(one.body).toBe("Overdue by 1 day");
  });

  test("digest subject counts", () => {
    const r = render(
      "digest_daily",
      { kind: "digest_daily", dueCount: 5, overdueCount: 2, topTasks: ["a", "b"] },
      { timezone: "UTC" }
    );
    expect(r.title).toBe("Your day: 5 tasks, 2 overdue");
    expect(r.body).toBe("a, b");
  });
});

describe("notify-config", () => {
  test("defaults with empty env (fail-soft, providers disabled)", () => {
    const cfg = loadNotifyConfig({} as NodeJS.ProcessEnv);
    expect(cfg.enabled).toBe(true);
    expect(cfg.tickSeconds).toBe(30);
    expect(cfg.webPush).toBeNull();
    expect(cfg.fcm).toBeNull();
    expect(cfg.email).toBeNull();
    resetNotifyConfig();
  });

  test("invalid tick seconds throws", () => {
    expect(() => loadNotifyConfig({ NOTIFY_TICK_SECONDS: "abc" } as any)).toThrow();
    expect(() => loadNotifyConfig({ NOTIFY_TICK_SECONDS: "2" } as any)).toThrow();
    const cfg = loadNotifyConfig({ NOTIFY_TICK_SECONDS: "60" } as any);
    expect(cfg.tickSeconds).toBe(60);
    resetNotifyConfig();
  });
});

describe("notify-clock", () => {
  test("injectable now", () => {
    const real = now();
    setNow(real + 1000);
    expect(now()).toBe(real + 1000);
    resetNow();
    expect(Math.abs(now() - Date.now())).toBeLessThan(5000);
  });
});

describe("notify-providers", () => {
  test("web-push spike: import + construct (no real send)", () => {
    const { publicKey, privateKey } = generateVapidKeys();
    expect(publicKey.length).toBeGreaterThan(0);
    const provider = new WebPushProvider({
      publicKey,
      privateKey,
      subject: "mailto:test@example.com",
    });
    expect(provider.channel).toBe("web_push");
  });

  test("noop records sends; web-push reports missing subscription", async () => {
    const noop = new NoopProvider();
    const res = await noop.send(
      { notificationId: "n1", userId: "u1", deviceId: null, channel: "web_push" },
      { title: "hi", body: "there" }
    );
    expect(res.ok).toBe(true);
    expect(noop.sent).toHaveLength(1);

    const { publicKey, privateKey } = generateVapidKeys();
    const wp = new WebPushProvider({ publicKey, privateKey, subject: "mailto:test@example.com" });
    const missing = await wp.send(
      { notificationId: "n1", userId: "u1", deviceId: "d1", channel: "web_push" },
      { title: "hi", body: "there" }
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.retryable).toBe(false);
  });
});
