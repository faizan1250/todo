// Undo inverse-stack unit tests (Phase 2 premium 1b). Pure logic only —
// no Dexie, no DOM.
import { describe, it, expect, beforeEach } from "bun:test";
import {
  inverseOf,
  pushUndo,
  popUndo,
  clearUndo,
} from "../src/lib/tasks/undo";

beforeEach(() => {
  clearUndo();
});

describe("inverseOf", () => {
  it("inverts create to delete", () => {
    expect(
      inverseOf({ entity: "tasks", op: "create", entityId: "t1" })
    ).toEqual({ entity: "tasks", op: "delete", entityId: "t1" });
  });

  it("inverts delete to restore (tombstone-safe, not create)", () => {
    expect(
      inverseOf({ entity: "tasks", op: "delete", entityId: "t1" })
    ).toEqual({ entity: "tasks", op: "restore", entityId: "t1", patch: {} });
  });

  it("inverts restore to delete", () => {
    expect(
      inverseOf({ entity: "tasks", op: "restore", entityId: "t1" })
    ).toEqual({ entity: "tasks", op: "delete", entityId: "t1" });
  });

  it("inverts update with the before-image patch", () => {
    expect(
      inverseOf(
        {
          entity: "tasks",
          op: "update",
          entityId: "t1",
          patch: { title: "New" },
        },
        { beforePatch: { title: "Old" } }
      )
    ).toEqual({
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { title: "Old" },
    });
  });

  it("throws for update without beforePatch", () => {
    expect(() =>
      inverseOf({ entity: "tasks", op: "update", entityId: "t1" })
    ).toThrow("beforePatch");
  });

  it("inverts complete to a status-restoring update", () => {
    expect(
      inverseOf(
        { entity: "tasks", op: "complete", entityId: "t1" },
        { beforeStatus: "in_progress" }
      )
    ).toEqual({
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { status: "in_progress", completedAt: null },
    });
  });

  it("defaults complete undo status to todo", () => {
    expect(
      inverseOf({ entity: "tasks", op: "complete", entityId: "t1" })
    ).toEqual({
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { status: "todo", completedAt: null },
    });
  });

  it("inverts reopen to complete", () => {
    expect(
      inverseOf({ entity: "tasks", op: "reopen", entityId: "t1" })
    ).toEqual({ entity: "tasks", op: "complete", entityId: "t1", patch: {} });
  });

  it("inverts move with before coordinates", () => {
    expect(
      inverseOf(
        {
          entity: "tasks",
          op: "move",
          entityId: "t1",
          patch: { listId: "l2" },
        },
        {
          beforeParent: null,
          beforeList: "l1",
          beforeSection: "s1",
          beforePosition: "a0",
        }
      )
    ).toEqual({
      entity: "tasks",
      op: "move",
      entityId: "t1",
      patch: {
        parentId: null,
        listId: "l1",
        sectionId: "s1",
        position: "a0",
      },
    });
  });

  it("throws for move with a missing before coordinate", () => {
    expect(() =>
      inverseOf(
        { entity: "tasks", op: "move", entityId: "t1" },
        { beforeList: "l1", beforePosition: "a0" }
      )
    ).toThrow("beforeParent/beforeList/beforeSection/beforePosition");
  });

  it("inverts archive to unarchiving update", () => {
    expect(
      inverseOf({ entity: "tasks", op: "archive", entityId: "t1" })
    ).toEqual({
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { archivedAt: null },
    });
  });

  it("inverts unarchive with the before archived stamp", () => {
    expect(
      inverseOf(
        { entity: "tasks", op: "unarchive", entityId: "t1" },
        { beforeArchivedAt: 1700000000000 }
      )
    ).toEqual({
      entity: "tasks",
      op: "update",
      entityId: "t1",
      patch: { archivedAt: 1700000000000 },
    });
  });

  it("throws for unarchive without beforeArchivedAt", () => {
    expect(() =>
      inverseOf({ entity: "tasks", op: "unarchive", entityId: "t1" })
    ).toThrow("beforeArchivedAt");
  });

  it("inverts setTags with before tag ids", () => {
    expect(
      inverseOf(
        {
          entity: "tasks",
          op: "setTags",
          entityId: "t1",
          patch: { tagIds: ["b"] },
        },
        { beforeTagIds: ["a"] }
      )
    ).toEqual({
      entity: "tasks",
      op: "setTags",
      entityId: "t1",
      patch: { tagIds: ["a"] },
    });
  });

  it("throws for setTags without beforeTagIds", () => {
    expect(() =>
      inverseOf({ entity: "tasks", op: "setTags", entityId: "t1" })
    ).toThrow("beforeTagIds");
  });

  it("throws for unknown ops", () => {
    expect(() =>
      inverseOf({ entity: "tasks", op: "nuke", entityId: "t1" } as never)
    ).toThrow("Unknown op");
  });
});

