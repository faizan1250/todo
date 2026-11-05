// Task validation helpers (moved verbatim from lib/data/mutate.ts).
//
// Local text validation (mirrors backend limits: title <= 500,
// name <= 100, checklist text <= 500; trims before validating)
// plus hierarchy checks: local ancestor walk + descendant BFS
// (root = depth 1, max 3 levels, no cycles).

import type { Table } from "dexie";
import type { SyncRow } from "../db/schema";
import type { MutateOp } from "../data/mutate";

const TITLE_MAX: Record<string, number> = { tasks: 500, templates: 255 };
const NAME_TABLES = new Set([
  "lists",
  "folders",
  "sections",
  "tags",
  "places",
  "savedFilters",
]);

export function checkText(
  patch: Record<string, unknown>,
  op: MutateOp,
  key: string,
  max: number,
  label: string
): void {
  const v = patch[key];
  if (v === undefined) {
    if (op === "create") throw new Error(`${label} is required`);
    return;
  }
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`${label} is required`);
  }
  if (v.trim().length > max) {
    throw new Error(`${label} must be ${max} characters or fewer`);
  }
  patch[key] = v.trim();
}

export function assertTextFields(
  entity: string,
  op: MutateOp,
  patch: Record<string, unknown>
): void {
  const titleMax = TITLE_MAX[entity];
  if (titleMax !== undefined) checkText(patch, op, "title", titleMax, "Title");
  if (NAME_TABLES.has(entity)) checkText(patch, op, "name", 100, "Name");
  if (entity === "checklistItems") checkText(patch, op, "text", 500, "Text");
}

export async function localDescendants(
  table: Table<SyncRow, string>,
  rootId: string,
  includeDeleted = false
): Promise<{ ids: Set<string>; maxDepth: number }> {
  const ids = new Set<string>();
  let frontier = [rootId];
  let depth = 0;
  let maxDepth = 0;
  while (frontier.length > 0) {
    depth += 1;
    const next: string[] = [];
    for (const pid of frontier) {
      const kids = await table.where("parentId").equals(pid).toArray();
      for (const k of kids) {
        const id = k["id"] as string;
        if (typeof id !== "string" || ids.has(id)) continue;
        if (!includeDeleted && (k["deleted"] === 1 || k["deletedAt"] != null)) {
          continue;
        }
        ids.add(id);
        next.push(id);
      }
    }
    if (next.length > 0) maxDepth = depth;
    frontier = next;
    if (depth > 32) break;
  }
  return { ids, maxDepth };
}

export async function assertValidParent(
  table: Table<SyncRow, string>,
  taskId: string,
  newParentId: unknown
): Promise<SyncRow | null> {
  if (newParentId == null || newParentId === "") return null;
  if (typeof newParentId !== "string" || !newParentId) {
    throw new Error("Invalid parent");
  }
  if (newParentId === taskId) {
    throw new Error("A task cannot be its own parent");
  }
  const { ids, maxDepth } = await localDescendants(table, taskId);
  if (ids.has(newParentId)) {
    throw new Error("A task cannot have one of its descendants as a parent");
  }
  let cur: unknown = newParentId;
  let depth = 0;
  let parentRow: SyncRow | undefined;
  const seen = new Set<string>();
  while (typeof cur === "string" && cur) {
    if (cur === taskId || seen.has(cur)) {
      throw new Error("A task cannot have one of its descendants as a parent");
    }
    seen.add(cur);
    const row = await table.get(cur);
    if (!row || row["deleted"] === 1 || row["deletedAt"] != null) {
      throw new Error("Parent task not found");
    }
    if (depth === 0) parentRow = row;
    cur = (row["parentId"] as string | null | undefined) ?? null;
    depth += 1;
    if (depth > 32) {
      throw new Error("A task cannot have one of its descendants as a parent");
    }
  }
  if (depth + 1 + maxDepth > 3) {
    throw new Error("Subtasks can be nested up to 3 levels maximum");
  }
  return parentRow ?? null;
}
