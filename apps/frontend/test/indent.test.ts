import { describe, it, expect } from "bun:test";
import {
  planIndent,
  planOutdent,
  depthOfTask,
  subtreeHeight,
} from "../src/lib/tasks/indent";
import type { TaskItem } from "../src/components/app/types";

function task(
  id: string,
  patch: Partial<TaskItem> = {}
): TaskItem {
  return {
    id,
    title: id,
    completed: false,
    priority: "med",
    list: "today",
    folder: "none",
    tags: [],
    subtasks: [],
    checklist: [],
    createdAt: "now",
    updatedAt: "now",
    parentId: null,
    ...patch,
  } as TaskItem;
}

describe("planIndent", () => {
  it("indents under the previous sibling", () => {
    const all = [task("a"), task("b")];
    expect(planIndent(all, all, "b")).toEqual({ ok: true, parentId: "a" });
  });

  it("is a no-op for the first row", () => {
    const all = [task("a"), task("b")];
    expect(planIndent(all, all, "a")).toEqual({ ok: false, reason: "first" });
  });

  it("nests under the row directly above, whatever its level", () => {
    const all = [
      task("a"),
      task("kid", { parentId: "a" }),
      task("b"),
    ];
    expect(planIndent(all, all, "b")).toEqual({ ok: true, parentId: "kid" });
  });

  it("refuses to pass 3 levels", () => {
    const flat = [
      task("l1"),
      task("l2", { parentId: "l1" }),
      task("l3", { parentId: "l2" }),
      task("x"),
    ];
    expect(planIndent(flat, flat, "x")).toEqual({ ok: false, reason: "depth" });
    const shallow = [task("l1"), task("l2", { parentId: "l1" }), task("x")];
    expect(planIndent(shallow, shallow, "x")).toEqual({ ok: true, parentId: "l2" });
  });

  it("counts a moving subtree against the limit", () => {
    const kid = task("kid");
    const mover = task("mover", {
      subtasks: [{ id: "kid", title: "kid", completed: false, depth: 1 } as never],
    });
    expect(subtreeHeight(mover)).toBe(1);
    expect(subtreeHeight(kid)).toBe(0);
    const all = [task("l1"), task("l2", { parentId: "l1" }), mover];
    expect(planIndent(all, all, "mover")).toEqual({ ok: false, reason: "depth" });
  });
});

describe("planOutdent", () => {
  it("is a no-op at the top level", () => {
    expect(planOutdent([task("a")], "a")).toEqual({ ok: false, reason: "top" });
  });

  it("lifts to the grandparent", () => {
    const all = [
      task("l1"),
      task("l2", { parentId: "l1" }),
      task("l3", { parentId: "l2" }),
    ];
    expect(planOutdent(all, "l3")).toEqual({ ok: true, parentId: "l1" });
    expect(planOutdent(all, "l2")).toEqual({ ok: true, parentId: null });
  });
});

describe("depthOfTask", () => {
  it("walks the parent chain", () => {
    const all = [
      task("l1"),
      task("l2", { parentId: "l1" }),
      task("l3", { parentId: "l2" }),
    ];
    expect(depthOfTask(all, "l1")).toBe(1);
    expect(depthOfTask(all, "l3")).toBe(3);
    expect(depthOfTask(all, "missing")).toBe(1);
  });
});
