import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { eq } from "drizzle-orm";

describe("Phase 4 Daily Planner & Time Blocking", () => {
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

  async function createTask(
    authHeaders: Record<string, string>,
    payload: Record<string, any>
  ): Promise<any> {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      })
    );
    expect(res.status).toBe(201);
    return await res.json();
  }

  describe("1. Validation Constraints (Duration, Midnight, 5-Min Alignment)", () => {
    it("rejects blocks shorter than 5m or longer than 12h", async () => {
      const { authHeaders } = await createAuthUser("BlockDurationUser");

      // 4 minutes
      const shortRes = await app.handle(
        new Request("http://localhost:3001/api/v1/time-blocks?tz=UTC", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Too Short",
            startAt: "2026-05-10T10:00:00.000Z",
            endAt: "2026-05-10T10:04:00.000Z",
          }),
        })
      );
      expect(shortRes.status).toBe(422);

      // 13 hours
      const longRes = await app.handle(
        new Request("http://localhost:3001/api/v1/time-blocks?tz=UTC", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Too Long",
            startAt: "2026-05-10T08:00:00.000Z",
            endAt: "2026-05-10T21:00:00.000Z",
          }),
        })
      );
      expect(longRes.status).toBe(422);
    });

    it("rejects blocks that cross midnight in user timezone", async () => {
      const { authHeaders } = await createAuthUser("BlockMidnightUser");

      // In America/Los_Angeles (UTC-7 in May):
      // 2026-05-10 23:30 PDT is 2026-05-11 06:30 UTC
      // 2026-05-11 00:30 PDT is 2026-05-11 07:30 UTC
      // Crossing local midnight!
      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/time-blocks?tz=America/Los_Angeles", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Midnight Crossing",
            startAt: "2026-05-11T06:30:00.000Z",
            endAt: "2026-05-11T07:30:00.000Z",
          }),
        })
      );
      expect(res.status).toBe(422);
      const data = (await res.json()) as any;
      expect(data.error).toContain("within one local calendar day");
    });

    it("rejects non-5-minute aligned times", async () => {
      const { authHeaders } = await createAuthUser("BlockAlignUser");

      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/time-blocks?tz=UTC", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Unaligned",
            startAt: "2026-05-10T10:03:00.000Z",
            endAt: "2026-05-10T10:35:00.000Z",
          }),
        })
      );
      expect(res.status).toBe(422);
      const data = (await res.json()) as any;
      expect(data.error).toContain("5-minute increments");
    });
  });

  describe("2. Time Blocks CRUD & Conflict Detection", () => {
    it("creates, updates, detects conflicts, and deletes time blocks", async () => {
      const { authHeaders } = await createAuthUser("BlockCrudUser");

      // 1. Create Block A: 10:00 to 11:00
      const b1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/time-blocks?tz=UTC", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Morning Review",
            startAt: "2026-05-10T10:00:00.000Z",
            endAt: "2026-05-10T11:00:00.000Z",
            color: "#3b82f6",
          }),
        })
      );
      expect(b1Res.status).toBe(201);
      const block1 = (await b1Res.json()) as any;

      // 2. Create Block B overlapping: 10:30 to 11:30
      const b2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/time-blocks?tz=UTC", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Overlapping Sync",
            startAt: "2026-05-10T10:30:00.000Z",
            endAt: "2026-05-10T11:30:00.000Z",
          }),
        })
      );
      expect(b2Res.status).toBe(201);
      const block2 = (await b2Res.json()) as any;

      // 3. Query planner for this date and verify conflict detected
      const planRes = await app.handle(
        new Request("http://localhost:3001/api/v1/planner?date=2026-05-10&tz=UTC", {
          headers: authHeaders,
        })
      );
      expect(planRes.status).toBe(200);
      const plan = (await planRes.json()) as any;
      expect(plan.blocks.length).toBe(2);
      expect(plan.conflicts.length).toBe(1);
      expect(plan.conflicts[0]).toEqual([block1.id, block2.id]);

      // 4. Update Block B to no longer conflict: 11:00 to 12:00
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/time-blocks/${block2.id}?tz=UTC`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            startAt: "2026-05-10T11:00:00.000Z",
            endAt: "2026-05-10T12:00:00.000Z",
          }),
        })
      );
      expect(patchRes.status).toBe(200);

      // Verify no more conflicts
      const planRes2 = await app.handle(
        new Request("http://localhost:3001/api/v1/planner?date=2026-05-10&tz=UTC", {
          headers: authHeaders,
        })
      );
      const plan2 = (await planRes2.json()) as any;
      expect(plan2.conflicts.length).toBe(0);

      // 5. Delete block
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/time-blocks/${block2.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      const planRes3 = await app.handle(
        new Request("http://localhost:3001/api/v1/planner?date=2026-05-10&tz=UTC", {
          headers: authHeaders,
        })
      );
      const plan3 = (await planRes3.json()) as any;
      expect(plan3.blocks.length).toBe(1);
    });
  });

  describe("3. Capacity Rollup & Task Scheduling Endpoint", () => {
    it("schedules task into time block and computes workMin, scheduledMin, and estimatedMin", async () => {
      const { authHeaders } = await createAuthUser("PlannerCapacityUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create task with estimate 45m due today
      const task = await createTask(authHeaders, {
        title: "API Performance Tuning",
        listId: inboxId,
        estimateMin: 45,
        dueAt: "2026-05-10T14:00:00.000Z",
      });

      // Schedule task via POST /api/v1/planner/schedule
      const schedRes = await app.handle(
        new Request("http://localhost:3001/api/v1/planner/schedule?tz=UTC", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            taskId: task.id,
            start: "2026-05-10T09:00:00.000Z",
          }),
        })
      );
      expect(schedRes.status).toBe(201);
      const schedBlock = (await schedRes.json()) as any;
      expect(schedBlock.taskId).toBe(task.id);
      expect(schedBlock.startAt).toBe("2026-05-10T09:00:00.000Z");
      // End time is start + 45 minutes = 09:45:00.000Z
      expect(schedBlock.endAt).toBe("2026-05-10T09:45:00.000Z");

      // Verify planner response
      const planRes = await app.handle(
        new Request("http://localhost:3001/api/v1/planner?date=2026-05-10&tz=UTC", {
          headers: authHeaders,
        })
      );
      expect(planRes.status).toBe(200);
      const plan = (await planRes.json()) as any;
      expect(plan.capacity.workMin).toBe(540); // 09:00 - 18:00 = 9h
      expect(plan.capacity.scheduledMin).toBe(45);
      expect(plan.capacity.estimatedMin).toBe(45);

      // 4. Soft-deleting task hides its time block
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      const planAfterDeleteRes = await app.handle(
        new Request("http://localhost:3001/api/v1/planner?date=2026-05-10&tz=UTC", {
          headers: authHeaders,
        })
      );
      const planAfterDelete = (await planAfterDeleteRes.json()) as any;
      expect(planAfterDelete.blocks.length).toBe(0);

      // Restore task -> block unhides
      await db.update(schema.tasks).set({ deletedAt: null }).where(eq(schema.tasks.id, task.id));

      const planAfterRestoreRes = await app.handle(
        new Request("http://localhost:3001/api/v1/planner?date=2026-05-10&tz=UTC", {
          headers: authHeaders,
        })
      );
      const planAfterRestore = (await planAfterRestoreRes.json()) as any;
      expect(planAfterRestore.blocks.length).toBe(1);
    });
  });
});
