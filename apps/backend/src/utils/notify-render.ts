import { DateTime } from "luxon";

export type NotifyUserContext = {
  timezone: string;
  hour12?: boolean;
};

export type Rendered = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  actions?: Array<{ action: string; title: string }>;
};

export type TaskReminderPayload = {
  kind: "task_reminder";
  taskId: string;
  taskTitle: string;
  dueAt?: string | null; // ISO
  listName?: string | null;
};

export type TaskOverduePayload = {
  kind: "task_overdue";
  taskTitle: string;
  dueAt?: string | null; // ISO
  overdueDays?: number;
};

export type DigestPayload = {
  kind: "digest_daily" | "digest_weekly";
  dueCount: number;
  overdueCount: number;
  topTasks?: string[];
};

export type NotifyPayload = TaskReminderPayload | TaskOverduePayload | DigestPayload;

/**
 * Render a notification payload into user-facing strings in the user's timezone.
 * Plain words, no jargon. Times formatted in the user's locale/tz.
 */
export function render(
  type: string,
  payload: NotifyPayload | Record<string, unknown>,
  user: NotifyUserContext
): Rendered {
  const p = payload as Record<string, unknown>;
  switch (type) {
    case "task_reminder":
      return renderTaskReminder(p as unknown as TaskReminderPayload, user);
    case "task_overdue":
      return renderTaskOverdue(p as unknown as TaskOverduePayload, user);
    case "digest_daily":
    case "digest_weekly":
      return renderDigest(type, p as unknown as DigestPayload);
    default:
      return {
        title: "Reminder",
        body: typeof p.taskTitle === "string" ? p.taskTitle : "You have a reminder.",
      };
  }
}

function formatTime(iso: string, user: NotifyUserContext): string {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(user.timezone || "UTC");
  if (!dt.isValid) return "";
  return dt.toLocaleString(user.hour12 === false ? DateTime.TIME_24_SIMPLE : DateTime.TIME_SIMPLE);
}

function formatDay(iso: string, user: NotifyUserContext): string {
  const dt = DateTime.fromISO(iso, { zone: "utc" }).setZone(user.timezone || "UTC");
  if (!dt.isValid) return "";
  return dt.toLocaleString({ weekday: "long" });
}

function renderTaskReminder(p: TaskReminderPayload, user: NotifyUserContext): Rendered {
  const title = p.taskTitle || "Task";
  if (!p.dueAt) {
    return { title, body: "Due now", tag: p.taskId };
  }
  const dueMs = Date.parse(p.dueAt);
  const diffMin = Math.round((dueMs - Date.now()) / 60000);
  const timeStr = formatTime(p.dueAt, user);
  if (diffMin <= 1 && diffMin >= -1) {
    return { title, body: "Due now", tag: p.taskId };
  }
  if (diffMin > 1 && diffMin < 60) {
    return {
      title,
      body: timeStr ? `Due in ${diffMin} minutes (${timeStr})` : `Due in ${diffMin} minutes`,
      tag: p.taskId,
    };
  }
  if (diffMin >= 60 && diffMin < 24 * 60) {
    const hours = Math.round(diffMin / 60);
    return {
      title,
      body: timeStr ? `Due in ${hours === 1 ? "1 hour" : `${hours} hours`} (${timeStr})` : `Due in ${hours} hours`,
      tag: p.taskId,
    };
  }
  if (diffMin >= 24 * 60) {
    const day = formatDay(p.dueAt, user);
    return {
      title,
      body: timeStr ? `Due ${day} (${timeStr})` : `Due ${day}`,
      tag: p.taskId,
    };
  }
  // Past due at render time.
  return { title, body: "Due now", tag: p.taskId };
}

function renderTaskOverdue(p: TaskOverduePayload, user: NotifyUserContext): Rendered {
  const title = p.taskTitle || "Task";
  const days = p.overdueDays ?? 0;
  void user;
  if (days <= 0) {
    return { title, body: "Due today" };
  }
  return { title, body: `Overdue by ${days === 1 ? "1 day" : `${days} days`}` };
}

function renderDigest(type: string, p: DigestPayload): Rendered {
  const due = p.dueCount ?? 0;
  const overdue = p.overdueCount ?? 0;
  const title =
    type === "digest_weekly"
      ? `Your week: ${due} tasks, ${overdue} overdue`
      : `Your day: ${due} tasks, ${overdue} overdue`;
  const top = (p.topTasks ?? []).slice(0, 3);
  return { title, body: top.length > 0 ? top.join(", ") : "Nothing scheduled. Enjoy the quiet." };
}
