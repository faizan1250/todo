import { describe, expect, it } from "bun:test";
import { dayBounds, buildDateBoundsPredicate, resolveTimezone, toUtcMidnight } from "../src/utils/dates";
import { DateTime } from "luxon";

describe("Timezone & Day Boundaries Helper", () => {
  it("validates timezones with fallback to UTC", () => {
    expect(resolveTimezone("America/Los_Angeles")).toBe("America/Los_Angeles");
    expect(resolveTimezone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(resolveTimezone("UTC")).toBe("UTC");
    expect(resolveTimezone("Invalid/Unknown_Zone")).toBe("UTC");
    expect(resolveTimezone("")).toBe("UTC");
    expect(resolveTimezone(null as any)).toBe("UTC");
  });

  it("calculates exact boundaries in Asia/Kolkata (no DST, fixed UTC+5:30)", () => {
    const bounds = dayBounds("2026-06-15", "Asia/Kolkata");
    expect(bounds.localDate).toBe("2026-06-15");

    // Local 2026-06-15 00:00:00 IST is 2026-06-14 18:30:00 UTC
    expect(bounds.startUtc.toISOString()).toBe("2026-06-14T18:30:00.000Z");
    // Next local day 2026-06-16 00:00:00 IST is 2026-06-15 18:30:00 UTC (exact 24 hours)
    expect(bounds.endUtc.toISOString()).toBe("2026-06-15T18:30:00.000Z");

    const diffHours = (bounds.endUtc.getTime() - bounds.startUtc.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBe(24);

    // Floating dates are always UTC midnight of the calendar date
    expect(bounds.floatStart.toISOString()).toBe("2026-06-15T00:00:00.000Z");
    expect(bounds.floatEnd.toISOString()).toBe("2026-06-16T00:00:00.000Z");
  });

  it("handles 23-hour spring-forward DST transition day in America/Los_Angeles", () => {
    // 2026 Spring Forward in US is March 8, 2026 (02:00 -> 03:00)
    const bounds = dayBounds("2026-03-08", "America/Los_Angeles");
    expect(bounds.localDate).toBe("2026-03-08");

    // Local 00:00:00 is PST (UTC-8) -> 08:00:00 UTC
    expect(bounds.startUtc.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    // Next day 00:00:00 is PDT (UTC-7) -> 07:00:00 UTC
    expect(bounds.endUtc.toISOString()).toBe("2026-03-09T07:00:00.000Z");

    // Exactly 23 hours in this day!
    const diffHours = (bounds.endUtc.getTime() - bounds.startUtc.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBe(23);

    expect(bounds.floatStart.toISOString()).toBe("2026-03-08T00:00:00.000Z");
    expect(bounds.floatEnd.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });

  it("handles 25-hour fall-back DST transition day in America/Los_Angeles", () => {
    // 2026 Fall Back in US is November 1, 2026 (02:00 -> 01:00)
    const bounds = dayBounds("2026-11-01", "America/Los_Angeles");
    expect(bounds.localDate).toBe("2026-11-01");

    // Local 00:00:00 is PDT (UTC-7) -> 07:00:00 UTC
    expect(bounds.startUtc.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    // Next day 00:00:00 is PST (UTC-8) -> 08:00:00 UTC
    expect(bounds.endUtc.toISOString()).toBe("2026-11-02T08:00:00.000Z");

    // Exactly 25 hours in this day!
    const diffHours = (bounds.endUtc.getTime() - bounds.startUtc.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBe(25);

    expect(bounds.floatStart.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(bounds.floatEnd.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  it("correctly evaluates all-day vs timed tasks against boundaries", () => {
    const bounds = dayBounds("2026-05-10", "America/New_York");

    // Timed task at 2026-05-10 14:00 EDT (UTC-4) -> 18:00 UTC
    const timedTaskDue = new Date("2026-05-10T18:00:00.000Z");
    const isTimedInRange =
      timedTaskDue.getTime() >= bounds.startUtc.getTime() &&
      timedTaskDue.getTime() < bounds.endUtc.getTime();
    expect(isTimedInRange).toBe(true);

    // Timed task next morning 2026-05-11 00:30 EDT -> 04:30 UTC
    const nextDayTimed = new Date("2026-05-11T04:30:00.000Z");
    const isNextDayInRange =
      nextDayTimed.getTime() >= bounds.startUtc.getTime() &&
      nextDayTimed.getTime() < bounds.endUtc.getTime();
    expect(isNextDayInRange).toBe(false);

    // All-day task for 2026-05-10 (stored as UTC midnight 2026-05-10T00:00:00.000Z)
    const allDayDue = toUtcMidnight("2026-05-10");
    const isAllDayInRange =
      allDayDue.getTime() >= bounds.floatStart.getTime() &&
      allDayDue.getTime() < bounds.floatEnd.getTime();
    expect(isAllDayInRange).toBe(true);

    // All-day task for 2026-05-11
    const nextAllDayDue = toUtcMidnight("2026-05-11");
    const isNextAllDayInRange =
      nextAllDayDue.getTime() >= bounds.floatStart.getTime() &&
      nextAllDayDue.getTime() < bounds.floatEnd.getTime();
    expect(isNextAllDayInRange).toBe(false);
  });
});
