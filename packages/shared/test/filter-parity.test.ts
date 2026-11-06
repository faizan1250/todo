import { describe, expect, it } from "bun:test";
import {
  evaluateFilter,
  validateFilterDsl,
  resolveDateBoundary,
  type FilterNode,
  type FilterTask,
} from "../src/filter";
import { expandOccurrences } from "../src/occurrences";
import { blockValidation, capacityMath, snapToStepMs } from "../src/planner";
import {
  matchAll,
  matchCompleted,
  matchDateInDay,
  matchNoDate,
  matchOverdue,
  matchPriority,
  matchToday,
  matchUpcoming,
} from "../src/views";
import { dayBounds } from "../src/dayBounds";

// HONESTY NOTE: these tests pin the shared in-memory evaluator against
// hand-computed expectations derived from reading the backend SQL builders
// (apps/backend/src/utils/filter-dsl.ts, routes/planner.ts, routes/calendar.ts).
// Parity is by construction — a branch-for-branch mirror — NOT differential:
// nothing here runs the backend SQLite queries, so a backend behavior change
// will not fail these tests. True differential parity would require running
// both implementations against the same fixture rows in CI.

const NOW = new Date("2026-11-04T12:00:00.000Z"); // Wednesday, noon UTC
const TZ = "UTC";
const ctx = { tz: TZ, now: NOW };

const TIMED_TODAY: FilterTask = { status: "active", dueAt: new Date("2026-11-04T15:00:00.000Z") };
const ALLDAY_TODAY: FilterTask = {
  status: "active",
  dueAt: new Date("2026-11-04T00:00:00.000Z"),
  allDay: true,
};
const YESTERDAY: FilterTask = { status: "active", dueAt: new Date("2026-11-03T23:00:00.000Z") };
const TOMORROW_AM: FilterTask = { status: "active", dueAt: new Date("2026-11-05T09:00:00.000Z") };
const NO_DATE: FilterTask = { status: "active" };

