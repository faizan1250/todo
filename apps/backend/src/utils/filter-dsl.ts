import { dayBounds, resolveTimezone, toUtcMidnight } from "./dates";
import { DateTime } from "luxon";

export type DayBoundaries = ReturnType<typeof dayBounds>;

export interface FilterConditionNode {
  field: string;
  op: string;
  value?: any;
}

export interface FilterCompoundNode {
  and?: FilterNode[];
  or?: FilterNode[];
  not?: FilterNode;
}

export type FilterNode = FilterConditionNode | FilterCompoundNode;

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

export const RELATIVE_DATE_KEYWORDS = [
  "today",
  "tomorrow",
  "yesterday",
  "start_of_week",
  "end_of_week",
  "start_of_month",
  "end_of_month",
] as const;

export interface ValidationError {
  error: string;
  path: string;
  details: string;
}

/**
 * Validates Filter DSL AST:
 * - Max depth: 4
 * - Max nodes: 30
 * - Field and operator whitelist
 */
export function validateFilterDsl(
  node: unknown,
  path = "$",
  depth = 1,
  counter = { count: 0 }
): { valid: true } | { valid: false; error: ValidationError } {
  counter.count += 1;
  if (counter.count > 30) {
    return {
      valid: false,
      error: {
        error: "Invalid filter DSL",
        path,
        details: "Exceeds maximum node limit of 30",
      },
    };
  }

  if (depth > 4) {
    return {
      valid: false,
      error: {
        error: "Invalid filter DSL",
        path,
        details: "Exceeds maximum depth of 4",
      },
    };
  }

  if (!node || typeof node !== "object") {
    return {
      valid: false,
      error: {
        error: "Invalid filter DSL",
        path,
        details: "Expected an object filter node",
      },
    };
  }

  const obj = node as Record<string, any>;

  // Check compound nodes
  if ("and" in obj) {
    if (!Array.isArray(obj.and) || obj.and.length === 0) {
      return {
        valid: false,
        error: {
          error: "Invalid filter DSL",
          path: `${path}.and`,
          details: "'and' must be a non-empty array",
        },
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
        error: {
          error: "Invalid filter DSL",
          path: `${path}.or`,
          details: "'or' must be a non-empty array",
        },
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
        error: {
          error: "Invalid filter DSL",
          path: `${path}.not`,
          details: "'not' must be a filter node object",
        },
      };
    }
    return validateFilterDsl(obj.not, `${path}.not`, depth + 1, counter);
  }

  // Leaf condition node
  if (typeof obj.field !== "string") {
    return {
      valid: false,
      error: {
        error: "Invalid filter DSL",
        path: `${path}.field`,
        details: "Missing or invalid 'field'",
      },
    };
  }

  if (!ALLOWED_FIELDS.includes(obj.field as any)) {
    return {
      valid: false,
      error: {
        error: "Invalid filter DSL",
        path: `${path}.field`,
        details: `Field '${obj.field}' is not allowed`,
      },
    };
  }

  if (typeof obj.op !== "string" || !ALLOWED_OPS.includes(obj.op as any)) {
    return {
      valid: false,
      error: {
        error: "Invalid filter DSL",
        path: `${path}.op`,
        details: `Operator '${obj.op}' is not allowed`,
      },
    };
  }

  // Operator validity per field type
  const field = obj.field;
  const op = obj.op;

  if (["has_recurrence", "has_location", "is_subtask"].includes(field)) {
    if (!["eq", "ne"].includes(op)) {
      return {
        valid: false,
        error: {
          error: "Invalid filter DSL",
          path: `${path}.op`,
          details: `Field '${field}' only supports 'eq' and 'ne' operators`,
        },
      };
    }
  }

  if (["title"].includes(field)) {
    if (!["eq", "ne", "contains", "starts_with"].includes(op)) {
      return {
        valid: false,
        error: {
          error: "Invalid filter DSL",
          path: `${path}.op`,
          details: `Field 'title' only supports 'eq', 'ne', 'contains', and 'starts_with'`,
        },
      };
    }
  }

  if (field === "tag") {
    if (!["eq", "ne", "in", "nin", "all_of"].includes(op)) {
      return {
        valid: false,
        error: {
          error: "Invalid filter DSL",
          path: `${path}.op`,
          details: `Field 'tag' only supports 'eq', 'ne', 'in', 'nin', and 'all_of'`,
        },
      };
    }
    if ((op === "in" || op === "nin" || op === "all_of") && !Array.isArray(obj.value)) {
      return {
        valid: false,
        error: {
          error: "Invalid filter DSL",
          path: `${path}.value`,
          details: `Operator '${op}' on tag requires an array of values`,
        },
      };
    }
  }

  if (["in", "nin"].includes(op) && field !== "tag") {
    if (!Array.isArray(obj.value)) {
      return {
        valid: false,
        error: {
          error: "Invalid filter DSL",
          path: `${path}.value`,
          details: `Operator '${op}' requires an array of values`,
        },
      };
    }
  }

  if (op === "between") {
    if (!Array.isArray(obj.value) || obj.value.length !== 2) {
      return {
        valid: false,
        error: {
          error: "Invalid filter DSL",
          path: `${path}.value`,
          details: "Operator 'between' requires a 2-element array [from, to]",
        },
      };
    }
  }

  return { valid: true };
}

