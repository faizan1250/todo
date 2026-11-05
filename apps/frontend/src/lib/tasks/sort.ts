export type ListSortMode = "manual" | "due";

function dueTime(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const t = new Date(value as string | number | Date).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Due-date order: dated first (earliest first), undated last, stable by position. */
export function sortTasksByDueDate<T extends { dueAt?: unknown; position?: string }>(
  tasks: T[]
): T[] {
  return [...tasks].sort((a, b) => {
    const da = dueTime(a.dueAt);
    const db = dueTime(b.dueAt);
    if (da === null && db === null) {
      return (a.position ?? "") < (b.position ?? "") ? -1 : 1;
    }
    if (da === null) return 1;
    if (db === null) return -1;
    if (da !== db) return da - db;
    return (a.position ?? "") < (b.position ?? "") ? -1 : 1;
  });
}