describe("filter evaluator fixtures", () => {
  it("scalar fields: status/priority/estimate/title", () => {
    expect(evaluateFilter({ field: "status", op: "eq", value: "active" }, TIMED_TODAY, ctx)).toBe(true);
    expect(evaluateFilter({ field: "status", op: "ne", value: "active" }, TIMED_TODAY, ctx)).toBe(false);
    expect(
      evaluateFilter({ field: "priority", op: "gte", value: 2 }, { ...TIMED_TODAY, priority: 3 }, ctx)
    ).toBe(true);
    expect(
      evaluateFilter({ field: "priority", op: "in", value: [1, 2] }, { ...TIMED_TODAY, priority: 3 }, ctx)
    ).toBe(false);
    expect(
      evaluateFilter({ field: "title", op: "contains", value: "REPORT" }, { ...TIMED_TODAY, title: "Q3 Report" }, ctx)
    ).toBe(true);
    expect(
      evaluateFilter({ field: "title", op: "starts_with", value: "q3" }, { ...TIMED_TODAY, title: "Q3 Report" }, ctx)
    ).toBe(true);
    expect(evaluateFilter({ field: "estimate_min", op: "between", value: [30, 60] }, { estimateMin: 45 }, ctx)).toBe(
      true
    );
  });

  it("tag operators", () => {
    const task: FilterTask = { tagIds: ["a", "b"], tagNames: ["c"] };
    expect(evaluateFilter({ field: "tag", op: "eq", value: "a" }, task, ctx)).toBe(true);
    expect(evaluateFilter({ field: "tag", op: "eq", value: "z" }, task, ctx)).toBe(false);
    expect(evaluateFilter({ field: "tag", op: "all_of", value: ["a", "c"] }, task, ctx)).toBe(true);
    expect(evaluateFilter({ field: "tag", op: "all_of", value: ["a", "z"] }, task, ctx)).toBe(false);
    expect(evaluateFilter({ field: "tag", op: "in", value: ["z", "b"] }, task, ctx)).toBe(true);
    expect(evaluateFilter({ field: "tag", op: "in", value: [] }, task, ctx)).toBe(false);
    expect(evaluateFilter({ field: "tag", op: "nin", value: [] }, task, ctx)).toBe(true);
    expect(evaluateFilter({ field: "tag", op: "ne", value: "z" }, task, ctx)).toBe(true);
  });

  it("boolean flags: has_recurrence / has_location / is_subtask", () => {
    expect(
      evaluateFilter({ field: "has_recurrence", op: "eq", value: true }, { recurrenceId: "r1" }, ctx)
    ).toBe(true);
    expect(evaluateFilter({ field: "has_recurrence", op: "eq", value: true }, {}, ctx)).toBe(false);
    expect(evaluateFilter({ field: "is_subtask", op: "eq", value: true }, { parentId: "p1" }, ctx)).toBe(true);
    expect(evaluateFilter({ field: "has_location", op: "eq", value: true }, { placeId: "pl1" }, ctx)).toBe(true);
    expect(evaluateFilter({ field: "has_location", op: "eq", value: true }, {}, ctx)).toBe(false);
  });

  it("date eq/ne honor the all-day two-branch rule", () => {
    const eqToday = { field: "due_at", op: "eq", value: "today" } as FilterNode;
    expect(evaluateFilter(eqToday, TIMED_TODAY, ctx)).toBe(true);
    expect(evaluateFilter(eqToday, ALLDAY_TODAY, ctx)).toBe(true);
    expect(evaluateFilter(eqToday, TOMORROW_AM, ctx)).toBe(false);
    const neToday = { field: "due_at", op: "ne", value: "today" } as FilterNode;
    expect(evaluateFilter(neToday, TIMED_TODAY, ctx)).toBe(false);
    expect(evaluateFilter(neToday, TOMORROW_AM, ctx)).toBe(true);
  });

  it("date lt/lte/gt/gte use backend half-open day semantics", () => {
    expect(evaluateFilter({ field: "due_at", op: "lt", value: "today" }, YESTERDAY, ctx)).toBe(true);
    // lt is strictly before start-of-day: midnight itself is not lt.
    expect(
      evaluateFilter(
        { field: "due_at", op: "lt", value: "today" },
        { dueAt: new Date("2026-11-04T00:00:00.000Z") },
        ctx
      )
    ).toBe(false);
    // lte is `< end-of-day`.
    expect(
      evaluateFilter(
        { field: "due_at", op: "lte", value: "today" },
        { dueAt: new Date("2026-11-04T23:59:00.000Z") },
        ctx
      )
    ).toBe(true);
    // gt is `>= end-of-day`.
    expect(
      evaluateFilter({ field: "due_at", op: "gt", value: "today" }, { dueAt: new Date("2026-11-05T00:00:00.000Z") }, ctx)
    ).toBe(true);
    expect(evaluateFilter({ field: "due_at", op: "gt", value: "today" }, TIMED_TODAY, ctx)).toBe(false);
    expect(evaluateFilter({ field: "due_at", op: "gte", value: "today" }, TIMED_TODAY, ctx)).toBe(true);
    expect(evaluateFilter({ field: "due_at", op: "gte", value: "today" }, YESTERDAY, ctx)).toBe(false);
  });

  it("date between is half-open [from.start, to.end)", () => {
    const between = { field: "due_at", op: "between", value: ["today", "tomorrow"] } as FilterNode;
    expect(evaluateFilter(between, TIMED_TODAY, ctx)).toBe(true);
    expect(evaluateFilter(between, { dueAt: new Date("2026-11-05T12:00:00.000Z") }, ctx)).toBe(true);
    // to.end is start of the day after tomorrow: exclusive.
    expect(evaluateFilter(between, { dueAt: new Date("2026-11-06T00:00:00.000Z") }, ctx)).toBe(false);
  });

  it("NULL date semantics: null checks pass, all other comparisons are falsy", () => {
    expect(evaluateFilter({ field: "due_at", op: "is_null", value: null }, NO_DATE, ctx)).toBe(true);
    expect(evaluateFilter({ field: "due_at", op: "not_null", value: null }, NO_DATE, ctx)).toBe(false);
    expect(evaluateFilter({ field: "due_at", op: "not_null", value: null }, TIMED_TODAY, ctx)).toBe(true);
    expect(evaluateFilter({ field: "due_at", op: "eq", value: "today" }, NO_DATE, ctx)).toBe(false);
    expect(evaluateFilter({ field: "due_at", op: "ne", value: "today" }, NO_DATE, ctx)).toBe(false);
  });

  it("relative keywords and offsets resolve against ctx.now", () => {
    expect(evaluateFilter({ field: "due_at", op: "eq", value: "tomorrow" }, TOMORROW_AM, ctx)).toBe(true);
    expect(evaluateFilter({ field: "due_at", op: "eq", value: "tomorrow" }, TIMED_TODAY, ctx)).toBe(false);
    expect(evaluateFilter({ field: "due_at", op: "eq", value: "+1d" }, TOMORROW_AM, ctx)).toBe(true);
    expect(evaluateFilter({ field: "due_at", op: "eq", value: "+1d" }, TIMED_TODAY, ctx)).toBe(false);
  });

  it("resolveDateBoundary('today') matches shared dayBounds on main", () => {
    const b = resolveDateBoundary("today", TZ, NOW);
    const shared = dayBounds(NOW, TZ);
    expect(b.startUtc.getTime()).toBe(shared.startUtc.getTime());
    expect(b.endUtc.getTime()).toBe(shared.endUtc.getTime());
    expect(b.floatStart.getTime()).toBe(shared.floatStart.getTime());
  });

  it("and/or/not nesting", () => {
    const node = {
      and: [
        { field: "status", op: "eq", value: "active" },
        { or: [{ field: "priority", op: "gte", value: 3 }, { not: { field: "tag", op: "eq", value: "x" } }] },
      ],
    } as unknown as FilterNode;
    expect(evaluateFilter(node, { ...TIMED_TODAY, priority: 1, tagIds: ["y"] }, ctx)).toBe(true);
    expect(evaluateFilter(node, { ...TIMED_TODAY, priority: 1, tagIds: ["x"] }, ctx)).toBe(false);
    expect(evaluateFilter(node, { ...TIMED_TODAY, status: "done", priority: 5 }, ctx)).toBe(false);
  });

  it("invalid/unknown nodes are falsy, never throw", () => {
    expect(evaluateFilter({} as unknown as FilterNode, TIMED_TODAY, ctx)).toBe(false);
    expect(evaluateFilter(null as unknown as FilterNode, TIMED_TODAY, ctx)).toBe(false);
    expect(evaluateFilter({ field: "nope", op: "eq", value: 1 } as unknown as FilterNode, TIMED_TODAY, ctx)).toBe(
      false
    );
  });

  it("validateFilterDsl mirrors backend limits", () => {
    expect(validateFilterDsl({ field: "status", op: "eq", value: "active" }).valid).toBe(true);
    expect(validateFilterDsl({ field: "bogus", op: "eq", value: 1 }).valid).toBe(false);
    expect(validateFilterDsl({ field: "title", op: "gt", value: "a" }).valid).toBe(false);
    expect(validateFilterDsl({ field: "tag", op: "contains", value: "a" }).valid).toBe(false);
    // Depth 5 exceeds max depth 4.
    let deep: unknown = { field: "status", op: "eq", value: "active" };
    for (let i = 0; i < 5; i++) deep = { not: deep };
    expect(validateFilterDsl(deep).valid).toBe(false);
    // 31 leaf nodes exceed max 30.
    const wide = {
      and: Array.from({ length: 31 }, () => ({ field: "status", op: "eq", value: "active" })),
    };
    expect(validateFilterDsl(wide).valid).toBe(false);
  });
});

