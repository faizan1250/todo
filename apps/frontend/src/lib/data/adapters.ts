// Dexie-row → TaskItem adapter (Phase 5 cutover 6b, READS only).
//
// Dexie task rows are flat server-shape rows: camelCase keys, UTC ms
// timestamps (normalizeRow in lib/sync2/apply.ts converts Dates), and an
// embedded `tagIds: string[]` (backend sync route). Nested relations live
// in their own tables (tags, checklistItems, reminders, child task rows),
// so this module rehydrates them with a fixed batch of indexed queries and
// then reuses backendTaskToTaskItem() as the single field-mapping authority
// (same defaults for priority/status/folder/list inference, timestamps).

import type {
  BackendChecklistItem,
  BackendReminder,
  BackendTag,
  BackendTask,
} from "../api";
import { backendTaskToTaskItem } from "../adapters";
import type { TaskItem } from "@/components/app/types";
import { getDB } from "../db/schema";
import type { LocalTask } from "./types";

type Ctx = {
  tagNameById: Map<string, string>;
  childrenByParent: Map<string, LocalTask[]>;
  checklistByTask: Map<string, Record<string, unknown>[]>;
  reminderByTask: Map<string, Record<string, unknown>[]>;
};

const EMPTY_CTX: Ctx = {
  tagNameById: new Map(),
  childrenByParent: new Map(),
  checklistByTask: new Map(),
  reminderByTask: new Map(),
};

function isAliveRow(row: Record<string, unknown>): boolean {
  return row["deleted"] !== 1 && row["deletedAt"] == null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is string => typeof t === "string");
}

