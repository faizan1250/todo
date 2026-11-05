import { DateTime } from "luxon";

/**
 * Parses "HH:MM" into hour and minute numbers. Defaults to [9, 0].
 */
export function parseTime(timeStr?: string | null): [number, number] {
  if (!timeStr) return [9, 0];
  const parts = timeStr.split(":");
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  return [isNaN(h) ? 9 : h, isNaN(m) ? 0 : m];
}

/**
 * Calculates resolved fire time for a relative reminder.
 */
export function calculateRelativeRemindAt(params: {
  anchorDate: Date | null;
  offsetMin: number;
  allDay: boolean;
  userTimezone: string;
  defaultReminderTime: string;
  now?: Date;
}): { remindAt: Date; firedAt: Date | null } {
  const { anchorDate, offsetMin, allDay, userTimezone, defaultReminderTime } = params;
  const now = params.now ?? new Date();

  if (!anchorDate) {
    // Missing anchor: set remindAt = 0 (inactive), firedAt = null
    return { remindAt: new Date(0), firedAt: null };
  }

  let anchorInstant: Date;

  if (allDay) {
    // All-day anchors: anchor timestamp is the calendar date at user's defaultReminderTime in user's timezone
    const [hour, minute] = parseTime(defaultReminderTime);
    const dt = DateTime.fromObject(
      {
        year: anchorDate.getUTCFullYear(),
        month: anchorDate.getUTCMonth() + 1,
        day: anchorDate.getUTCDate(),
        hour,
        minute,
        second: 0,
        millisecond: 0,
      },
      { zone: userTimezone }
    );
    anchorInstant = dt.toJSDate();
  } else {
    anchorInstant = anchorDate;
  }

  const resolvedTime = new Date(anchorInstant.getTime() + offsetMin * 60 * 1000);

  if (resolvedTime.getTime() > now.getTime()) {
    return { remindAt: resolvedTime, firedAt: null };
  } else {
    // In the past -> firedAt = now (prevents late firing)
    return { remindAt: resolvedTime, firedAt: now };
  }
}

/**
 * Resolves snooze target time from preset or custom timestamp.
 */
export function resolveSnoozeTarget(
  input: string | number,
  userTimezone = "UTC",
  defaultReminderTime = "09:00",
  now = new Date()
): Date {
  if (typeof input === "string") {
    switch (input) {
      case "10m":
        return new Date(now.getTime() + 10 * 60 * 1000);
      case "1h":
        return new Date(now.getTime() + 60 * 60 * 1000);
      case "3h":
        return new Date(now.getTime() + 3 * 60 * 60 * 1000);
      case "tomorrow_9am": {
        const [hour, minute] = parseTime(defaultReminderTime);
        const tomorrow = DateTime.fromJSDate(now)
          .setZone(userTimezone)
          .plus({ days: 1 })
          .set({ hour, minute, second: 0, millisecond: 0 });
        return tomorrow.toJSDate();
      }
      default: {
        const d = new Date(input);
        if (isNaN(d.getTime())) {
          throw new Error("Invalid snooze time format");
        }
        return d;
      }
    }
  }

  const d = new Date(input);
  if (isNaN(d.getTime())) {
    throw new Error("Invalid snooze timestamp");
  }
  return d;
}
