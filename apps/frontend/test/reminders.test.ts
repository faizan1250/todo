import { describe, it, expect } from "bun:test";
import {
  formatOffsetMeaning,
  getReminderMeaning,
  REMINDER_LIMIT,
  REMINDER_CAP_MESSAGE,
} from "../src/components/reminders/reminder-meaning";
import type { ReminderItem } from "../src/components/app/types";

const NOW = new Date("2026-11-05T12:00:00.000Z");

function item(over: Partial<ReminderItem> = {}): ReminderItem {
  return {
    id: "rem-1",
    kind: "relative",
    relativeTo: "due",
    offsetMin: -60,
    remindAt: "2026-11-05T16:00:00.000Z",
    firedAt: null,
    ...over,
  };
}

describe("reminder meaning labels", () => {
  it("names the common presets in plain words", () => {
    expect(formatOffsetMeaning(0, "due")).toBe("At due time");
    expect(formatOffsetMeaning(-10, "due")).toBe("10 minutes before");
    expect(formatOffsetMeaning(-60, "due")).toBe("1 hour before");
    expect(formatOffsetMeaning(-1440, "due")).toBe("1 day before");
  });

  it("composes other offsets from the same words", () => {
    expect(formatOffsetMeaning(-30, "due")).toBe("30 minutes before");
    expect(formatOffsetMeaning(-180, "due")).toBe("3 hours before");
    expect(formatOffsetMeaning(-2880, "due")).toBe("2 days before");
    expect(formatOffsetMeaning(15, "start")).toBe("15 minutes after");
    expect(formatOffsetMeaning(0, "start")).toBe("At start time");
  });

  it("pairs meaning with the resolved time", () => {
    const m = getReminderMeaning(item(), {
      anchorDate: "2026-11-05T17:00:00.000Z",
      now: NOW,
    });
    expect(m.status).toBe("scheduled");
    expect(m.meaning).toBe("1 hour before");
    expect(m.detail).toContain("Today");
  });

  it("labels absolute reminders as a specific time", () => {
    const m = getReminderMeaning(
      item({ kind: "absolute", remindAt: "2026-11-06T09:00:00.000Z" }),
      { now: NOW }
    );
    expect(m.meaning).toBe("At specific time");
    expect(m.status).toBe("scheduled");
    expect(m.detail).toContain("Tomorrow");
  });

  it("waits for a date when the anchor is missing", () => {
    const m = getReminderMeaning(item({ remindAt: null }), {
      anchorDate: null,
      now: NOW,
    });
    expect(m.status).toBe("no-date");
    expect(m.detail).toBe("Waiting for a date");
    expect(m.meaning).toBe("1 hour before");
  });

  it("treats epoch-zero server values as no date", () => {
    const m = getReminderMeaning(
      item({ remindAt: "1970-01-01T00:00:00.000Z" }),
      { now: NOW }
    );
    expect(m.status).toBe("no-date");
    expect(m.detail).toBe("Waiting for a date");
  });

  it("flags elapsed reminders as already passed", () => {
    const m = getReminderMeaning(
      item({ remindAt: "2026-11-05T08:00:00.000Z" }),
      { anchorDate: "2026-11-05T09:00:00.000Z", now: NOW }
    );
    expect(m.status).toBe("passed");
    expect(m.detail).toContain("Already passed");
  });

  it("keeps fired reminders distinct from passed ones", () => {
    const m = getReminderMeaning(
      item({
        remindAt: "2026-11-05T08:00:00.000Z",
        firedAt: "2026-11-05T08:00:00.000Z",
      }),
      { now: NOW }
    );
    expect(m.status).toBe("fired");
    expect(m.detail).not.toContain("Already passed");
  });

  it("caps at ten reminders with a gentle message", () => {
    expect(REMINDER_LIMIT).toBe(10);
    expect(REMINDER_CAP_MESSAGE.length).toBeGreaterThan(0);
    expect(REMINDER_CAP_MESSAGE).not.toMatch(/error|limit exceeded/i);
  });
});
