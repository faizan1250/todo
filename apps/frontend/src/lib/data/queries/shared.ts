// Shared helpers for local view queries (Phase 5 Day 1b).
// Mirrors backend view predicates in apps/backend/src/routes/views.ts:
// active statuses (todo/in_progress), archived excluded, timed rows compare
// against UTC day bounds, all-day floating rows against UTC-midnight bounds.

import type { SyncRow } from "../../db/schema";
import type { LocalTask } from "../types";

export const ACTIVE_STATUSES = new Set(["todo", "in_progress"]);

export interface ViewOptions {
  now?: number;
  tz?: string;
}

export function asTask(row: SyncRow): LocalTask {
  return row as unknown as LocalTask;
}

/** Coerce a stored date value (ms number, Date, ISO string) to UTC ms. */
export function ms(v: unknown): number | null {
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

/** Not tombstoned locally. */
export function isAlive(t: LocalTask): boolean {
  return t.deleted !== 1 && t.deletedAt == null;
}

/** Live task eligible for date views: alive + active status + not archived. */
export function isActiveTask(t: LocalTask): boolean {
  return (
    isAlive(t) &&
    ACTIVE_STATUSES.has(String(t.status)) &&
    ms(t.archivedAt) == null
  );
}

function cmpStr(a: unknown, b: unknown): number {
  const sa = typeof a === "string" ? a : "";
  const sb = typeof b === "string" ? b : "";
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** Backend today/upcoming order: effective date, then position, then id. */
export function sortByEffectiveDate(rows: LocalTask[]): LocalTask[] {
  return rows.sort((x, y) => {
    const dx = ms(x.dueAt) ?? ms(x.startAt) ?? 0;
    const dy = ms(y.dueAt) ?? ms(y.startAt) ?? 0;
    if (dx !== dy) return dx - dy;
    const p = cmpStr(x.position, y.position);
    if (p !== 0) return p;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

/** Position order for list/inbox views. */
export function sortByPosition(rows: LocalTask[]): LocalTask[] {
  return rows.sort((x, y) => {
    const p = cmpStr(x.position, y.position);
    if (p !== 0) return p;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}
