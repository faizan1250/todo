// Indent/outdent planning for Tab / Shift+Tab on a focused task row.
//
// Pure logic over the visible task order: indent makes the task a subtask
// of the nearest previous task with the same parent, outdent lifts it to
// its grandparent (or top level). Depth stays within the 3-level limit
// enforced by validate.ts.

import type { TaskItem } from "@/components/app/types";

export const MAX_TASK_DEPTH = 3;

export function depthOfTask(all: TaskItem[], id: string): number {
  const byId = new Map(all.map((t) => [t.id, t]));
  let depth = 1;
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    const parent = byId.get(cur.parentId);
    if (!parent) break;
    depth += 1;
    cur = parent;
    if (depth > 32) break;
  }
  return depth;
}

export function subtreeHeight(task: TaskItem): number {
  let max = 0;
  const walk = (nodes: TaskItem["subtasks"], d: number): void => {
    for (const n of nodes ?? []) {
      if (d > max) max = d;
      walk(n.subtasks ?? [], d + 1);
    }
  };
  walk(task.subtasks ?? [], 1);
  return max;
}

function isDescendantOf(all: TaskItem[], candidateId: string, ancestorId: string): boolean {
  const byId = new Map(all.map((t) => [t.id, t]));
  let cur = byId.get(candidateId);
  const seen = new Set<string>();
  while (cur?.parentId && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.parentId === ancestorId) return true;
    cur = byId.get(cur.parentId);
    if (!cur) break;
  }
  return false;
}

export type IndentPlan =
  | { ok: true; parentId: string }
  | { ok: false; reason: "first" | "depth" };

export function planIndent(
  ordered: TaskItem[],
  all: TaskItem[],
  id: string
): IndentPlan {
  const task = all.find((t) => t.id === id);
  if (!task) return { ok: false, reason: "first" };
  const idx = ordered.findIndex((t) => t.id === id);
  if (idx <= 0) return { ok: false, reason: "first" };
  const candidate = ordered[idx - 1];
  if (!candidate || candidate.id === id || isDescendantOf(all, candidate.id, id)) {
    return { ok: false, reason: "first" };
  }
  if (depthOfTask(all, candidate.id) + 1 + subtreeHeight(task) > MAX_TASK_DEPTH) {
    return { ok: false, reason: "depth" };
  }
  return { ok: true, parentId: candidate.id };
}

export type OutdentPlan =
  | { ok: true; parentId: string | null }
  | { ok: false; reason: "top" };

export function planOutdent(all: TaskItem[], id: string): OutdentPlan {
  const task = all.find((t) => t.id === id);
  if (!task || !task.parentId) return { ok: false, reason: "top" };
  const parent = all.find((t) => t.id === task.parentId);
  return { ok: true, parentId: parent?.parentId ?? null };
}