describe("inverse round-trips", () => {
  it("update inverse twice restores the forward patch", () => {
    const forward = {
      entity: "tasks" as const,
      op: "update" as const,
      entityId: "t1",
      patch: { title: "New" },
    };
    const back = inverseOf(forward, { beforePatch: { title: "Old" } });
    expect(inverseOf(back, { beforePatch: { title: "New" } })).toEqual(
      forward
    );
  });

  it("move inverse twice restores the forward coordinates", () => {
    const forward = {
      entity: "tasks" as const,
      op: "move" as const,
      entityId: "t1",
      patch: {
        parentId: null,
        listId: "l2",
        sectionId: null,
        position: "a1",
      },
    };
    const back = inverseOf(forward, {
      beforeParent: null,
      beforeList: "l1",
      beforeSection: null,
      beforePosition: "a0",
    });
    expect(
      inverseOf(back, {
        beforeParent: null,
        beforeList: "l2",
        beforeSection: null,
        beforePosition: "a1",
      })
    ).toEqual(forward);
  });

  it("setTags inverse twice restores the forward tag set", () => {
    const forward = {
      entity: "tasks" as const,
      op: "setTags" as const,
      entityId: "t1",
      patch: { tagIds: ["b"] },
    };
    const back = inverseOf(forward, { beforeTagIds: ["a"] });
    expect(inverseOf(back, { beforeTagIds: ["b"] })).toEqual(forward);
  });

  it("complete -> reopen alias round-trips at op level", () => {
    const undoComplete = inverseOf({
      entity: "tasks",
      op: "complete",
      entityId: "t1",
    });
    expect(undoComplete.op).toBe("update");
    const redoComplete = inverseOf({
      entity: "tasks",
      op: "reopen",
      entityId: "t1",
    });
    expect(redoComplete).toEqual({
      entity: "tasks",
      op: "complete",
      entityId: "t1",
      patch: {},
    });
  });
});

describe("undo stack", () => {
  it("pops in LIFO order", () => {
    pushUndo({ entity: "tasks", op: "delete", entityId: "a" });
    pushUndo({ entity: "tasks", op: "delete", entityId: "b" });
    expect(popUndo()?.entityId).toBe("b");
    expect(popUndo()?.entityId).toBe("a");
    expect(popUndo()).toBeUndefined();
  });

  it("caps at 20, dropping the oldest", () => {
    for (let i = 0; i < 25; i++) {
      pushUndo({ entity: "tasks", op: "delete", entityId: `t${i}` });
    }
    const ids: string[] = [];
    let next = popUndo();
    while (next) {
      ids.push(next.entityId);
      next = popUndo();
    }
    expect(ids).toHaveLength(20);
    expect(ids[0]).toBe("t24");
    expect(ids[ids.length - 1]).toBe("t5");
  });

  it("clearUndo empties the stack", () => {
    pushUndo({ entity: "tasks", op: "delete", entityId: "a" });
    clearUndo();
    expect(popUndo()).toBeUndefined();
  });
});
