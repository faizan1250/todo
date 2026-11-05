// Adapter tests: Dexie-row → TaskItem (Phase 5 cutover 6b reads).
import Dexie from "dexie";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";

// Dexie captures the IndexedDB implementation via its dependencies table;
// the /auto global shim is not reliably picked up under bun:test.
Dexie.dependencies.indexedDB = indexedDB as unknown as IDBFactory;
Dexie.dependencies.IDBKeyRange = IDBKeyRange as unknown as typeof IDBKeyRange;
import { describe, it, expect, beforeEach } from "bun:test";
import { getDB } from "../src/lib/db/schema";
import {
  dexieRowToTaskItem,
  dexieRowsToTaskItems,
} from "../src/lib/data/adapters";
import { getListTasks } from "../src/lib/data/queries/list";
import type { LocalTask } from "../src/lib/data/types";

const UID = `adapter-test-${Date.now()}`;

function task(partial: Partial<LocalTask> & { id: string }): LocalTask {
  return {
    listId: "list-1",
    parentId: null,
    sectionId: null,
    title: `Task ${partial.id}`,
    notes: null,
    status: "todo",
    priority: 2,
    position: "a0",
    startAt: null,
    dueAt: null,
    deadlineAt: null,
    allDay: false,
    estimateMin: null,
    recurrenceId: null,
    placeId: null,
    completedAt: null,
    archivedAt: null,
    tagIds: [],
    deleted: 0,
    deletedAt: null,
    updatedAt: 1700000000000,
    createdAt: 1700000000000,
    ...partial,
  } as LocalTask;
}

beforeEach(async () => {
  const db = getDB(UID);
  await db.tasks.clear();
  await db.tags.clear();
  await db.checklistItems.clear();
  await db.reminders.clear();
  await db.tasks.bulkPut([
    task({
      id: "t-parent",
      title: "Parent",
      priority: 3,
      dueAt: Date.UTC(2026, 4, 1, 12),
      tagIds: ["tag-1", "tag-missing"],
      position: "a0",
    }),
    task({
      id: "t-child",
      title: "Child",
      parentId: "t-parent",
      status: "done",
      priority: 1,
      position: "a1",
    }),
    task({
      id: "t-grand",
      title: "Grand",
      parentId: "t-child",
      position: "a2",
    }),
    task({
      id: "t-other",
      title: "Other list task",
      listId: "list-2",
      position: "a0",
    }),
    task({
      id: "t-dead",
      title: "Tombstoned",
      deleted: 1,
      deletedAt: 1700000000001,
      position: "a3",
    }),
  ]);
  await db.tags.bulkPut([
    { id: "tag-1", name: "urgent", deleted: 0, deletedAt: null },
  ]);
  await db.checklistItems.bulkPut([
    {
      id: "c-1",
      taskId: "t-parent",
      text: "Check me",
      done: true,
      position: "a0",
      deleted: 0,
      deletedAt: null,
    },
  ]);
  await db.reminders.bulkPut([
    {
      id: "r-1",
      taskId: "t-parent",
      kind: "relative",
      relativeTo: "due",
      offsetMin: 30,
      remindAt: Date.UTC(2026, 4, 1, 11, 30),
      firedAt: null,
      deleted: 0,
      deletedAt: null,
    },
  ]);
});

describe("dexieRowsToTaskItems", () => {
  it("maps list rows to TaskItems with tags, checklist, reminders, nesting", async () => {
    const rows = await getListTasks(UID, "list-1");
    // t-parent, t-child, t-grand (t-dead excluded by isAlive)
    expect(rows.map((r) => r.id).sort()).toEqual(
      ["t-child", "t-grand", "t-parent"].sort()
    );

    const items = await dexieRowsToTaskItems(UID, rows);
    // Roots only: child + grand nest underneath
    expect(items.map((i) => i.id)).toEqual(["t-parent"]);

    const parent = items[0];
    expect(parent.title).toBe("Parent");
    expect(parent.priority).toBe("high");
    expect(parent.numericPriority).toBe(3);
    expect(parent.completed).toBe(false);
    expect(parent.rawStatus).toBe("todo");
    expect(parent.tags).toContain("urgent");
    expect(parent.tagIds).toContain("tag-1");
    expect(parent.dueAt).toBe(Date.UTC(2026, 4, 1, 12));
    expect(parent.dueDate).toBeString();
    expect(parent.checklist).toEqual([
      expect.objectContaining({ id: "c-1", text: "Check me", done: true }),
    ]);
    expect(parent.reminders).toEqual([
      expect.objectContaining({
        id: "r-1",
        kind: "relative",
        relativeTo: "due",
        offsetMin: 30,
      }),
    ]);

    // Subtask tree: child (depth 2) -> grand (depth 3), done maps through
    expect(parent.subtasks.length).toBe(1);
    expect(parent.subtasks[0]).toMatchObject({
      id: "t-child",
      title: "Child",
      completed: true,
      depth: 2,
      priority: "low",
    });
    expect(parent.subtasks[0].subtasks?.length).toBe(1);
    expect(parent.subtasks[0].subtasks?.[0]).toMatchObject({
      id: "t-grand",
      depth: 3,
    });
  });

  it("preserves input order and isolates lists", async () => {
    const rows = await getListTasks(UID, "list-2");
    const items = await dexieRowsToTaskItems(UID, rows);
    expect(items.map((i) => i.id)).toEqual(["t-other"]);
    expect(items[0].subtasks).toEqual([]);
    expect(items[0].tags).toEqual([]);
  });
});

describe("dexieRowToTaskItem", () => {
  it("applies defensive defaults for sparse rows", () => {
    const item = dexieRowToTaskItem({
      id: "sparse",
      listId: "list-1",
    } as unknown as LocalTask);
    expect(item.id).toBe("sparse");
    expect(item.title).toBe("");
    expect(item.completed).toBe(false);
    expect(item.priority).toBe("low");
    expect(item.tags).toEqual([]);
    expect(item.subtasks).toEqual([]);
    expect(item.checklist).toEqual([]);
  });

  it("resolves tag names from a provided map", () => {
    const item = dexieRowToTaskItem(
      task({ id: "x", tagIds: ["tag-1"] }),
      new Map([["tag-1", "urgent"]])
    );
    expect(item.tags).toEqual(["urgent"]);
    expect(item.tagIds).toEqual(["tag-1"]);
  });
});
