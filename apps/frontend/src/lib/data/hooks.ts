// Live-query hooks over the per-user Dexie DB (Phase 5 Day 1b).
// Client components only. Queries stay narrow: always scoped by userId,
// then by list/task id where applicable.

"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { getDB } from "../db/schema";
import type {
  LocalChecklistItem,
  LocalList,
  LocalSection,
  LocalTag,
  LocalTask,
} from "./types";

function asTasks(rows: unknown): LocalTask[] {
  return (rows ?? []) as LocalTask[];
}

function byPositionThenId(a: { position?: unknown; id: string }, b: { position?: unknown; id: string }): number {
  const pa = typeof a.position === "string" ? a.position : "";
  const pb = typeof b.position === "string" ? b.position : "";
  if (pa < pb) return -1;
  if (pa > pb) return 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Narrow filter for useTasks. All fields optional; sectionId/parentId/tagId
 *  filter in memory after the narrow listId-indexed query. parentId=null
 *  selects roots only; undefined means no parent filter. */
export interface UseTasksOpts {
  listId?: string;
  sectionId?: string | null;
  parentId?: string | null;
  tagId?: string;
}

/** Non-deleted tasks, optionally scoped to a list, ordered by position.
 *  The second arg accepts either a listId string (legacy) or a filter
 *  object; section/parent/tag filters apply in memory. */
export function useTasks(
  userId: string,
  listIdOrOpts?: string | UseTasksOpts
): LocalTask[] {
  const opts: UseTasksOpts =
    typeof listIdOrOpts === "string"
      ? { listId: listIdOrOpts }
      : (listIdOrOpts ?? {});
  const { listId, sectionId, parentId, tagId } = opts;
  const rows = useLiveQuery(async () => {
    const db = getDB(userId);
    const base = listId
      ? await db.tasks.where("listId").equals(listId).toArray()
      : await db.tasks.toArray();
    return base.filter((r) => {
      if (r["deleted"] === 1 || r["deletedAt"] != null) return false;
      if (sectionId !== undefined && (r["sectionId"] ?? null) !== sectionId) {
        return false;
      }
      if (parentId !== undefined && (r["parentId"] ?? null) !== parentId) {
        return false;
      }
      if (
        tagId !== undefined &&
        !(((r["tagIds"] as string[] | undefined) ?? []).includes(tagId))
      ) {
        return false;
      }
      return true;
    });
  }, [userId, listId, sectionId, parentId, tagId]);
  return asTasks(rows).sort(byPositionThenId);
}

/** Single task by id (returns undefined while loading or when missing). */
export function useTask(
  userId: string,
  id: string | null | undefined
): LocalTask | undefined {
  return useLiveQuery(
    async () => {
      if (!id) return undefined;
      const row = await getDB(userId).tasks.get(id);
      return (row ?? undefined) as unknown as LocalTask | undefined;
    },
    [userId, id]
  );
}

/** Non-deleted lists ordered by position. */
export function useLists(userId: string): LocalList[] {
  const rows = useLiveQuery(async () => {
    const all = await getDB(userId).lists.toArray();
    return all.filter((r) => r["deleted"] !== 1 && r["deletedAt"] == null);
  }, [userId]);
  return ((rows ?? []) as unknown as LocalList[]).sort(byPositionThenId);
}

/** Single list by id. */
export function useList(
  userId: string,
  id: string | null | undefined
): LocalList | undefined {
  return useLiveQuery(
    async () => {
      if (!id) return undefined;
      const row = await getDB(userId).lists.get(id);
      return (row ?? undefined) as unknown as LocalList | undefined;
    },
    [userId, id]
  );
}

/** Non-deleted sections of a list ordered by position. */
export function useSections(userId: string, listId?: string): LocalSection[] {
  const rows = useLiveQuery(async () => {
    const db = getDB(userId);
    const inList = listId
      ? await db.sections.where("listId").equals(listId).toArray()
      : await db.sections.toArray();
    return inList.filter((r) => r["deleted"] !== 1 && r["deletedAt"] == null);
  }, [userId, listId]);
  return ((rows ?? []) as unknown as LocalSection[]).sort(byPositionThenId);
}

/** Non-deleted checklist items of a task ordered by position. */
export function useChecklistItems(
  userId: string,
  taskId?: string
): LocalChecklistItem[] {
  const rows = useLiveQuery(async () => {
    const db = getDB(userId);
    const items = taskId
      ? await db.checklistItems.where("taskId").equals(taskId).toArray()
      : await db.checklistItems.toArray();
    return items.filter((r) => r["deleted"] !== 1 && r["deletedAt"] == null);
  }, [userId, taskId]);
  return ((rows ?? []) as unknown as LocalChecklistItem[]).sort(byPositionThenId);
}

/** Non-deleted tags ordered by name. */
export function useTags(userId: string): LocalTag[] {
  const rows = useLiveQuery(async () => {
    const all = await getDB(userId).tags.toArray();
    return all.filter((r) => r["deleted"] !== 1 && r["deletedAt"] == null);
  }, [userId]);
  const tags = (rows ?? []) as unknown as LocalTag[];
  return tags.sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
}

/** Number of pending outbox entries (sync backlog badge). */
export function useOutboxCount(userId: string): number {
  return useLiveQuery(() => getDB(userId).outbox.count(), [userId]) ?? 0;
}

function isAliveRow(r: Record<string, unknown>): boolean {
  return r["deleted"] !== 1 && r["deletedAt"] == null;
}

/** Open tasks only: alive, unarchived, not done/cancelled. */
function isOpenRow(r: Record<string, unknown>): boolean {
  return (
    isAliveRow(r) &&
    r["archivedAt"] == null &&
    r["status"] !== "done" &&
    r["status"] !== "cancelled"
  );
}

export interface TaskCounts {
  /** Open tasks in the inbox list (0 when no inbox list exists). */
  inbox: number;
  /** Open tasks due within the local day. */
  today: number;
  /** Open-task count per live list id. */
  lists: Record<string, number>;
  /** Number of live tags. */
  tags: number;
  /** Number of tombstoned task rows. */
  trash: number;
}

/** Live Dexie counts for the sidebar. Additive only — the sidebar keeps
 *  backend getViewCounts() as its source until cutover, this hook just
 *  provides the local-first alternative. Per-list/inbox counts ride the
 *  listId index; today rides the [deleted+status+dueAt] compound index
 *  (archived filtered in memory); trash/tags are filtered counts. */
export function useCounts(userId: string): TaskCounts {
  const fallback: TaskCounts = {
    inbox: 0,
    today: 0,
    lists: {},
    tags: 0,
    trash: 0,
  };
  const counts = useLiveQuery(async (): Promise<TaskCounts> => {
    const db = getDB(userId);
    const lists = (await db.lists.toArray()).filter(isAliveRow);
    const inboxList = lists.find((l) => l["isInbox"] === true) ?? null;

    const perList = await Promise.all(
      lists.map(async (l) => {
        const id = l["id"] as string;
        const rows = await db.tasks.where("listId").equals(id).toArray();
        return [id, rows.filter(isOpenRow).length] as const;
      })
    );
    const listCounts: Record<string, number> = {};
    for (const [id, n] of perList) listCounts[id] = n;

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const startMs = dayStart.getTime();
    const endMs = startMs + 24 * 60 * 60 * 1000;
    const dueToday: Record<string, unknown>[] = [];
    for (const status of ["todo", "in_progress"]) {
      const rows = await db.tasks
        .where("[deleted+status+dueAt]")
        .between([0, status, startMs], [0, status, endMs], true, false)
        .toArray();
      dueToday.push(...rows);
    }
    const today = dueToday.filter(
      (r) => (r as Record<string, unknown>)["archivedAt"] == null
    ).length;

    const trash = await db.tasks
      .filter((r) => !isAliveRow(r as unknown as Record<string, unknown>))
      .count();
    const tags = await db.tags
      .filter((r) => isAliveRow(r as unknown as Record<string, unknown>))
      .count();

    return {
      inbox: inboxList ? (listCounts[inboxList["id"] as string] ?? 0) : 0,
      today,
      lists: listCounts,
      tags,
      trash,
    };
  }, [userId]);
  return counts ?? fallback;
}
