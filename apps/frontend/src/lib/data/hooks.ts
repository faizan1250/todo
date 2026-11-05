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

/** Non-deleted tasks, optionally scoped to a list, ordered by position. */
export function useTasks(userId: string, listId?: string): LocalTask[] {
  const rows = useLiveQuery(async () => {
    const db = getDB(userId);
    if (listId) {
      const inList = await db.tasks.where("listId").equals(listId).toArray();
      return inList.filter((r) => r["deleted"] !== 1 && r["deletedAt"] == null);
    }
    return db.tasks.toArray().then((all) => all.filter((r) => r["deleted"] !== 1 && r["deletedAt"] == null));
  }, [userId, listId]);
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
