import { DateTime } from "luxon";
import { dayBounds, resolveTimezone, type DayBoundsResult } from "./dayBounds";

/**
 * Shared JS mirror of the backend filter DSL (apps/backend/src/utils/filter-dsl.ts).
 *
 * evaluateFilter() reproduces compileFilterDsl() branch-for-branch so the
 * frontend can apply the same filters locally. Parity is by construction,
 * not differential: there is no live SQLite comparison in this package
 * (see test/filter-parity.test.ts honesty note).
 */

export const ALLOWED_FIELDS = [
  "status",
  "priority",
  "list_id",
  "section_id",
  "tag",
  "due_at",
  "start_at",
  "deadline_at",
  "completed_at",
  "created_at",
  "estimate_min",
  "title",
  "has_recurrence",
  "has_location",
  "is_subtask",
] as const;

export type FilterField = (typeof ALLOWED_FIELDS)[number];

export const ALLOWED_OPS = [
  "eq",
  "ne",
  "in",
  "nin",
  "lt",
  "lte",
  "gt",
  "gte",
  "between",
  "is_null",
  "not_null",
  "contains",
  "starts_with",
  "all_of",
] as const;

export type FilterOp = (typeof ALLOWED_OPS)[number];

export const RELATIVE_DATE_KEYWORDS = [
  "today",
  "tomorrow",
  "yesterday",
  "start_of_week",
  "end_of_week",
  "start_of_month",
  "end_of_month",
] as const;

export interface FilterConditionNode {
  field: string;
  op: string;
  value?: unknown;
}

export interface FilterAndNode {
  and: FilterNode[];
}

export interface FilterOrNode {
  or: FilterNode[];
}

export interface FilterNotNode {
  not: FilterNode;
}

export type FilterNode = FilterConditionNode | FilterAndNode | FilterOrNode | FilterNotNode;

export interface FilterValidationError {
  error: string;
  path: string;
  details: string;
}

/**
 * Local mirror of backend validateFilterDsl: max depth 4, max 30 nodes,
 * field/op whitelist plus per-field operator restrictions.
 */
export function validateFilterDsl(
  node: unknown,
  path = "$",
  depth = 1,
  counter: { count: number } = { count: 0 }
): { valid: true } | { valid: false; error: FilterValidationError } {
  counter.count += 1;
  if (counter.count > 30) {
    return {
      valid: false,
      error: { error: "Invalid filter DSL", path, details: "Exceeds maximum node limit of 30" },
    };
  }
  if (depth > 4) {
    return {
      valid: false,
      error: { error: "Invalid filter DSL", path, details: "Exceeds maximum depth of 4" },
    };
  }
  if (!node || typeof node !== "object") {
    return {
      valid: false,
      error: { error: "Invalid filter DSL", path, details: "Expected an object filter node" },
    };
  }
  const obj = node as Record<string, unknown>;

  if ("and" in obj) {
    if (!Array.isArray(obj.and) || obj.and.length === 0) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.and`, details: "'and' must be a non-empty array" },
      };
    }
    for (let i = 0; i < obj.and.length; i++) {
      const res = validateFilterDsl(obj.and[i], `${path}.and[${i}]`, depth + 1, counter);
      if (!res.valid) return res;
    }
    return { valid: true };
  }
  if ("or" in obj) {
    if (!Array.isArray(obj.or) || obj.or.length === 0) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.or`, details: "'or' must be a non-empty array" },
      };
    }
    for (let i = 0; i < obj.or.length; i++) {
      const res = validateFilterDsl(obj.or[i], `${path}.or[${i}]`, depth + 1, counter);
      if (!res.valid) return res;
    }
    return { valid: true };
  }
  if ("not" in obj) {
    if (!obj.not || typeof obj.not !== "object") {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.not`, details: "'not' must be a filter node object" },
      };
    }
    return validateFilterDsl(obj.not, `${path}.not`, depth + 1, counter);
  }

  if (typeof obj.field !== "string") {
    return {
      valid: false,
      error: { error: "Invalid filter DSL", path: `${path}.field`, details: "Missing or invalid 'field'" },
    };
  }
  if (!(ALLOWED_FIELDS as readonly string[]).includes(obj.field)) {
    return {
      valid: false,
      error: { error: "Invalid filter DSL", path: `${path}.field`, details: `Field '${obj.field}' is not allowed` },
    };
  }
  if (typeof obj.op !== "string" || !(ALLOWED_OPS as readonly string[]).includes(obj.op)) {
    return {
      valid: false,
      error: { error: "Invalid filter DSL", path: `${path}.op`, details: `Operator '${obj.op}' is not allowed` },
    };
  }

  const field = obj.field;
  const op = obj.op;

  if (["has_recurrence", "has_location", "is_subtask"].includes(field)) {
    if (!["eq", "ne"].includes(op)) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.op`, details: `Field '${field}' only supports 'eq' and 'ne' operators` },
      };
    }
  }
  if (field === "title") {
    if (!["eq", "ne", "contains", "starts_with"].includes(op)) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.op`, details: `Field 'title' only supports 'eq', 'ne', 'contains', and 'starts_with'` },
      };
    }
  }
  if (field === "tag") {
    if (!["eq", "ne", "in", "nin", "all_of"].includes(op)) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.op`, details: `Field 'tag' only supports 'eq', 'ne', 'in', 'nin', and 'all_of'` },
      };
    }
    if ((op === "in" || op === "nin" || op === "all_of") && !Array.isArray(obj.value)) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.value`, details: `Operator '${op}' on tag requires an array of values` },
      };
    }
  }
  if (["in", "nin"].includes(op) && field !== "tag") {
    if (!Array.isArray(obj.value)) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.value`, details: `Operator '${op}' requires an array of values` },
      };
    }
  }
  if (op === "between") {
    if (!Array.isArray(obj.value) || obj.value.length !== 2) {
      return {
        valid: false,
        error: { error: "Invalid filter DSL", path: `${path}.value`, details: "Operator 'between' requires a 2-element array [from, to]" },
      };
    }
  }
  return { valid: true };
}

