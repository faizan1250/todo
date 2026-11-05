// Task tree builder (moved verbatim from lib/data/adapters.ts).
//
// Rebuilds a BackendTask-shaped object from a flat Dexie row + relations.
// lib/data/adapters.ts rehydrates the relations in one batched pass, then
// calls buildTree() as the single nesting authority (max 3 levels,
// matching backend nesting).

import type {
  BackendChecklistItem,
  BackendReminder,
  BackendTag,
  BackendTask,
} from "../api";
import type { LocalTask } from "../data/types";

export type TreeCtx = {
  tagNameById: Map<string, string>;
  childrenByParent: Map<string, LocalTask[]>;
  checklistByTask: Map<string, Record<string, unknown>[]>;
  reminderByTask: Map<string, Record<string, unknown>[]>;
};

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
export function buildTree(row: LocalTask, ctx: TreeCtx, depth: number): BackendTask {
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
  const subtasks = kids.map((k) => buildTree(k, ctx, depth + 1));

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
