// Dexie-row → TaskItem adapter (Phase 5 cutover 6b, READS only).
//
// Dexie task rows are flat server-shape rows: camelCase keys, UTC ms
// timestamps (normalizeRow in lib/sync2/apply.ts converts Dates), and an
// embedded `tagIds: string[]` (backend sync route). Nested relations live
// in their own tables (tags, checklistItems, reminders, child task rows),
// so this module rehydrates them with a fixed batch of indexed queries,
// rebuilds nesting via buildTree() in lib/tasks/tree.ts, and then reuses
// backendTaskToTaskItem() as the single field-mapping authority
// (same defaults for priority/status/folder/list inference, timestamps).

import { backendTaskToTaskItem } from "../adapters";
import { buildTree, type TreeCtx } from "../tasks/tree";
import type { TaskItem } from "@/components/app/types";
import { getDB } from "../db/schema";
import type { LocalTask } from "./types";

const EMPTY_CTX: TreeCtx = {
  tagNameById: new Map(),
  childrenByParent: new Map(),
  checklistByTask: new Map(),
  reminderByTask: new Map(),
};

function isAliveRow(row: Record<string, unknown>): boolean {
  return row["deleted"] !== 1 && row["deletedAt"] == null;
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
  const ctx: TreeCtx =
    tagNameById !== undefined
      ? { ...EMPTY_CTX, tagNameById }
      : EMPTY_CTX;
  return backendTaskToTaskItem(buildTree(row, ctx, 1));
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

  const ctx: TreeCtx = {
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
    backendTaskToTaskItem(buildTree(r, ctx, 1))
  );
}
