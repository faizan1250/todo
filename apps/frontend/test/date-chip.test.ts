import { describe, expect, it } from "bun:test";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { DateChip } from "../src/components/dates/DateChip";
import {
  isPastDay,
  nextRoundHour,
  nextWeekMonday,
  thisWeekend,
} from "../src/components/dates/DatePopover";

const NOW = new Date("2026-11-04T12:00:00.000Z"); // Wednesday, noon UTC
const OPTS = { now: NOW, timeZone: "UTC" } as const;

function chip(props: Partial<React.ComponentProps<typeof DateChip>> = {}): string {
  return renderToString(
    React.createElement(DateChip, { dueAt: null, onOpen: () => {}, ...OPTS, ...props })
  );
}

describe("DateChip", () => {
  it("renders None with a Set-due-date label when empty", () => {
    const html = chip();
    expect(html).toContain("None");
    expect(html).toContain('aria-label="Set due date"');
  });

  it("labels today with time and exposes a Due-today aria label", () => {
    const html = chip({ dueAt: "2026-11-04T17:00:00.000Z" });
    expect(html).toContain("Today, 5 PM");
    expect(html).toContain('aria-label="Due today, 5 PM"');
  });

  it("labels all-day today without a clock time", () => {
    const html = chip({ dueAt: "2026-11-04T00:00:00.000Z", allDay: true });
    expect(html).toContain("Today");
    expect(html).not.toContain("PM");
    expect(html).toContain("(All day)");
  });

  it("labels tomorrow with time", () => {
    const html = chip({ dueAt: "2026-11-05T17:00:00.000Z" });
    expect(html).toContain("Tomorrow, 5 PM");
    expect(html).toContain('aria-label="Due tomorrow, 5 PM"');
  });

  it("labels later days as Mon 9 Nov style", () => {
    const html = chip({ dueAt: "2026-11-09T15:00:00.000Z" });
    expect(html).toContain("Mon 9 Nov, 3 PM");
  });

  it("marks overdue with danger tone and an overdue aria label", () => {
    const html = chip({ dueAt: "2026-11-02T09:00:00.000Z" });
    expect(html).toContain("Overdue by 2 days");
    expect(html).toContain('aria-label="Due overdue by 2 days"');
    expect(html).toContain("rose");
  });

  it("shows repeat and bell markers when present", () => {
    const html = chip({
      dueAt: "2026-11-04T17:00:00.000Z",
      hasRepeat: true,
      hasBell: true,
    });
    expect(html).toContain("Repeating task");
    expect(html).toContain("Has reminder");
  });

  it("reflects popover open state via aria-expanded", () => {
    expect(chip({ expanded: true })).toContain('aria-expanded="true"');
    expect(chip({ expanded: false })).toContain('aria-expanded="false"');
  });
});

describe("DatePopover date helpers", () => {
  it("rounds up to the next whole hour", () => {
    const next = nextRoundHour(new Date("2026-11-04T14:37:00"));
    expect(next.getHours()).toBe(15);
    expect(next.getMinutes()).toBe(0);
    const onHour = nextRoundHour(new Date("2026-11-04T14:00:00"));
    expect(onHour.getHours()).toBe(15);
  });

  it("detects past calendar days", () => {
    expect(isPastDay(new Date("2026-11-03T23:00:00"), NOW)).toBe(true);
    expect(isPastDay(new Date("2026-11-04T00:00:00"), NOW)).toBe(false);
    expect(isPastDay(new Date("2026-11-05T00:00:00"), NOW)).toBe(false);
  });

  it("resolves this weekend to Saturday and next week to Monday", () => {
    // NOW is a Wednesday.
    expect(thisWeekend(NOW).getDay()).toBe(6);
    expect(thisWeekend(NOW).getDate()).toBe(7);
    const monday = nextWeekMonday(NOW);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(9);
  });
});