/** Task shape accepted by evaluateFilter. Both camelCase and snake_case keys are read. */
export interface FilterTask {
  status?: string | null;
  priority?: number | null;
  listId?: string | null;
  list_id?: string | null;
  sectionId?: string | null;
  section_id?: string | null;
  tagIds?: string[] | null;
  tagNames?: string[] | null;
  dueAt?: Date | number | string | null;
  due_at?: Date | number | string | null;
  startAt?: Date | number | string | null;
  start_at?: Date | number | string | null;
  deadlineAt?: Date | number | string | null;
  deadline_at?: Date | number | string | null;
  completedAt?: Date | number | string | null;
  completed_at?: Date | number | string | null;
  createdAt?: Date | number | string | null;
  created_at?: Date | number | string | null;
  estimateMin?: number | null;
  estimate_min?: number | null;
  title?: string | null;
  recurrenceId?: string | null;
  recurrence_id?: string | null;
  placeId?: string | null;
  place_id?: string | null;
  locationName?: string | null;
  location_name?: string | null;
  parentId?: string | null;
  parent_id?: string | null;
  allDay?: boolean | null;
  all_day?: boolean | null;
}

export interface FilterContext {
  tz?: string;
  /** Reference instant for relative keywords (today, +Nd, ...). Defaults to now. */
  now?: Date | number;
}

const DATE_FIELDS = new Set(["due_at", "start_at", "deadline_at", "completed_at", "created_at"]);
/** due_at / start_at use the all-day two-branch comparison in backend SQL. */
const ALL_DAY_AWARE_FIELDS = new Set(["due_at", "start_at"]);

function pick<T>(task: FilterTask, camel: keyof FilterTask, snake: keyof FilterTask): T | null | undefined {
  const c = task[camel] as T | null | undefined;
  if (c !== undefined) return c;
  return task[snake] as T | null | undefined;
}

function toMs(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "number") return isNaN(v) ? null : v;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return isNaN(t) ? null : t;
  }
  return null;
}

function truthyFlag(v: unknown): boolean {
  return v === true || v === "true" || v === 1;
}

/**
 * Mirror of backend resolveDateBoundary with injectable `now` for determinism.
 * Keywords/offsets resolve against now in tz; ISO strings resolve directly.
 */
