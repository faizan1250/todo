// Task position helpers (moved verbatim from lib/data/mutate.ts).
//
// Minimal client mirror of backend positionBetween. New rows append at
// end: generateKeyBetween(lastPos, null). Moves with afterId/beforeId
// resolve locally; failures fall back (server recomputes authoritatively
// from afterId/beforeId since we never ship computed positions for moves).

import type { Table } from "dexie";
import { generateKeyBetween } from "fractional-indexing";
import type { SyncRow } from "../db/schema";

export interface Scope {
  listId?: string;
  taskId?: string;
  parentId?: string | null;
  sectionId?: string | null;
}

export interface Sibling {
  id: string;
  position: string;
}

function norm(v: unknown): unknown {
  return v === undefined ? null : v;
}

async function siblingEntries(
  table: Table<SyncRow, string>,
  entity: string,
  scope: Scope,
  excludeId: string
): Promise<Sibling[]> {
  let rows: SyncRow[];
  if (entity === "tasks" && typeof scope.listId === "string") {
    rows = await table.where("listId").equals(scope.listId).toArray();
  } else if (entity === "sections" && typeof scope.listId === "string") {
    rows = await table.where("listId").equals(scope.listId).toArray();
  } else if (
    entity === "checklistItems" &&
    typeof scope.taskId === "string"
  ) {
    rows = await table.where("taskId").equals(scope.taskId).toArray();
  } else {
    rows = await table.toArray();
  }
  const out: Sibling[] = [];
  for (const r of rows) {
    if (r["id"] === excludeId) continue;
    if (r["deleted"] === 1 || r["deletedAt"] != null) continue;
    if (typeof r["position"] !== "string") continue;
    if (entity === "tasks") {
      if (r["listId"] !== scope.listId) continue;
      if (norm(r["parentId"]) !== norm(scope.parentId)) continue;
      if (norm(r["sectionId"]) !== norm(scope.sectionId)) continue;
    } else if (entity === "sections") {
      if (r["listId"] !== scope.listId) continue;
    } else if (entity === "checklistItems") {
      if (r["taskId"] !== scope.taskId) continue;
    }
    out.push({ id: r["id"] as string, position: r["position"] as string });
  }
  out.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  return out;
}

export async function appendPosition(
  table: Table<SyncRow, string>,
  entity: string,
  scope: Scope,
  excludeId: string
): Promise<string> {
  const siblings = await siblingEntries(table, entity, scope, excludeId);
  const last = siblings.length > 0 ? siblings[siblings.length - 1].position : null;
  return generateKeyBetween(last, null);
}

export async function movePosition(
  table: Table<SyncRow, string>,
  entity: string,
  scope: Scope,
  afterId: unknown,
  beforeId: unknown,
  excludeId: string
): Promise<string | null> {
  const siblings = await siblingEntries(table, entity, scope, excludeId);
  const byId = new Map(siblings.map((s) => [s.id, s.position]));
  const a =
    typeof afterId === "string" && afterId ? (byId.get(afterId) ?? null) : null;
  const b =
    typeof beforeId === "string" && beforeId
      ? (byId.get(beforeId) ?? null)
      : null;
  try {
    return generateKeyBetween(a, b);
  } catch {
    return null;
  }
}