describe("occurrences + planner math", () => {
  it("expandOccurrences mirrors backend calendar expansion with cap 50 default", () => {
    const occ = expandOccurrences("FREQ=DAILY;COUNT=5", {
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-11-10T00:00:00.000Z"),
      dtstart: new Date("2026-11-01T09:00:00.000Z"),
    });
    expect(occ).toHaveLength(5);
    expect(occ[0].toISOString()).toBe("2026-11-01T09:00:00.000Z");
    const capped = expandOccurrences("FREQ=DAILY;COUNT=5", {
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-11-10T00:00:00.000Z"),
      dtstart: new Date("2026-11-01T09:00:00.000Z"),
      cap: 2,
    });
    expect(capped).toHaveLength(2);
  });

  it("expandOccurrences allDay normalizes to UTC midnight", () => {
    const occ = expandOccurrences("FREQ=DAILY;COUNT=2", {
      from: new Date("2026-11-01T00:00:00.000Z"),
      to: new Date("2026-11-10T00:00:00.000Z"),
      dtstart: new Date("2026-11-01T09:00:00.000Z"),
      allDay: true,
    });
    expect(occ).toHaveLength(2);
    for (const o of occ) {
      expect(o.getUTCHours()).toBe(0);
      expect(o.getUTCMinutes()).toBe(0);
    }
  });

  it("blockValidation mirrors backend planner rules", () => {
    expect(
      blockValidation(new Date("2026-11-04T09:00:00.000Z"), new Date("2026-11-04T10:00:00.000Z"), TZ).valid
    ).toBe(true);
    // Ending exactly at midnight is allowed.
    expect(
      blockValidation(new Date("2026-11-04T23:00:00.000Z"), new Date("2026-11-05T00:00:00.000Z"), TZ).valid
    ).toBe(true);
    // 3-minute block is too short.
    expect(
      blockValidation(new Date("2026-11-04T09:00:00.000Z"), new Date("2026-11-04T09:03:00.000Z"), TZ).valid
    ).toBe(false);
    // Unaligned minutes fail.
    expect(
      blockValidation(new Date("2026-11-04T09:02:00.000Z"), new Date("2026-11-04T10:00:00.000Z"), TZ).valid
    ).toBe(false);
    // Spanning two days fails.
    expect(
      blockValidation(new Date("2026-11-04T23:00:00.000Z"), new Date("2026-11-05T01:00:00.000Z"), TZ).valid
    ).toBe(false);
  });

  it("capacityMath rolls up minutes and clamps free time", () => {
    const r = capacityMath(
      [
        { startAt: new Date("2026-11-04T09:00:00.000Z"), endAt: new Date("2026-11-04T10:00:00.000Z") },
        { startAt: new Date("2026-11-04T11:00:00.000Z"), endAt: new Date("2026-11-04T12:30:00.000Z") },
      ],
      480
    );
    expect(r.scheduledMin).toBe(150);
    expect(r.freeMin).toBe(330);
    expect(r.overCapacity).toBe(false);
    const over = capacityMath(
      [{ startAt: new Date("2026-11-04T09:00:00.000Z"), endAt: new Date("2026-11-04T19:00:00.000Z") }],
      480
    );
    expect(over.overCapacity).toBe(true);
    expect(over.freeMin).toBe(0);
  });

  it("snapToStepMs: exact boundaries stable, half-step rounds up", () => {
    const step = 5 * 60 * 1000;
    expect(snapToStepMs(step * 10)).toBe(step * 10);
    expect(snapToStepMs(step * 10 + step / 2)).toBe(step * 11);
  });
});

