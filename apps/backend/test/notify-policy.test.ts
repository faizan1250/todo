import { describe, expect, test } from "bun:test";
import { evaluateQuietHours, planDelivery, type PlanInput } from "../src/utils/notify-policy";

function base(over: Partial<PlanInput> = {}): PlanInput {
  return {
    notificationsEnabled: true,
    pausedUntilMs: null,
    nowMs: Date.parse("2026-01-15T12:00:00Z"),
    typePref: undefined,
    listRule: "all",
    quiet: { enabled: false, start: "22:00", end: "07:00", urgentBreaksQuiet: false },
    timezone: "UTC",
    priority: 0,
    hasWebPushTarget: true,
    hasFcmTarget: false,
    hasEmailTarget: true,
    emailSuppressed: false,
    hideContent: false,
    ...over,
  };
}

describe("planDelivery matrix", () => {
  test("kill switch suppresses everything including in-app", () => {
    const r = planDelivery(base({ notificationsEnabled: false }));
    expect(r.inApp).toBe(false);
    expect(r.channels).toEqual([]);
    expect(r.suppressed).toEqual(["kill_switch"]);
  });

  test("paused keeps inbox, drops pushes", () => {
    const nowMs = Date.parse("2026-01-15T12:00:00Z");
    const r = planDelivery(base({ nowMs, pausedUntilMs: nowMs + 3600_000 }));
    expect(r.inApp).toBe(true);
    expect(r.channels).toEqual([]);
    expect(r.suppressed).toEqual(["paused"]);
  });

  test("expired pause proceeds normally", () => {
    const nowMs = Date.parse("2026-01-15T12:00:00Z");
    const r = planDelivery(base({ nowMs, pausedUntilMs: nowMs - 1000 }));
    expect(r.inApp).toBe(true);
    expect(r.channels).toContain("web_push");
    expect(r.suppressed).not.toContain("paused");
  });

  test("type prefs off for both channels keeps inbox only", () => {
    const r = planDelivery(base({ typePref: { webPush: false, email: false } }));
    expect(r.inApp).toBe(true);
    expect(r.channels).toEqual([]);
    expect(r.suppressed).toContain("type_off_web");
    expect(r.suppressed).toContain("type_off_email");
  });

  test("type pref email off keeps web push", () => {
    const r = planDelivery(base({ typePref: { webPush: true, email: false } }));
    expect(r.channels).toEqual(["web_push"]);
  });

  test("list off suppresses everything", () => {
    const r = planDelivery(base({ listRule: "off" }));
    expect(r.inApp).toBe(false);
    expect(r.channels).toEqual([]);
    expect(r.suppressed).toEqual(["list_off"]);
  });

  test("list silent keeps inbox, drops pushes", () => {
    const r = planDelivery(base({ listRule: "silent" }));
    expect(r.inApp).toBe(true);
    expect(r.channels).toEqual([]);
    expect(r.suppressed).toEqual(["list_silent"]);
  });

  test("missing targets are reported, reachable channels kept", () => {
    const r = planDelivery(base({ hasWebPushTarget: false, hasFcmTarget: true }));
    expect(r.channels).toEqual(["fcm", "email"]);
    expect(r.suppressed).toContain("no_web_push_target");
    expect(r.suppressed).not.toContain("no_fcm_target");
  });

  test("email suppression drops email only", () => {
    const r = planDelivery(base({ emailSuppressed: true }));
    expect(r.channels).toEqual(["web_push"]);
    expect(r.suppressed).toContain("email_suppressed");
  });

  test("no targets at all still creates inbox row", () => {
    const r = planDelivery(base({ hasWebPushTarget: false, hasFcmTarget: false, hasEmailTarget: false }));
    expect(r.inApp).toBe(true);
    expect(r.channels).toEqual([]);
  });

  test("hideContent passes through", () => {
    expect(planDelivery(base({ hideContent: true })).hideContent).toBe(true);
    expect(planDelivery(base()).hideContent).toBe(false);
  });
});

