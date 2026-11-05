import { describe, expect, it } from "bun:test";
import { parseNaturalLanguage, type UserListSummary } from "../src/parse";
import { buildRecurrenceSummary } from "../src/recurrence";
import { validateScheduling } from "../src/validate";

const NOW = new Date("2026-11-04T12:00:00.000Z"); // Wednesday, noon UTC

const mockLists: UserListSummary[] = [
  { id: "list-inbox", name: "Inbox", isInbox: true },
  { id: "list-work", name: "Work", isInbox: false },
  { id: "list-home", name: "Home Projects", isInbox: false },
  { id: "list-fin", name: "Finances", isInbox: false },
];

function parse(input: string) {
  return parseNaturalLanguage(input, mockLists, "UTC", NOW);
}

describe("shared parser golden fixtures", () => {
  it("1. call mom tomorrow 5pm #personal !high", () => {
    const p = parse("call mom tomorrow 5pm #personal !high");
    expect(p.title).toBe("call mom");
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(false);
    expect(p.priority).toBe(3);
    expect(p.tags).toEqual(["personal"]);
  });

  it("2. pay rent every month on the 1st", () => {
    const p = parse("pay rent every month on the 1st");
    expect(p.title).toBe("pay rent");
    expect(p.recurrence).not.toBeNull();
    expect(p.recurrence!.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
    expect(p.recurrence!.mode).toBe("fixed");
  });

  it("3. gym every mon,wed,fri 7am ~1h", () => {
    const p = parse("gym every mon,wed,fri 7am ~1h");
    expect(p.title).toBe("gym");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
    expect(p.estimateMin).toBe(60);
    expect(p.dueAt).not.toBeNull();
  });

  it("4. submit report next friday @work", () => {
    const p = parse("submit report next friday @work");
    expect(p.title).toBe("submit report");
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(true);
    expect(p.list?.name).toBe("Work");
  });

  it("5. buy milk", () => {
    const p = parse("buy milk");
    expect(p.title).toBe("buy milk");
    expect(p.dueAt).toBeNull();
    expect(p.priority).toBe(0);
    expect(p.tags).toEqual([]);
  });

  it("6. dentist 5", () => {
    const p = parse("dentist 5");
    expect(p.title).toBe("dentist");
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(false);
  });

  it("7. standup every weekday 9:30", () => {
    const p = parse("standup every weekday 9:30");
    expect(p.title).toBe("standup");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(p.dueAt).not.toBeNull();
  });

  it("8. water plants every 3 days after done", () => {
    const p = parse("water plants every 3 days after done");
    expect(p.title).toBe("water plants");
    expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=3");
    expect(p.recurrence!.mode).toBe("after_completion");
  });

  it("9. pickup laundry remind 1h before", () => {
    const p = parse("pickup laundry remind 1h before");
    expect(p.title).toBe("pickup laundry");
    expect(p.reminders).toHaveLength(1);
    expect(p.reminders[0].kind).toBe("relative");
    expect(p.reminders[0].offsetMin).toBe(-60);
  });

  it("10. dentist appointment next monday 10am ~45m #health !urgent", () => {
    const p = parse("dentist appointment next monday 10am ~45m #health !urgent");
    expect(p.title).toBe("dentist appointment");
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(false);
    expect(p.estimateMin).toBe(45);
    expect(p.tags).toEqual(["health"]);
    expect(p.priority).toBe(4);
  });

  it("11. read book ~30m", () => {
    const p = parse("read book ~30m");
    expect(p.title).toBe("read book");
    expect(p.estimateMin).toBe(30);
  });

  it("12. prepare taxes !urgent", () => {
    const p = parse("prepare taxes !urgent");
    expect(p.title).toBe("prepare taxes");
    expect(p.priority).toBe(4);
  });

  it("13. call plumber #\"urgent repairs\"", () => {
    const p = parse('call plumber #"urgent repairs"');
    expect(p.title).toBe("call plumber");
    expect(p.tags).toEqual(["urgent repairs"]);
  });

  it("14. meeting @\"Home Projects\" tomorrow", () => {
    const p = parse('meeting @"Home Projects" tomorrow');
    expect(p.title).toBe("meeting");
    expect(p.list?.name).toBe("Home Projects");
    expect(p.dueAt).not.toBeNull();
  });

  it("15. review PR !2 ~45m", () => {
    const p = parse("review PR !2 ~45m");
    expect(p.title).toBe("review PR");
    expect(p.priority).toBe(2);
    expect(p.estimateMin).toBe(45);
  });

  it("16. take vitamins daily", () => {
    const p = parse("take vitamins daily");
    expect(p.title).toBe("take vitamins");
    expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=1");
  });

  it("17. trash night every other friday", () => {
    const p = parse("trash night every other friday");
    expect(p.title).toBe("trash night");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR");
  });

  it("18. mow lawn every 2 weeks", () => {
    const p = parse("mow lawn every 2 weeks");
    expect(p.title).toBe("mow lawn");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;INTERVAL=2");
  });

  it("19. car maintenance every 6 months after completion", () => {
    const p = parse("car maintenance every 6 months after completion");
    expect(p.title).toBe("car maintenance");
    expect(p.recurrence!.rrule).toBe("FREQ=MONTHLY;INTERVAL=6");
    expect(p.recurrence!.mode).toBe("after_completion");
  });

  it("20. doctor checkup remind me at 8am", () => {
    const p = parse("doctor checkup remind me at 8am");
    expect(p.title).toBe("doctor checkup");
    expect(p.reminders).toHaveLength(1);
    expect(p.reminders[0].kind).toBe("absolute");
  });

  it("21. grocery shopping #groceries #errands", () => {
    const p = parse("grocery shopping #groceries #errands");
    expect(p.title).toBe("grocery shopping");
    expect(p.tags).toEqual(["groceries", "errands"]);
  });

  it("22. board meeting next tuesday 3pm !high", () => {
    const p = parse("board meeting next tuesday 3pm !high");
    expect(p.title).toBe("board meeting");
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(false);
    expect(p.priority).toBe(3);
  });

  it("23. write tests ~2h !3", () => {
    const p = parse("write tests ~2h !3");
    expect(p.title).toBe("write tests");
    expect(p.estimateMin).toBe(120);
    expect(p.priority).toBe(3);
  });

  it("24. client call at 5", () => {
    const p = parse("client call at 5");
    expect(p.title).toBe("client call");
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(false);
  });

  it("25. flight to nyc next month", () => {
    const p = parse("flight to nyc next month");
    expect(p.title).toBe("flight to nyc");
    expect(p.dueAt).not.toBeNull();
  });

  it("26. clean garage ~3h", () => {
    const p = parse("clean garage ~3h");
    expect(p.title).toBe("clean garage");
    expect(p.estimateMin).toBe(180);
  });

  it("27. guitar practice every day", () => {
    const p = parse("guitar practice every day");
    expect(p.title).toBe("guitar practice");
    expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=1");
  });

  it("28. weekly sync every monday", () => {
    const p = parse("weekly sync every monday");
    expect(p.title).toBe("weekly sync");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
  });

  it("29. submit expense report @finances", () => {
    const p = parse("submit expense report @finances");
    expect(p.title).toBe("submit expense report");
    expect(p.list?.name).toBe("Finances");
  });

  it("30. renew passport remind 2 days before", () => {
    const p = parse("renew passport remind 2 days before");
    expect(p.title).toBe("renew passport");
    expect(p.reminders).toHaveLength(1);
    expect(p.reminders[0].offsetMin).toBe(-2880);
  });

  it("31. throws EMPTY_TITLE when input only contains tokens", () => {
    expect(() => parse("#personal !urgent @work")).toThrow("EMPTY_TITLE");
  });

  it("32. throws EMPTY_TITLE on blank input", () => {
    expect(() => parse("   ")).toThrow("EMPTY_TITLE");
  });

  it("33. team lunch every other monday", () => {
    const p = parse("team lunch every other monday");
    expect(p.title).toBe("team lunch");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO");
  });

  it("34. stretch every other day", () => {
    const p = parse("stretch every other day");
    expect(p.title).toBe("stretch");
    expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=2");
  });

  it("35. inbox zero daily after done", () => {
    const p = parse("inbox zero daily after done");
    expect(p.title).toBe("inbox zero");
    expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=1");
    expect(p.recurrence!.mode).toBe("after_completion");
  });

  it("36. prepare slides every weekday ~1h", () => {
    const p = parse("prepare slides every weekday ~1h");
    expect(p.title).toBe("prepare slides");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
    expect(p.estimateMin).toBe(60);
  });

  it("37. call dad remind me 30m before", () => {
    const p = parse("call dad remind me 30m before");
    expect(p.title).toBe("call dad");
    expect(p.reminders).toHaveLength(1);
    expect(p.reminders[0].offsetMin).toBe(-30);
  });

  it("38. water plants every 3 days", () => {
    const p = parse("water plants every 3 days");
    expect(p.title).toBe("water plants");
    expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=3");
    expect(p.recurrence!.mode).toBe("fixed");
  });

  it("39. buy milk tomorrow #errands ~15m", () => {
    const p = parse("buy milk tomorrow #errands ~15m");
    expect(p.title).toBe("buy milk");
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(true);
    expect(p.tags).toEqual(["errands"]);
    expect(p.estimateMin).toBe(15);
  });

  it("40. file taxes every month on the 15th", () => {
    const p = parse("file taxes every month on the 15th");
    expect(p.title).toBe("file taxes");
    expect(p.recurrence!.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=15");
  });

  it("41. backup laptop every 2 months", () => {
    const p = parse("backup laptop every 2 months");
    expect(p.title).toBe("backup laptop");
    expect(p.recurrence!.rrule).toBe("FREQ=MONTHLY;INTERVAL=2");
  });

  it("42. yoga every tue,thu 6pm ~1h", () => {
    const p = parse("yoga every tue,thu 6pm ~1h");
    expect(p.title).toBe("yoga");
    expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=TU,TH");
    expect(p.estimateMin).toBe(60);
    expect(p.dueAt).not.toBeNull();
    expect(p.allDay).toBe(false);
  });
});

describe("shared recurrence summary + scheduling validation", () => {
  it("summarizes biweekly Mon/Wed with until date", () => {
    expect(buildRecurrenceSummary("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20260630T000000Z")).toBe(
      "Every 2 weeks on Mon and Wed, until 30 Jun"
    );
  });

  it("summarizes daily, monthly ordinal, and after-done mode", () => {
    expect(buildRecurrenceSummary("FREQ=DAILY;INTERVAL=1")).toBe("Every day");
    expect(buildRecurrenceSummary("FREQ=MONTHLY;BYMONTHDAY=1")).toBe("Every month on the 1st");
    expect(buildRecurrenceSummary("FREQ=DAILY;INTERVAL=3", "after_completion")).toBe(
      "Every 3 days after done"
    );
  });

  it("flags start>due, bad estimate, too many reminders, bad rrule", () => {
    const errors = validateScheduling({
      startAt: new Date("2026-11-05T10:00:00Z"),
      dueAt: new Date("2026-11-04T10:00:00Z"),
      estimateMin: 2000,
      reminderCount: 11,
      rrule: "FREQ=MINUTELY;INTERVAL=5",
    });
    const fields = errors.map((e) => e.field);
    expect(fields).toHaveLength(4);
    expect(new Set(fields)).toEqual(new Set(["startAt", "estimateMin", "reminders", "recurrence"]));
  });

  it("accepts a clean scheduling slice", () => {
    expect(
      validateScheduling({
        startAt: new Date("2026-11-04T10:00:00Z"),
        dueAt: new Date("2026-11-05T10:00:00Z"),
        estimateMin: 45,
        reminderCount: 2,
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
      })
    ).toEqual([]);
  });
});
