import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { getTasksWithIncludes } from "../src/utils/tasks";
import { db, tasks } from "../src/db";
import { eq } from "drizzle-orm";

describe("Phase 3 Dates & Estimates Module", () => {
  async function getUserInboxId(authHeaders: Record<string, string>): Promise<string> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/lists", {
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(200);
    const userLists = (await res.json()) as Array<{ id: string; isInbox: boolean }>;
    const inbox = userLists.find((l) => l.isInbox);
    expect(inbox).toBeDefined();
    return inbox!.id;
  }

  describe("1. Floating All-Day Dates", () => {
    it("stores all-day dueAt and startAt as UTC midnight without timezone shift", async () => {
      const { authHeaders } = await createAuthUser("AllDayUser");
      const inboxId = await getUserInboxId(authHeaders);

      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Tax Filing Deadline",
            listId: inboxId,
            allDay: true,
            dueAt: "2026-11-04T18:45:00.000Z",
            startAt: "2026-11-04T08:00:00.000Z",
          }),
        })
      );

      expect(res.status).toBe(201);
      const task = (await res.json()) as any;
      expect(task.allDay).toBe(true);
      expect(new Date(task.dueAt).toISOString()).toBe("2026-11-04T00:00:00.000Z");
      expect(new Date(task.startAt).toISOString()).toBe("2026-11-04T00:00:00.000Z");

      // Update via PATCH
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            dueAt: "2026-12-15T23:59:59.000Z",
          }),
        })
      );

      expect(patchRes.status).toBe(200);
      const updated = (await patchRes.json()) as any;
      expect(new Date(updated.dueAt).toISOString()).toBe("2026-12-15T00:00:00.000Z");
    });

    it("stores timed task dueAt as exact UTC instant", async () => {
      const { authHeaders } = await createAuthUser("TimedUser");
      const inboxId = await getUserInboxId(authHeaders);

      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Dentist Visit",
            listId: inboxId,
            allDay: false,
            dueAt: "2026-11-04T14:30:00.000Z",
          }),
        })
      );

      expect(res.status).toBe(201);
      const task = (await res.json()) as any;
      expect(task.allDay).toBe(false);
      expect(new Date(task.dueAt).toISOString()).toBe("2026-11-04T14:30:00.000Z");
    });
  });

  describe("2. StartAt <= DueAt Validation", () => {
    it("rejects POST with 400 when startAt > dueAt", async () => {
      const { authHeaders } = await createAuthUser("InvalidDateUser");
      const inboxId = await getUserInboxId(authHeaders);

      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Broken Time Travel",
            listId: inboxId,
            startAt: "2026-11-05T12:00:00.000Z",
            dueAt: "2026-11-04T12:00:00.000Z",
          }),
        })
      );

      expect(res.status).toBe(400);
      const err = (await res.json()) as any;
      expect(err.error).toContain("startAt cannot be after dueAt");
    });

    it("rejects PATCH with 400 when updating startAt > existing dueAt", async () => {
      const { authHeaders } = await createAuthUser("PatchDateUser");
      const inboxId = await getUserInboxId(authHeaders);

      const createRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Legit Task",
            listId: inboxId,
            dueAt: "2026-11-10T12:00:00.000Z",
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const task = (await createRes.json()) as any;

      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            startAt: "2026-11-15T12:00:00.000Z",
          }),
        })
      );

      expect(patchRes.status).toBe(400);
      const err = (await patchRes.json()) as any;
      expect(err.error).toContain("startAt cannot be after dueAt");
    });

    it("allows subtasks to have dates outside parent task range", async () => {
      const { authHeaders } = await createAuthUser("SubtaskDateUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Parent task due Nov 10
      const parentRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Parent Project",
            listId: inboxId,
            startAt: "2026-11-01T00:00:00.000Z",
            dueAt: "2026-11-10T00:00:00.000Z",
          }),
        })
      );
      expect(parentRes.status).toBe(201);
      const parent = (await parentRes.json()) as any;

      // Subtask due Nov 20 (after parent) - allowed
      const subtaskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Followup Subtask",
            parentId: parent.id,
            startAt: "2026-11-15T00:00:00.000Z",
            dueAt: "2026-11-20T00:00:00.000Z",
          }),
        })
      );
      expect(subtaskRes.status).toBe(201);
      const subtask = (await subtaskRes.json()) as any;
      expect(subtask.parentId).toBe(parent.id);
    });
  });

  describe("3. Estimate Range Validation", () => {
    it("rejects estimateMin < 1 or > 1440", async () => {
      const { authHeaders } = await createAuthUser("EstimateUser");
      const inboxId = await getUserInboxId(authHeaders);

      // 0 is invalid
      const zeroRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Zero Min Task",
            listId: inboxId,
            estimateMin: 0,
          }),
        })
      );
      expect(zeroRes.status).toBeGreaterThanOrEqual(400);

      // 1441 is invalid (> 24 hours)
      const bigRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Too Long Task",
            listId: inboxId,
            estimateMin: 1441,
          }),
        })
      );
      expect(bigRes.status).toBeGreaterThanOrEqual(400);

      // 60 is valid
      const validRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "1 Hour Task",
            listId: inboxId,
            estimateMin: 60,
          }),
        })
      );
      expect(validRes.status).toBe(201);
    });
  });

  describe("4. Estimate Total Rollup", () => {
    it("computes estimateTotal as sum of root task plus all descendant subtasks", async () => {
      const { user, authHeaders } = await createAuthUser("RollupUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Root task (60m)
      const rootRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Root Task",
            listId: inboxId,
            estimateMin: 60,
          }),
        })
      );
      expect(rootRes.status).toBe(201);
      const root = (await rootRes.json()) as any;

      // Child subtask 1 (30m)
      const child1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Subtask 1",
            parentId: root.id,
            estimateMin: 30,
          }),
        })
      );
      expect(child1Res.status).toBe(201);
      const child1 = (await child1Res.json()) as any;

      // Child subtask 2 (15m)
      const child2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Subtask 2",
            parentId: root.id,
            estimateMin: 15,
          }),
        })
      );
      expect(child2Res.status).toBe(201);

      // Grandchild under Child 1 (45m)
      const grandChildRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Grandchild Task",
            parentId: child1.id,
            estimateMin: 45,
          }),
        })
      );
      expect(grandChildRes.status).toBe(201);

      // Total expected for root: 60 + 30 + 15 + 45 = 150m
      // Total expected for child1: 30 + 45 = 75m
      const getRootRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root.id}`, {
          headers: authHeaders,
        })
      );
      expect(getRootRes.status).toBe(200);
      const rootFetched = (await getRootRes.json()) as any;
      expect(rootFetched.estimateMin).toBe(60);
      expect(rootFetched.estimateTotal).toBe(150);

      // Fetch with includes subtasks
      const getTreeRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${root.id}?include=subtasks`, {
          headers: authHeaders,
        })
      );
      expect(getTreeRes.status).toBe(200);
      const tree = (await getTreeRes.json()) as any;
      expect(tree.estimateTotal).toBe(150);
      expect(tree.subtasks).toHaveLength(2);
      const subtask1InTree = tree.subtasks.find((s: any) => s.id === child1.id);
      expect(subtask1InTree.estimateTotal).toBe(75);
    });
  });
});