/**
 * Resolves a date string, keyword, or relative offset (±Nd/Nw/Nm) to local day boundaries.
 */
export function resolveDateBoundary(val: any, tz = "UTC"): DayBoundaries {
  const safeTz = resolveTimezone(tz);
  const now = DateTime.now().setZone(safeTz);

  if (typeof val === "string") {
    const lower = val.trim().toLowerCase();

    if (lower === "today") {
      return dayBounds(now.toJSDate(), safeTz);
    }
    if (lower === "tomorrow") {
      return dayBounds(now.plus({ days: 1 }).toJSDate(), safeTz);
    }
    if (lower === "yesterday") {
      return dayBounds(now.minus({ days: 1 }).toJSDate(), safeTz);
    }
    if (lower === "start_of_week") {
      return dayBounds(now.startOf("week").toJSDate(), safeTz);
    }
    if (lower === "end_of_week") {
      return dayBounds(now.endOf("week").toJSDate(), safeTz);
    }
    if (lower === "start_of_month") {
      return dayBounds(now.startOf("month").toJSDate(), safeTz);
    }
    if (lower === "end_of_month") {
      return dayBounds(now.endOf("month").toJSDate(), safeTz);
    }

    // Relative offsets: +3d, -2w, +1m
    const offsetMatch = lower.match(/^([+-]?\d+)([dwm])$/);
    if (offsetMatch) {
      const amount = parseInt(offsetMatch[1], 10);
      const unit = offsetMatch[2];
      let target: DateTime;
      if (unit === "d") target = now.plus({ days: amount });
      else if (unit === "w") target = now.plus({ weeks: amount });
      else target = now.plus({ months: amount });
      return dayBounds(target.toJSDate(), safeTz);
    }

    // ISO date or timestamp
    return dayBounds(val, safeTz);
  }

  if (val instanceof Date) {
    return dayBounds(val, safeTz);
  }

  return dayBounds(now.toJSDate(), safeTz);
}

/**
 * Compiles a validated FilterNode AST into a parameterized SQL condition string and parameters array.
 */