describe("view predicates", () => {
  it("today / overdue / upcoming partition active dated tasks", () => {
    expect(matchToday(TIMED_TODAY, NOW, TZ)).toBe(true);
    expect(matchToday(TOMORROW_AM, NOW, TZ)).toBe(false);
    expect(matchToday(ALLDAY_TODAY, NOW, TZ)).toBe(true);
    expect(matchOverdue({ ...YESTERDAY, status: "active" }, NOW, TZ)).toBe(true);
    expect(matchOverdue({ ...YESTERDAY, status: "done" }, NOW, TZ)).toBe(false);
    expect(matchOverdue(TIMED_TODAY, NOW, TZ)).toBe(false);
    expect(matchUpcoming({ ...TOMORROW_AM, status: "active" }, NOW, TZ)).toBe(true);
    expect(matchUpcoming(TIMED_TODAY, NOW, TZ)).toBe(false);
    expect(matchUpcoming({ dueAt: new Date("2026-11-20T09:00:00.000Z"), status: "active" }, NOW, TZ)).toBe(false);
    expect(matchUpcoming({ ...TOMORROW_AM, status: "done" }, NOW, TZ)).toBe(false);
  });

  it("noDate / completed / priority / all / date-in-day", () => {
    expect(matchNoDate(NO_DATE)).toBe(true);
    expect(matchNoDate(TIMED_TODAY)).toBe(false);
    expect(matchCompleted({ status: "done" })).toBe(true);
    expect(matchCompleted(TIMED_TODAY)).toBe(false);
    expect(matchPriority({ priority: 3 }, 2)).toBe(true);
    expect(matchPriority({ priority: 1 }, 2)).toBe(false);
    expect(matchAll(TIMED_TODAY)).toBe(true);
    expect(matchDateInDay(TOMORROW_AM, "2026-11-05", TZ)).toBe(true);
    expect(matchDateInDay(TOMORROW_AM, "2026-11-04", TZ)).toBe(false);
  });
});