export function resolveDateBoundary(val: unknown, tz = "UTC", now?: Date | number): DayBoundsResult {
  const safeTz = resolveTimezone(tz);
  const ref = DateTime.fromJSDate(now !== undefined ? new Date(now) : new Date()).setZone(safeTz);

  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();
    if (lower === "today") return dayBounds(ref.toJSDate(), safeTz);
    if (lower === "tomorrow") return dayBounds(ref.plus({ days: 1 }).toJSDate(), safeTz);
    if (lower === "yesterday") return dayBounds(ref.minus({ days: 1 }).toJSDate(), safeTz);
    if (lower === "start_of_week") return dayBounds(ref.startOf("week").toJSDate(), safeTz);
    if (lower === "end_of_week") return dayBounds(ref.endOf("week").toJSDate(), safeTz);
    if (lower === "start_of_month") return dayBounds(ref.startOf("month").toJSDate(), safeTz);
    if (lower === "end_of_month") return dayBounds(ref.endOf("month").toJSDate(), safeTz);

    const offsetMatch = lower.match(/^([+-]?\d+)([dwm])$/);
    if (offsetMatch) {
      const amount = parseInt(offsetMatch[1], 10);
      const unit = offsetMatch[2];
      let target: DateTime;
      if (unit === "d") target = ref.plus({ days: amount });
      else if (unit === "w") target = ref.plus({ weeks: amount });
      else target = ref.plus({ months: amount });
      return dayBounds(target.toJSDate(), safeTz);
    }
    return dayBounds(val, safeTz);
  }
  if (val instanceof Date) return dayBounds(val, safeTz);
  if (typeof val === "number") return dayBounds(val, safeTz);
  return dayBounds(ref.toJSDate(), safeTz);
}

function evalDateField(
  taskMs: number | null,
  allDay: boolean,
  op: string,
  value: unknown,
  tz: string,
  now: Date | number | undefined
): boolean {
  if (op === "is_null") return taskMs === null;
  if (op === "not_null") return taskMs !== null;
  // SQL NULL semantics: any other comparison against NULL is falsy.
  if (taskMs === null) return false;

  if (op === "between") {
    const arr = Array.isArray(value) ? value : [value];
    const bFrom = resolveDateBoundary(arr[0], tz, now);
    const bTo = resolveDateBoundary(arr[1], tz, now);
    if (allDay) {
      return taskMs >= bFrom.floatStart.getTime() && taskMs < bTo.floatEnd.getTime();
    }
    return taskMs >= bFrom.startUtc.getTime() && taskMs < bTo.endUtc.getTime();
  }

  const b = resolveDateBoundary(value, tz, now);
  const s = b.startUtc.getTime();
  const e = b.endUtc.getTime();
  const fs = b.floatStart.getTime();
  const fe = b.floatEnd.getTime();
  const lo = allDay ? fs : s;
  const hi = allDay ? fe : e;

  switch (op) {
    case "eq":
      return taskMs >= lo && taskMs < hi;
    case "ne":
      return !(taskMs >= lo && taskMs < hi);
    case "lt":
      return taskMs < lo;
    case "lte":
      // Backend implements lte as `< end-of-day` (strictly before day end).
      return taskMs < hi;
    case "gt":
      // Backend implements gt as `>= end-of-day`.
      return taskMs >= hi;
    case "gte":
      return taskMs >= lo;
    default:
      return false;
  }
}

function cmpScalar(fieldVal: unknown, op: string, value: unknown): boolean {
  if (op === "is_null") return fieldVal === null || fieldVal === undefined;
  if (op === "not_null") return fieldVal !== null && fieldVal !== undefined;
  if (fieldVal === null || fieldVal === undefined) return false;

  switch (op) {
    case "eq":
      // eslint-disable-next-line eqeqeq
      return fieldVal == value;
    case "ne":
      // eslint-disable-next-line eqeqeq
      return fieldVal != value;
    case "lt":
      return (fieldVal as number) < (value as number);
    case "lte":
      return (fieldVal as number) <= (value as number);
    case "gt":
      return (fieldVal as number) > (value as number);
    case "gte":
      return (fieldVal as number) >= (value as number);
    case "in": {
      const arr = Array.isArray(value) ? value : [value];
      // eslint-disable-next-line eqeqeq
      return arr.some((v) => v == fieldVal);
    }
    case "nin": {
      const arr = Array.isArray(value) ? value : [value];
      // eslint-disable-next-line eqeqeq
      return !arr.some((v) => v == fieldVal);
    }
    case "between": {
      const arr = Array.isArray(value) ? value : [value];
      return (fieldVal as number) >= (arr[0] as number) && (fieldVal as number) <= (arr[1] as number);
    }
    case "contains":
      if (value === null || value === undefined) return false;
      return String(fieldVal).toLowerCase().includes(String(value).toLowerCase());
    case "starts_with":
      if (value === null || value === undefined) return false;
      return String(fieldVal).toLowerCase().startsWith(String(value).toLowerCase());
    default:
      return false;
  }
}

