import { describe, it, expect } from "bun:test";
import {
  REPEAT_PRESETS,
  presetRrule,
  buildCustomRRule,
  validateRepeatRule,
  parseRRuleToCustom,
  formatNextDateLabel,
} from "../src/components/repeat/rrule-presets";
import { getNextDates, getNextDate } from "../src/components/repeat/next-dates";
import { buildRecurrenceSummary } from "@todo/shared";

describe("repeat presets", () => {
  it("covers day/weekday/week/month/year presets", () => {
    expect(REPEAT_PRESETS.map((p) => p.id)).toEqual([
      "daily",
      "weekdays",
      "weekly",
      "monthly",
      "yearly",
    ]);
    expect(presetRrule("daily")).toBe("FREQ=DAILY;INTERVAL=1");
    expect(presetRrule("weekdays")).toContain("BYDAY=MO,TU,WE,TH,FR");
    expect(presetRrule("none")).toBeNull();
    expect(presetRrule("custom")).toBeNull();
  });
});

describe("buildCustomRRule", () => {
  it("builds a simple daily rule", () => {
    const res = buildCustomRRule(
      { interval: 1, unit: "day", weekdays: [], monthDay: null, ends: { kind: "never" } }
    );
    expect(res.ok).toBe(true);
    expect(res.rrule).toBe("FREQ=DAILY");
  });

  it("builds weekly with weekday buttons", () => {
    const res = buildCustomRRule(
      { interval: 2, unit: "week", weekdays: ["MO", "WE"], monthDay: null, ends: { kind: "never" } }
    );
    expect(res.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE");
  });

  it("builds monthly ordinal + count end", () => {
    const res = buildCustomRRule(
      { interval: 1, unit: "month", weekdays: [], monthDay: 15, ends: { kind: "after_n", count: 6 } }
    );
    expect(res.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=15;COUNT=6");
  });

  it("builds until end", () => {
    const res = buildCustomRRule(
      {
        interval: 1,
        unit: "week",
        weekdays: [],
        monthDay: null,
        ends: { kind: "on_date", untilDate: "2026-06-30" },
      }
    );
    expect(res.rrule).toBe("FREQ=WEEKLY;UNTIL=20260630T000000Z");
  });

  it("rejects interval < 1 and count > 1000", () => {
    const bad = buildCustomRRule(
      { interval: 0, unit: "day", weekdays: [], monthDay: null, ends: { kind: "never" } }
    );
    expect(bad.ok).toBe(false);
    const big = buildCustomRRule(
      { interval: 1, unit: "day", weekdays: [], monthDay: null, ends: { kind: "after_n", count: 1001 } }
    );
    expect(big.ok).toBe(false);
    expect(big.error).toContain("1000");
  });
});

describe("validateRepeatRule mirrors backend constraints", () => {
  it("accepts day+ frequencies", () => {
    expect(validateRepeatRule("FREQ=DAILY;INTERVAL=1", "fixed").valid).toBe(true);
    expect(validateRepeatRule("FREQ=WEEKLY;BYDAY=MO,WE", "after_completion").valid).toBe(true);
  });

  it("rejects sub-daily rules", () => {
    expect(validateRepeatRule("FREQ=MINUTELY;INTERVAL=15", "fixed").valid).toBe(false);
    expect(validateRepeatRule("FREQ=HOURLY;INTERVAL=1", "fixed").valid).toBe(false);
  });

  it("rejects COUNT over 1000", () => {
    expect(validateRepeatRule("FREQ=DAILY;COUNT=1001", "fixed").valid).toBe(false);
    expect(validateRepeatRule("FREQ=DAILY;COUNT=1000", "fixed").valid).toBe(true);
  });
});

describe("parseRRuleToCustom round-trip", () => {
  it("parses weekly BYDAY + count", () => {
    const parsed = parseRRuleToCustom("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=6");
    expect(parsed).toMatchObject({
      interval: 2,
      unit: "week",
      weekdays: ["MO", "WE"],
      ends: { kind: "after_n", count: 6 },
    });
  });

  it("parses monthly ordinal + until", () => {
    const parsed = parseRRuleToCustom("FREQ=MONTHLY;BYMONTHDAY=15;UNTIL=20260630T000000Z");
    expect(parsed).toMatchObject({ unit: "month", monthDay: 15 });
    expect(parsed?.ends.kind).toBe("on_date");
  });

  it("returns null for garbage", () => {
    expect(parseRRuleToCustom("not a rule")).toBeNull();
  });
});

describe("recurrence summary (shared)", () => {
  it("summarizes presets in plain words", () => {
    expect(buildRecurrenceSummary("FREQ=DAILY;INTERVAL=1")).toBe("Every day");
    expect(buildRecurrenceSummary("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")).toContain("Mon and Wed");
    expect(buildRecurrenceSummary("FREQ=MONTHLY;BYMONTHDAY=1")).toBe("Every month on the 1st");
  });

  it("marks after_completion mode", () => {
    expect(buildRecurrenceSummary("FREQ=DAILY;INTERVAL=3", "after_completion")).toContain("after done");
  });
});

describe("next dates", () => {
  it("returns the next 3 daily dates after the anchor", () => {
    const anchor = new Date(Date.UTC(2026, 2, 16, 9, 0, 0)); // Mon 16 Mar 2026
    const next = getNextDates("FREQ=DAILY;INTERVAL=1", { anchorIso: anchor.toISOString(), now: anchor });
    expect(next).toHaveLength(3);
    expect(next[0].toISOString()).toBe(new Date(Date.UTC(2026, 2, 17, 9, 0, 0)).toISOString());
    expect(next[1].toISOString()).toBe(new Date(Date.UTC(2026, 2, 18, 9, 0, 0)).toISOString());
    expect(next[2].toISOString()).toBe(new Date(Date.UTC(2026, 2, 19, 9, 0, 0)).toISOString());
    // Ascending order guarantee.
    expect(next[0] < next[1] && next[1] < next[2]).toBe(true);
  });

  it("returns [] for unparseable rules instead of throwing", () => {
    expect(getNextDates("garbage", {})).toEqual([]);
    expect(getNextDate("", {})).toBeNull();
  });

  it("formats the toast label like 'Mon 16 Mar'", () => {
    const label = formatNextDateLabel(new Date(Date.UTC(2026, 2, 16, 12, 0, 0)));
    expect(label).toContain("16");
    expect(label).toContain("Mar");
  });
});