describe("seeded fuzz: evaluator never throws, always boolean", () => {
  function mulberry32(seed: number) {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FIELDS = ["status", "priority", "tag", "due_at", "title", "has_recurrence", "is_subtask", "estimate_min"];
  const OPS = ["eq", "ne", "in", "lt", "gte", "between", "is_null", "not_null", "contains", "all_of"];
  const VALS: unknown[] = ["active", 1, 3, "today", "+1d", "2026-11-04", ["a", "b"], true, null, "Report"];

  function randNode(rand: () => number, depth: number): unknown {
    const r = rand();
    if (depth >= 3 || r < 0.55) {
      return {
        field: FIELDS[Math.floor(rand() * FIELDS.length)],
        op: OPS[Math.floor(rand() * OPS.length)],
        value: VALS[Math.floor(rand() * VALS.length)],
      };
    }
    if (r < 0.7) return { and: [randNode(rand, depth + 1), randNode(rand, depth + 1)] };
    if (r < 0.85) return { or: [randNode(rand, depth + 1), randNode(rand, depth + 1)] };
    return { not: randNode(rand, depth + 1) };
  }

  function randTask(rand: () => number): FilterTask {
    const pick = <T>(v: T): T | undefined => (rand() < 0.5 ? v : undefined);
    return {
      status: pick(rand() < 0.7 ? "active" : "done"),
      priority: pick(Math.floor(rand() * 5)),
      tagIds: pick(["a", "b"]),
      dueAt: pick(new Date(Date.UTC(2026, 10, 1 + Math.floor(rand() * 10), 9, 0, 0))),
      title: pick("Q3 Report"),
      allDay: pick(true),
    };
  }

  it("300 seeded DSL/task pairs evaluate without throwing", () => {
    const rand = mulberry32(42);
    for (let i = 0; i < 300; i++) {
      const node = randNode(rand, 0) as FilterNode;
      const task = randTask(rand);
      let result: unknown;
      expect(() => {
        result = evaluateFilter(node, task, ctx);
      }).not.toThrow();
      expect(typeof result).toBe("boolean");
      const check = validateFilterDsl(node);
      expect(typeof check.valid).toBe("boolean");
    }
  });
});