function asMs(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function asStatus(v: unknown): BackendTask["status"] {
  return v === "todo" || v === "in_progress" || v === "done" || v === "cancelled"
    ? v
    : "todo";
}

function asTrigger(v: unknown): "arrive" | "leave" | null {
  return v === "arrive" || v === "leave" ? v : null;
}

function asRecurrenceRule(row: LocalTask): BackendTask["recurrenceRule"] {
  for (const key of ["recurrenceRule", "recurrence"] as const) {
    const v = row[key];
    if (v && typeof v === "object") {
      const r = v as { rrule?: unknown; mode?: unknown };
      if (typeof r.rrule === "string") {
        return {
          rrule: r.rrule,
          mode: r.mode === "after_completion" ? "after_completion" : "fixed",
        };
      }
    }
  }
  return null;
}

function toBackendChecklist(
  taskId: string,
  rows: Record<string, unknown>[]
): BackendChecklistItem[] {
  return rows.map((c) => ({
    id: typeof c["id"] === "string" ? c["id"] : "",
    userId: "",
    taskId,
    text: typeof c["text"] === "string" ? c["text"] : "",
    done: c["done"] === true,
    position: typeof c["position"] === "string" ? c["position"] : "",
    createdAt: asMs(c["createdAt"]) ?? 0,
    updatedAt: asMs(c["updatedAt"]) ?? 0,
    version: typeof c["version"] === "number" ? c["version"] : 0,
  }));
}

function toBackendReminders(
  taskId: string,
  rows: Record<string, unknown>[]
): BackendReminder[] {
  return rows.map((r) => ({
    id: typeof r["id"] === "string" ? r["id"] : "",
    userId: "",
    taskId,
    kind: r["kind"] === "absolute" ? "absolute" : "relative",
    relativeTo:
      r["relativeTo"] === "due" ||
      r["relativeTo"] === "start" ||
      r["relativeTo"] === "deadline"
        ? r["relativeTo"]
        : null,
    offsetMin: typeof r["offsetMin"] === "number" ? r["offsetMin"] : null,
    remindAt: asMs(r["remindAt"]) ?? 0,
    firedAt: asMs(r["firedAt"]),
    createdAt: asMs(r["createdAt"]) ?? 0,
    updatedAt: asMs(r["updatedAt"]) ?? 0,
    version: typeof r["version"] === "number" ? r["version"] : 0,
  }));
}

/** Rebuild a BackendTask-shaped object from a flat Dexie row + relations. */
function toBackendSubtree(row: LocalTask, ctx: Ctx, depth: number): BackendTask {
  const tagIds = asStringArray(row.tagIds);
  const tags: BackendTag[] = tagIds.map((id) => ({
    id,
    userId: "",
    name: ctx.tagNameById.get(id) ?? id,
    createdAt: 0,
    updatedAt: 0,
    version: 0,
  }));

  const kids =
    depth >= 3 ? [] : (ctx.childrenByParent.get(row.id) ?? []);
  const subtasks = kids.map((k) => toBackendSubtree(k, ctx, depth + 1));

  return {
    id: row.id,
    userId: typeof row["userId"] === "string" ? (row["userId"] as string) : "",
    listId: row.listId,
    sectionId: row.sectionId ?? null,
    parentId: row.parentId ?? null,
    title: typeof row.title === "string" ? row.title : "",
    notes: typeof row.notes === "string" ? row.notes : null,
    status: asStatus(row.status),
    priority: typeof row.priority === "number" ? row.priority : 1,
    position: typeof row.position === "string" ? row.position : "",
    startAt: asMs(row.startAt),
    dueAt: asMs(row.dueAt),
    deadlineAt: asMs(row.deadlineAt),
    allDay: row.allDay === true,
    estimateMin: typeof row.estimateMin === "number" ? row.estimateMin : null,
    estimateTotal:
      typeof row["estimateTotal"] === "number"
        ? (row["estimateTotal"] as number)
        : null,
    recurrenceId:
      typeof row.recurrenceId === "string" ? row.recurrenceId : null,
    recurrenceRule: asRecurrenceRule(row),
    placeId: typeof row["placeId"] === "string" ? (row["placeId"] as string) : null,
    locationName:
      typeof row["locationName"] === "string"
        ? (row["locationName"] as string)
        : null,
    lat: typeof row["lat"] === "number" ? (row["lat"] as number) : null,
    lng: typeof row["lng"] === "number" ? (row["lng"] as number) : null,
    radiusM:
      typeof row["radiusM"] === "number" ? (row["radiusM"] as number) : null,
    locationTrigger: asTrigger(row["locationTrigger"]),
    completedAt: asMs(row.completedAt),
    archivedAt: asMs(row.archivedAt),
    createdAt: asMs(row.createdAt) ?? 0,
    updatedAt: asMs(row.updatedAt) ?? Date.now(),
    version: typeof row["version"] === "number" ? (row["version"] as number) : 0,
    deletedAt: asMs(row.deletedAt),
    subtasks,
    checklist: toBackendChecklist(
      row.id,
      ctx.checklistByTask.get(row.id) ?? []
    ),
    tags,
    reminders: toBackendReminders(
      row.id,
      ctx.reminderByTask.get(row.id) ?? []
    ),
  };
}

/**
 * Sync single-row mapping. Tags resolve via `tagNameById`; relations not
 * supplied default to empty (no extra queries). Prefer
 * `dexieRowsToTaskItems` for list reads — it rehydrates everything in one
 * batched pass.
 */
export function dexieRowToTaskItem(
  row: LocalTask,
  tagNameById?: Map<string, string>
): TaskItem {
  const ctx: Ctx =
    tagNameById !== undefined
      ? { ...EMPTY_CTX, tagNameById }
      : EMPTY_CTX;
  return backendTaskToTaskItem(toBackendSubtree(row, ctx, 1));
}

function groupBy(
  rows: Record<string, unknown>[],
  key: string
): Map<string, Record<string, unknown>[]> {
  const out = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const k = r[key];
    if (typeof k !== "string" || !k) continue;
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

/**
 * Batch mapping for list reads: one indexed query each for tags, checklist
 * items, and reminders, plus up to two parentId lookups for subtask depth
 * (max 3 levels, matching backend nesting). Input order is preserved.
 */
export async function dexieRowsToTaskItems(
  userId: string,
  rows: LocalTask[]
): Promise<TaskItem[]> {
  const db = getDB(userId);
  const ids = rows.map((r) => r.id);

  const [tagRows, checkRows, remRows, childRows] = await Promise.all([
    db.tags.toArray(),
    ids.length > 0
      ? db.checklistItems.where("taskId").anyOf(ids).toArray()
      : Promise.resolve([]),
    ids.length > 0
      ? db.reminders.where("taskId").anyOf(ids).toArray()
      : Promise.resolve([]),
    ids.length > 0
      ? db.tasks.where("parentId").anyOf(ids).toArray()
      : Promise.resolve([]),
  ]);

  const children = (childRows as unknown as LocalTask[]).filter((r) =>
    isAliveRow(r as unknown as Record<string, unknown>)
  );
  const childIds = children.map((c) => c.id);
  const grandRows =
    childIds.length > 0
      ? await db.tasks.where("parentId").anyOf(childIds).toArray()
      : [];
  const grandchildren = (grandRows as unknown as LocalTask[]).filter((r) =>
    isAliveRow(r as unknown as Record<string, unknown>)
  );

  const tagNameById = new Map<string, string>();
  for (const t of tagRows) {
    if (!isAliveRow(t)) continue;
    if (typeof t["id"] === "string" && typeof t["name"] === "string") {
      tagNameById.set(t["id"] as string, t["name"] as string);
    }
  }

  const allById = new Map<string, LocalTask>();
  for (const r of [...rows, ...children, ...grandchildren]) {
    if (!allById.has(r.id)) allById.set(r.id, r);
  }
  const childrenByParent = new Map<string, LocalTask[]>();
  for (const r of allById.values()) {
    const pid = r.parentId;
    if (typeof pid !== "string" || !pid) continue;
    const list = childrenByParent.get(pid);
    if (list) list.push(r);
    else childrenByParent.set(pid, [r]);
  }

  const ctx: Ctx = {
    tagNameById,
    childrenByParent,
    checklistByTask: groupBy(
      checkRows.filter(isAliveRow),
      "taskId"
    ),
    reminderByTask: groupBy(
      remRows.filter(isAliveRow),
      "taskId"
    ),
  };

  // Roots only: skip rows whose parent is also present (they nest underneath).
  const roots = rows.filter((r) => {
    const pid = r.parentId;
    return typeof pid !== "string" || !pid || !allById.has(pid);
  });

  return roots.map((r) =>
    backendTaskToTaskItem(toBackendSubtree(r, ctx, 1))
  );
}