describe("quiet hours", () => {
  const quiet = { enabled: true, start: "22:00", end: "07:00", urgentBreaksQuiet: false };

  test("inside cross-midnight window defers to 07:00 next day", () => {
    const nowMs = Date.parse("2026-01-15T23:30:00Z");
    const r = planDelivery(base({ nowMs, quiet }));
    expect(r.inApp).toBe(true);
    expect(r.channels).toEqual(["web_push", "email"]);
    expect(r.suppressed).toContain("quiet_hours");
    expect(r.notBeforeMs).toBe(Date.parse("2026-01-16T07:00:00Z"));
  });

  test("early-morning half defers to 07:00 same day", () => {
    const nowMs = Date.parse("2026-01-16T06:00:00Z");
    const r = planDelivery(base({ nowMs, quiet }));
    expect(r.suppressed).toContain("quiet_hours");
    expect(r.notBeforeMs).toBe(Date.parse("2026-01-16T07:00:00Z"));
  });

  test("outside window fires immediately", () => {
    const nowMs = Date.parse("2026-01-15T12:00:00Z");
    const r = planDelivery(base({ nowMs, quiet }));
    expect(r.suppressed).not.toContain("quiet_hours");
    expect(r.notBeforeMs).toBeNull();
  });

  test("urgent breaks quiet only when allowed", () => {
    const nowMs = Date.parse("2026-01-15T23:30:00Z");
    const breaking = planDelivery(base({ nowMs, priority: 4, quiet: { ...quiet, urgentBreaksQuiet: true } }));
    expect(breaking.suppressed).not.toContain("quiet_hours");
    expect(breaking.notBeforeMs).toBeNull();

    const held = planDelivery(base({ nowMs, priority: 4, quiet }));
    expect(held.suppressed).toContain("quiet_hours");

    const normal = planDelivery(base({ nowMs, priority: 3, quiet: { ...quiet, urgentBreaksQuiet: true } }));
    expect(normal.suppressed).toContain("quiet_hours");
  });

  test("same-day window", () => {
    const q = { enabled: true, start: "13:00", end: "14:00", urgentBreaksQuiet: false };
    const inside = planDelivery(base({ nowMs: Date.parse("2026-01-15T13:30:00Z"), quiet: q }));
    expect(inside.suppressed).toContain("quiet_hours");
    expect(inside.notBeforeMs).toBe(Date.parse("2026-01-15T14:00:00Z"));
    const outside = planDelivery(base({ nowMs: Date.parse("2026-01-15T12:59:00Z"), quiet: q }));
    expect(outside.suppressed).not.toContain("quiet_hours");
  });

  test("start == end means never quiet", () => {
    const q = evaluateQuietHours(Date.parse("2026-01-15T12:00:00Z"), "UTC", "22:00", "22:00");
    expect(q.inQuiet).toBe(false);
  });

  test("invalid tz falls back to UTC, invalid HH:MM fails open", () => {
    const nowMs = Date.parse("2026-01-15T23:30:00Z");
    const tzFallback = evaluateQuietHours(nowMs, "Not/AZone", "22:00", "07:00");
    expect(tzFallback.inQuiet).toBe(true);
    const badWindow = evaluateQuietHours(nowMs, "UTC", "25:99", "07:00");
    expect(badWindow.inQuiet).toBe(false);
  });

  test("DST spring-forward: America/New_York offset change handled", () => {
    // 2026-03-08: clocks jump 02:00 -> 03:00 EST -> EDT.
    // 07:30Z = 03:30 EDT (inside 22:00-07:00), 11:30Z = 07:30 EDT (outside).
    const inside = evaluateQuietHours(Date.parse("2026-03-08T07:30:00Z"), "America/New_York", "22:00", "07:00");
    expect(inside.inQuiet).toBe(true);
    expect(inside.endsAtMs).toBe(Date.parse("2026-03-08T11:00:00Z")); // 07:00 EDT
    const outside = evaluateQuietHours(Date.parse("2026-03-08T11:30:00Z"), "America/New_York", "22:00", "07:00");
    expect(outside.inQuiet).toBe(false);
  });

  test("DST fall-back ambiguous hour does not crash", () => {
    // 2026-11-01: clocks fall back 02:00 -> 01:00. 05:30Z = 01:30 EDT (first).
    const q = evaluateQuietHours(Date.parse("2026-11-01T05:30:00Z"), "America/New_York", "22:00", "07:00");
    expect(q.inQuiet).toBe(true);
    expect(typeof q.endsAtMs).toBe("number");
  });
});
