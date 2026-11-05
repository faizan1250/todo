import { describe, it, expect } from "bun:test";
import { moveNeighbors, isNoopMove } from "../src/lib/tasks/reorder";

describe("moveNeighbors", () => {
  it("returns null afterId at the start", () => {
    expect(moveNeighbors(["a", "b", "c"], "a")).toEqual({
      afterId: null,
      beforeId: "b",
      toIndex: 0,
    });
  });

  it("returns null beforeId at the end", () => {
    expect(moveNeighbors(["a", "b", "c"], "c")).toEqual({
      afterId: "b",
      beforeId: null,
      toIndex: 2,
    });
  });

  it("returns both neighbors in the middle", () => {
    expect(moveNeighbors(["a", "b", "c"], "b")).toEqual({
      afterId: "a",
      beforeId: "c",
      toIndex: 1,
    });
  });

  it("returns both null for a sole member", () => {
    expect(moveNeighbors(["only"], "only")).toEqual({
      afterId: null,
      beforeId: null,
      toIndex: 0,
    });
  });

  it("throws when the active id is missing", () => {
    expect(() => moveNeighbors(["a", "b"], "z")).toThrow();
  });
});

describe("isNoopMove", () => {
  it("detects identical orders", () => {
    expect(isNoopMove(["a", "b"], ["a", "b"])).toBe(true);
  });

  it("detects changed orders and lengths", () => {
    expect(isNoopMove(["a", "b"], ["b", "a"])).toBe(false);
    expect(isNoopMove(["a"], ["a", "b"])).toBe(false);
  });
});