export function compileFilterDsl(
  node: FilterNode,
  tz = "UTC",
  tableAlias = "t"
): { sql: string; params: any[] } {
  const params: any[] = [];

  function compileNode(n: FilterNode): string {
    const obj = n as any;

    if ("and" in obj && Array.isArray(obj.and)) {
      const parts = obj.and.map((child: FilterNode) => compileNode(child));
      return parts.length === 1 ? parts[0] : `(${parts.join(" AND ")})`;
    }

    if ("or" in obj && Array.isArray(obj.or)) {
      const parts = obj.or.map((child: FilterNode) => compileNode(child));
      return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
    }

    if ("not" in obj && obj.not) {
      return `(NOT ${compileNode(obj.not)})`;
    }

    const { field, op, value } = obj;

    // Computed / Boolean fields
    if (field === "has_recurrence") {
      const isTrue = value === true || value === "true" || value === 1;
      const wantTrue = op === "eq" ? isTrue : !isTrue;
      return wantTrue ? `${tableAlias}.recurrence_id IS NOT NULL` : `${tableAlias}.recurrence_id IS NULL`;
    }

    if (field === "has_location") {
      const isTrue = value === true || value === "true" || value === 1;
      const wantTrue = op === "eq" ? isTrue : !isTrue;
      return wantTrue
        ? `(${tableAlias}.place_id IS NOT NULL OR ${tableAlias}.location_name IS NOT NULL)`
        : `(${tableAlias}.place_id IS NULL AND ${tableAlias}.location_name IS NULL)`;
    }

    if (field === "is_subtask") {
      const isTrue = value === true || value === "true" || value === 1;
      const wantTrue = op === "eq" ? isTrue : !isTrue;
      return wantTrue ? `${tableAlias}.parent_id IS NOT NULL` : `${tableAlias}.parent_id IS NULL`;
    }

    // Tag field
    if (field === "tag") {
      if (op === "eq" || op === "ne") {
        params.push(value, value);
        const existsClause = `EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = ${tableAlias}.id AND (tg.name = ? OR tg.id = ?) AND tg.deleted_at IS NULL)`;
        return op === "eq" ? existsClause : `(NOT ${existsClause})`;
      }

      if (op === "in" || op === "nin") {
        const arr = Array.isArray(value) ? value : [value];
        if (arr.length === 0) {
          return op === "in" ? "0 = 1" : "1 = 1";
        }
        const placeholders = arr.map(() => "?").join(", ");
        params.push(...arr, ...arr);
        const inClause = `EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = ${tableAlias}.id AND (tg.name IN (${placeholders}) OR tg.id IN (${placeholders})) AND tg.deleted_at IS NULL)`;
        return op === "in" ? inClause : `(NOT ${inClause})`;
      }

      if (op === "all_of") {
        const arr = Array.isArray(value) ? value : [value];
        if (arr.length === 0) return "1 = 1";
        const clauses: string[] = [];
        for (const t of arr) {
          params.push(t, t);
          clauses.push(
            `EXISTS (SELECT 1 FROM task_tags tt JOIN tags tg ON tg.id = tt.tag_id WHERE tt.task_id = ${tableAlias}.id AND (tg.name = ? OR tg.id = ?) AND tg.deleted_at IS NULL)`
          );
        }
        return `(${clauses.join(" AND ")})`;
      }
    }

    // Date fields (due_at, start_at, deadline_at, completed_at, created_at)
    const dateFields = ["due_at", "start_at", "deadline_at", "completed_at", "created_at"];
    if (dateFields.includes(field)) {
      const col = `${tableAlias}.${field}`;

      if (op === "is_null") return `${col} IS NULL`;
      if (op === "not_null") return `${col} IS NOT NULL`;

      // Fields with all_day handling: due_at, start_at
      const hasAllDay = field === "due_at" || field === "start_at";

      if (op === "between") {
        const bFrom = resolveDateBoundary(value[0], tz);
        const bTo = resolveDateBoundary(value[1], tz);

        if (hasAllDay) {
          params.push(
            bFrom.startUtc.getTime(),
            bTo.endUtc.getTime(),
            bFrom.floatStart.getTime(),
            bTo.floatEnd.getTime()
          );
          return `((${tableAlias}.all_day = 0 AND ${col} >= ? AND ${col} < ?) OR (${tableAlias}.all_day = 1 AND ${col} >= ? AND ${col} < ?))`;
        } else {
          params.push(bFrom.startUtc.getTime(), bTo.endUtc.getTime());
          return `(${col} >= ? AND ${col} < ?)`;
        }
      }

      const bounds = resolveDateBoundary(value, tz);

      if (op === "eq") {
        if (hasAllDay) {
          params.push(
            bounds.startUtc.getTime(),
            bounds.endUtc.getTime(),
            bounds.floatStart.getTime(),
            bounds.floatEnd.getTime()
          );
          return `((${tableAlias}.all_day = 0 AND ${col} >= ? AND ${col} < ?) OR (${tableAlias}.all_day = 1 AND ${col} >= ? AND ${col} < ?))`;
        } else {
          params.push(bounds.startUtc.getTime(), bounds.endUtc.getTime());
          return `(${col} >= ? AND ${col} < ?)`;
        }
      }

      if (op === "ne") {
        if (hasAllDay) {
          params.push(
            bounds.startUtc.getTime(),
            bounds.endUtc.getTime(),
            bounds.floatStart.getTime(),
            bounds.floatEnd.getTime()
          );
          return `NOT ((${tableAlias}.all_day = 0 AND ${col} >= ? AND ${col} < ?) OR (${tableAlias}.all_day = 1 AND ${col} >= ? AND ${col} < ?))`;
        } else {
          params.push(bounds.startUtc.getTime(), bounds.endUtc.getTime());
          return `NOT (${col} >= ? AND ${col} < ?)`;
        }
      }

      if (op === "lt") {
        if (hasAllDay) {
          params.push(bounds.startUtc.getTime(), bounds.floatStart.getTime());
          return `((${tableAlias}.all_day = 0 AND ${col} < ?) OR (${tableAlias}.all_day = 1 AND ${col} < ?))`;
        } else {
          params.push(bounds.startUtc.getTime());
          return `(${col} < ?)`;
        }
      }

      if (op === "lte") {
        if (hasAllDay) {
          params.push(bounds.endUtc.getTime(), bounds.floatEnd.getTime());
          return `((${tableAlias}.all_day = 0 AND ${col} < ?) OR (${tableAlias}.all_day = 1 AND ${col} < ?))`;
        } else {
          params.push(bounds.endUtc.getTime());
          return `(${col} < ?)`;
        }
      }

      if (op === "gt") {
        if (hasAllDay) {
          params.push(bounds.endUtc.getTime(), bounds.floatEnd.getTime());
          return `((${tableAlias}.all_day = 0 AND ${col} >= ?) OR (${tableAlias}.all_day = 1 AND ${col} >= ?))`;
        } else {
          params.push(bounds.endUtc.getTime());
          return `(${col} >= ?)`;
        }
      }

      if (op === "gte") {
        if (hasAllDay) {
          params.push(bounds.startUtc.getTime(), bounds.floatStart.getTime());
          return `((${tableAlias}.all_day = 0 AND ${col} >= ?) OR (${tableAlias}.all_day = 1 AND ${col} >= ?))`;
        } else {
          params.push(bounds.startUtc.getTime());
          return `(${col} >= ?)`;
        }
      }
    }

    // Scalar fields: status, priority, list_id, section_id, estimate_min, title
    const colName = `${tableAlias}.${field}`;

    if (op === "is_null") return `${colName} IS NULL`;
    if (op === "not_null") return `${colName} IS NOT NULL`;

    if (op === "eq") {
      params.push(value);
      return `${colName} = ?`;
    }

    if (op === "ne") {
      params.push(value);
      return `${colName} != ?`;
    }

    if (op === "lt") {
      params.push(value);
      return `${colName} < ?`;
    }

    if (op === "lte") {
      params.push(value);
      return `${colName} <= ?`;
    }

    if (op === "gt") {
      params.push(value);
      return `${colName} > ?`;
    }

    if (op === "gte") {
      params.push(value);
      return `${colName} >= ?`;
    }

    if (op === "in" || op === "nin") {
      const arr = Array.isArray(value) ? value : [value];
      if (arr.length === 0) return op === "in" ? "0 = 1" : "1 = 1";
      const placeholders = arr.map(() => "?").join(", ");
      params.push(...arr);
      return `${colName} ${op === "in" ? "IN" : "NOT IN"} (${placeholders})`;
    }

    if (op === "between") {
      params.push(value[0], value[1]);
      return `(${colName} >= ? AND ${colName} <= ?)`;
    }

    if (op === "contains") {
      params.push(`%${value}%`);
      return `${colName} LIKE ?`;
    }

    if (op === "starts_with") {
      params.push(`${value}%`);
      return `${colName} LIKE ?`;
    }

    return "1 = 1";
  }

  const sql = compileNode(node);
  return { sql, params };
}
