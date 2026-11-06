import { describe, expect, it } from "bun:test";
import { formatOverdue, formatWhen } from "../src/lib/dates/formatWhen";

const NOW = new Date("2026-11-04T12:00:00.000Z"); // Wednesday, noon UTC
const OPTS = { now: NOW, timeZone: "UTC" } as const;

describe("formatWhen", () => {
  it("returns null for missing or invalid input", () => {
    expect(formatWhen(null)).toBeNull();
    expect(formatWhen(undefined)).toBeNull();
    expect(formatWhen("not a date")).toBeNull();
  });

  it("labels today with and without time", () => {
    expect(formatWhen("2026-11-04T00:00:00.000Z", { ...OPTS, allDay: true })).toBe("Today");
    expect(formatWhen("2026-11-04T17:00:00.000Z", OPTS)).toBe("Today, 5 PM");
    expect(formatWhen("2026-11-04T17:05:00.000Z", OPTS)).toBe("Today, 5:05 PM");
  });

  it("labels tomorrow with and without time", () => {
    expect(formatWhen("2026-11-05T00:00:00.000Z", { ...OPTS, allDay: true })).toBe("Tomorrow");
    expect(formatWhen("2026-11-05T17:00:00.000Z", OPTS)).toBe("Tomorrow, 5 PM");
  });

  it("labels later days as Mon 9 Mar style", () => {
    expect(formatWhen("2026-11-09T00:00:00.000Z", { ...OPTS, allDay: true })).toBe("Mon 9 Nov");
    expect(formatWhen("2026-11-09T15:00:00.000Z", OPTS)).toBe("Mon 9 Nov, 3 PM");
  });

  it("labels past days as overdue", () => {
    expect(formatWhen("2026-11-03T00:00:00.000Z", { ...OPTS, allDay: true })).toBe(
      "Overdue by 1 day"
    );
    expect(formatWhen("2026-11-02T09:00:00.000Z", OPTS)).toBe("Overdue by 2 days");
  });
});

describe("formatOverdue", () => {
  it("returns null for today-or-later dates", () => {
    expect(formatOverdue("2026-11-04T23:00:00.000Z", OPTS)).toBeNull();
    expect(formatOverdue("2026-11-09T00:00:00.000Z", OPTS)).toBeNull();
    expect(formatOverdue(null)).toBeNull();
  });

  it("counts overdue days", () => {
    expect(formatOverdue("2026-11-03T12:00:00.000Z", OPTS)).toBe("Overdue by 1 day");
    expect(formatOverdue("2026-11-02T12:00:00.000Z", OPTS)).toBe("Overdue by 2 days");
  });
});