function evalTag(task: FilterTask, op: string, value: unknown): boolean {
  const tags = [...(task.tagIds ?? []), ...(task.tagNames ?? [])].filter(
    (t): t is string => typeof t === "string"
  );
  const has = (v: unknown) => tags.includes(v as string);
  switch (op) {
    case "eq":
      return has(value);
    case "ne":
      return !has(value);
    case "in": {
      const arr = Array.isArray(value) ? value : [value];
      if (arr.length === 0) return false;
      return arr.some(has);
    }
    case "nin": {
      const arr = Array.isArray(value) ? value : [value];
      if (arr.length === 0) return true;
      return !arr.some(has);
    }
    case "all_of": {
      const arr = Array.isArray(value) ? value : [value];
      if (arr.length === 0) return true;
      return arr.every(has);
    }
    default:
      return false;
  }
}

function evaluateCondition(node: FilterConditionNode, task: FilterTask, ctx: FilterContext): boolean {
  const { field, op, value } = node;
  const tz = resolveTimezone(ctx.tz);

  if (field === "has_recurrence") {
    const has = pick<string>(task, "recurrenceId", "recurrence_id") != null;
    const want = op === "eq" ? truthyFlag(value) : !truthyFlag(value);
    return has === want;
  }
  if (field === "has_location") {
    const has =
      pick<string>(task, "placeId", "place_id") != null ||
      pick<string>(task, "locationName", "location_name") != null;
    const want = op === "eq" ? truthyFlag(value) : !truthyFlag(value);
    return has === want;
  }
  if (field === "is_subtask") {
    const has = pick<string>(task, "parentId", "parent_id") != null;
    const want = op === "eq" ? truthyFlag(value) : !truthyFlag(value);
    return has === want;
  }
  if (field === "tag") return evalTag(task, op, value);

  if (DATE_FIELDS.has(field)) {
    let raw: unknown;
    switch (field) {
      case "due_at":
        raw = pick(task, "dueAt", "due_at");
        break;
      case "start_at":
        raw = pick(task, "startAt", "start_at");
        break;
      case "deadline_at":
        raw = pick(task, "deadlineAt", "deadline_at");
        break;
      case "completed_at":
        raw = pick(task, "completedAt", "completed_at");
        break;
      default:
        raw = pick(task, "createdAt", "created_at");
        break;
    }
    const aware = ALL_DAY_AWARE_FIELDS.has(field);
    const allDay = aware ? (pick<boolean>(task, "allDay", "all_day") ?? false) : false;
    return evalDateField(toMs(raw), allDay, op, value, tz, ctx.now);
  }

  switch (field) {
    case "status":
      return cmpScalar(task.status ?? null, op, value);
    case "priority":
      return cmpScalar(task.priority ?? null, op, value);
    case "list_id":
      return cmpScalar(pick<string>(task, "listId", "list_id") ?? null, op, value);
    case "section_id":
      return cmpScalar(pick<string>(task, "sectionId", "section_id") ?? null, op, value);
    case "estimate_min":
      return cmpScalar(pick<number>(task, "estimateMin", "estimate_min") ?? null, op, value);
    case "title":
      return cmpScalar(task.title ?? null, op, value);
    default:
      return false;
  }
}

/**
 * Evaluate a filter DSL node against a task. Invalid/unknown nodes are falsy.
 * Date comparisons mirror backend SQL exactly, including the all-day
 * two-branch rule for due_at/start_at and half-open [from.start, to.end)
 * ranges for eq/between.
 */
export function evaluateFilter(node: FilterNode, task: FilterTask, ctx: FilterContext = {}): boolean {
  if (!node || typeof node !== "object") return false;
  const obj = node as unknown as Record<string, unknown>;
  if ("and" in obj && Array.isArray(obj.and)) {
    return (obj.and as FilterNode[]).every((child) => evaluateFilter(child, task, ctx));
  }
  if ("or" in obj && Array.isArray(obj.or)) {
    return (obj.or as FilterNode[]).some((child) => evaluateFilter(child, task, ctx));
  }
  if ("not" in obj && obj.not && typeof obj.not === "object") {
    return !evaluateFilter(obj.not as FilterNode, task, ctx);
  }
  if (typeof obj.field === "string" && typeof obj.op === "string") {
    return evaluateCondition(obj as unknown as FilterConditionNode, task, ctx);
  }
  return false;
}
