import { DateTime } from "luxon";

/**
 * Phase 6 delivery planner (Day 2).
 *
 * Pure function: no DB, no clock reads — every input is passed in so the
 * policy is fully deterministic and table-testable. Evaluation order:
 *
 *   kill switch → paused → type prefs → list rule → quiet hours → targets → hide_content
 */
export type DeliveryChannel = "web_push" | "fcm" | "email";

export type ListRuleMode = "all" | "silent" | "off";

export interface PlanInput {
  /** Global NOTIFICATIONS_ENABLED kill switch. */
  notificationsEnabled: boolean;
  /** Per-user pause. Ms epoch, or null when not paused. */
  pausedUntilMs: number | null;
  /** Injectable "now" (ms epoch). */
  nowMs: number;
  /** prefs.types[notificationType]; undefined = defaults (all on). */
  typePref: { webPush?: boolean; email?: boolean } | undefined;
  /** Effective list rule for the task's list. */
  listRule: ListRuleMode;
  /** Quiet-hours window + user tz. */
  quiet: { enabled: boolean; start: string; end: string; urgentBreaksQuiet: boolean };
  /** IANA user timezone, e.g. "America/New_York". */
  timezone: string;
  /** Task priority 0-4; 4 = urgent. */
  priority: number;
  /** Reachability: at least one push-enabled device with a subscription/token. */
  hasWebPushTarget: boolean;
  hasFcmTarget: boolean;
  hasEmailTarget: boolean;
  /** Row present in email_suppressions. */
  emailSuppressed: boolean;
  /** prefs.hideContent — passthrough for send-time redaction. */
  hideContent: boolean;
}

export interface PlanResult {
  /** Push/email delivery rows to create. In-app (notification row) is separate. */
  channels: DeliveryChannel[];
  /** Create the in-app notification row even when no push channels remain. */
  inApp: boolean;
  /** Defer deliveries until this time (quiet hours). Null = sendable now. */
  notBeforeMs: number | null;
  /** Machine-readable suppression reasons, in evaluation order. */
  suppressed: string[];
  hideContent: boolean;
}

const EMPTY: PlanResult = {
  channels: [],
  inApp: false,
  notBeforeMs: null,
  suppressed: [],
  hideContent: false,
};

function parseHhMm(v: string): number | null {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export interface QuietState {
  inQuiet: boolean;
  /** Ms epoch when the current quiet window ends. Null when not quiet. */
  endsAtMs: number | null;
}

/**
 * Evaluate a quiet-hours window in the user's timezone.
 * Handles cross-midnight windows (e.g. 22:00–07:00). start === end is treated
 * as an empty window (never quiet). Invalid tz falls back to UTC (fail-safe);
 * invalid HH:MM falls back to never-quiet (fail-open for delivery).
 */
export function evaluateQuietHours(
  nowMs: number,
  timezone: string,
  start: string,
  end: string
): QuietState {
  const startMin = parseHhMm(start);
  const endMin = parseHhMm(end);
  if (startMin === null || endMin === null || startMin === endMin) {
    return { inQuiet: false, endsAtMs: null };
  }
  let dt = DateTime.fromMillis(nowMs).setZone(timezone);
  if (!dt.isValid) dt = DateTime.fromMillis(nowMs).setZone("UTC");
  const nowMin = dt.hour * 60 + dt.minute;

  let inQuiet: boolean;
  let endDay: typeof dt;
  if (startMin < endMin) {
    // Same-day window, e.g. 13:00–14:00.
    inQuiet = nowMin >= startMin && nowMin < endMin;
    endDay = dt;
  } else {
    // Cross-midnight window, e.g. 22:00–07:00.
    inQuiet = nowMin >= startMin || nowMin < endMin;
    // If we are in the early-morning half, the window ends today; if in the
    // evening half, it ends tomorrow.
    endDay = nowMin < endMin ? dt : dt.plus({ days: 1 });
  }
  if (!inQuiet) return { inQuiet: false, endsAtMs: null };
  const endsAt = endDay.set({ hour: Math.floor(endMin / 60), minute: endMin % 60, second: 0, millisecond: 0 });
  return { inQuiet: true, endsAtMs: endsAt.toMillis() };
}

export function planDelivery(input: PlanInput): PlanResult {
  const hideContent = input.hideContent;

  // 1. Kill switch — nothing is created, not even in-app.
  if (!input.notificationsEnabled) {
    return { ...EMPTY, suppressed: ["kill_switch"], hideContent };
  }

  // 2. Paused — inbox row still created, pushes suppressed.
  if (input.pausedUntilMs !== null && input.pausedUntilMs > input.nowMs) {
    return { channels: [], inApp: true, notBeforeMs: null, suppressed: ["paused"], hideContent };
  }

  // 3. Type prefs — default on unless explicitly false.
  const webPref = input.typePref?.webPush !== false;
  const emailPref = input.typePref?.email !== false;

  // 4. List rule.
  if (input.listRule === "off") {
    return { ...EMPTY, suppressed: ["list_off"], hideContent };
  }
  const listSilent = input.listRule === "silent";

  const suppressed: string[] = [];
  const channels: DeliveryChannel[] = [];

  if (!listSilent) {
    // 5. Quiet hours — defer, don't drop (unless urgent breaks through).
    let notBeforeMs: number | null = null;
    if (input.quiet.enabled) {
      const urgent = input.priority >= 4;
      if (!(urgent && input.quiet.urgentBreaksQuiet)) {
        const q = evaluateQuietHours(input.nowMs, input.timezone, input.quiet.start, input.quiet.end);
        if (q.inQuiet && q.endsAtMs !== null) {
          notBeforeMs = q.endsAtMs;
          suppressed.push("quiet_hours");
        }
      }
    }

    // Type prefs gate the push/email channels.
    if (webPref && input.hasWebPushTarget) channels.push("web_push");
    if (webPref && input.hasFcmTarget) channels.push("fcm");
    if (emailPref && input.hasEmailTarget && !input.emailSuppressed) channels.push("email");
    if (webPref && !input.hasWebPushTarget) suppressed.push("no_web_push_target");
    if (webPref && !input.hasFcmTarget) suppressed.push("no_fcm_target");
    if (emailPref && !input.hasEmailTarget) suppressed.push("no_email_target");
    if (emailPref && input.hasEmailTarget && input.emailSuppressed) suppressed.push("email_suppressed");
    if (!webPref) suppressed.push("type_off_web");
    if (!emailPref) suppressed.push("type_off_email");

    // 6+7. Targets resolved above; hide_content is a send-time passthrough.
    return { channels, inApp: true, notBeforeMs, suppressed, hideContent };
  }

  // List rule "silent" — inbox only, no pushes.
  suppressed.push("list_silent");
  return { channels: [], inApp: true, notBeforeMs: null, suppressed, hideContent };
}
