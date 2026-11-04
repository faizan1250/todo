import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { DateTime } from "luxon";
import { calculateNextOccurrence } from "../src/services/recurrence";
import { db, recurrences, tasks } from "../src/db";
import { eq } from "drizzle-orm";

describe("Phase 3 Recurrence Engine & Routes", () => {
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

  describe("1. DST-Safe Math Across Timezones", () => {
    it("keeps '9am daily' at 9am local across March spring-forward and November fall-back in NY, London, and Kolkata", () => {
      const timezones = ["America/New_York", "Europe/London", "Asia/Kolkata"];

      for (const tz of timezones) {
        // March spring forward test (NY jumps Mar 8 2026, London Mar 29 2026)
        const marchStart = DateTime.fromObject(
          { year: 2026, month: 3, day: 1, hour: 9, minute: 0, second: 0 },
          { zone: tz }
        ).toJSDate();

        let currentDue: Date | null = marchStart;
        for (let i = 0; i < 35; i++) {
          const next = calculateNextOccurrence({
            rruleStr: "FREQ=DAILY;INTERVAL=1",
            mode: "fixed",
            timezone: tz,
            dtstart: marchStart,
            referenceDueAt: currentDue,
            allDay: false,
            now: currentDue ?? undefined, // pretend now is currentDue
          });
          expect(next).not.toBeNull();
          const localDt = DateTime.fromJSDate(next!).setZone(tz);
          expect(localDt.hour).toBe(9);
          expect(localDt.minute).toBe(0);
          currentDue = next;
        }

        // November fall back test (NY jumps Nov 1 2026, London Oct 25 2026)
        const octStart = DateTime.fromObject(
          { year: 2026, month: 10, day: 20, hour: 9, minute: 0, second: 0 },
          { zone: tz }
        ).toJSDate();

        currentDue = octStart;
        for (let i = 0; i < 20; i++) {
          const next = calculateNextOccurrence({
            rruleStr: "FREQ=DAILY;INTERVAL=1",
            mode: "fixed",
            timezone: tz,
            dtstart: octStart,
            referenceDueAt: currentDue,
            allDay: false,
            now: currentDue ?? undefined,
          });
          expect(next).not.toBeNull();
          const localDt = DateTime.fromJSDate(next!).setZone(tz);
          expect(localDt.hour).toBe(9);
          expect(localDt.minute).toBe(0);
          currentDue = next;
        }
      }
    });
  });

  describe("2. Task Completion & Recurrence Spawning", () => {
    it("spawns exactly 1 next instance on double-tap completion", async () => {
      const { authHeaders } = await createAuthUser("DoubleTapUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create task due tomorrow at 9am
      const dueTomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Daily Standup",
            listId: inboxId,
            dueAt: dueTomorrow.toISOString(),
          }),
        })
      );
      expect(taskRes.status).toBe(201);
      const task = (await taskRes.json()) as any;

      // Attach recurrence rule: FREQ=DAILY
      const attachRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/recurrence`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({
            rrule: "FREQ=DAILY;INTERVAL=1",
            mode: "fixed",
          }),
        })
      );
      expect(attachRes.status).toBe(200);

      // Simulate simultaneous/double-tap complete requests
      const [tap1, tap2] = await Promise.all([
        app.handle(
          new Request(`http://localhost:3001/api/v1/tasks/${task.id}/complete`, {
            method: "POST",
            headers: authHeaders,
          })
        ),
        app.handle(
          new Request(`http://localhost:3001/api/v1/tasks/${task.id}/complete`, {
            method: "POST",
            headers: authHeaders,
          })
        ),
      ]);

      expect(tap1.status).toBe(200);
      expect(tap2.status).toBe(200);

      const res1 = (await tap1.json()) as any;
      const res2 = (await tap2.json()) as any;

      // Exactly one of them spawned the next instance, while the other received nextTask = null
      const spawnedCount = (res1.nextTask ? 1 : 0) + (res2.nextTask ? 1 : 0);
      expect(spawnedCount).toBe(1);

      // Query active tasks in list - must only be 1 open task (the next recurrence)
      const listTasksRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks?listId=${inboxId}&status=todo`, {
          headers: authHeaders,
        })
      );
      const listTasks = (await listTasksRes.json()) as any;
      expect(listTasks.items).toHaveLength(1);
      expect(listTasks.items[0].title).toBe("Daily Standup");
      expect(listTasks.items[0].status).toBe("todo");
    });

    it("jumps to the next future occurrence when a task is completed 3 weeks late", async () => {
      const { authHeaders } = await createAuthUser("LateCompleteUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Task due 3 weeks ago (21 days in past)
      const dueThreeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000);
      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Daily Journal",
            listId: inboxId,
            dueAt: dueThreeWeeksAgo.toISOString(),
          }),
        })
      );
      const task = (await taskRes.json()) as any;

      // Attach daily recurrence rule
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/recurrence`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({
            rrule: "FREQ=DAILY;INTERVAL=1",
            mode: "fixed",
            dtstart: dueThreeWeeksAgo.toISOString(),
          }),
        })
      );

      // Complete the overdue task
      const completeRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/complete`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(completeRes.status).toBe(200);
      const completed = (await completeRes.json()) as any;
      expect(completed.nextTask).not.toBeNull();

      // The next instance's dueAt must be in the FUTURE (not 20 days ago)
      const nextDue = new Date(completed.nextTask.dueAt);
      expect(nextDue.getTime()).toBeGreaterThan(Date.now());
    });

    it("terminates series after maxCount completions", async () => {
      const { authHeaders } = await createAuthUser("MaxCountUser");
      const inboxId = await getUserInboxId(authHeaders);

      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Take Antibiotics",
            listId: inboxId,
            dueAt: new Date(Date.now() + 100000).toISOString(),
          }),
        })
      );
      const task = (await taskRes.json()) as any;

      // Attach rule with maxCount = 3
      const recRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/recurrence`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({
            rrule: "FREQ=DAILY;INTERVAL=1",
            mode: "fixed",
            maxCount: 3,
          }),
        })
      );
      expect(recRes.status).toBe(200);
      const { recurrence } = (await recRes.json()) as any;

      // Complete instance 1 (count: 1) -> spawns instance 2
      const c1 = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/complete`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      const r1 = (await c1.json()) as any;
      expect(r1.nextTask).not.toBeNull();
      const task2Id = r1.nextTask.id;

      // Complete instance 2 (count: 2) -> spawns instance 3
      const c2 = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task2Id}/complete`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      const r2 = (await c2.json()) as any;
      expect(r2.nextTask).not.toBeNull();
      const task3Id = r2.nextTask.id;

      // Complete instance 3 (count: 3) -> reaches maxCount 3! Must NOT spawn nextTask
      const c3 = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task3Id}/complete`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      const r3 = (await c3.json()) as any;
      expect(r3.nextTask).toBeNull();

      // Recurrence series is marked active = false
      const [series] = await db
        .select()
        .from(recurrences)
        .where(eq(recurrences.id, recurrence.id));
      expect(series.completedCount).toBe(3);
      expect(series.active).toBe(false);
    });

    it("calculates after_completion mode from completion time", async () => {
      const { authHeaders } = await createAuthUser("AfterCompUser");
      const inboxId = await getUserInboxId(authHeaders);

      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Water Fern",
            listId: inboxId,
            dueAt: new Date("2026-11-01T10:00:00.000Z").toISOString(),
          }),
        })
      );
      const task = (await taskRes.json()) as any;

      // Attach after_completion rule: every 3 days after completion
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/recurrence`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({
            rrule: "FREQ=DAILY;INTERVAL=3",
            mode: "after_completion",
          }),
        })
      );

      const beforeComplete = Date.now();
      const completeRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/complete`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(completeRes.status).toBe(200);
      const res = (await completeRes.json()) as any;
      expect(res.nextTask).not.toBeNull();

      // Next task due date should be ~3 days from completion time (not from Nov 1)
      const nextDue = new Date(res.nextTask.dueAt).getTime();
      const approx3DaysFromNow = beforeComplete + 3 * 24 * 60 * 60 * 1000;
      // Allow +/- 1 day leeway for time of day alignment
      expect(Math.abs(nextDue - approx3DaysFromNow)).toBeLessThan(24 * 60 * 60 * 1000);
    });

    it("skips task instance without incrementing completedCount", async () => {
      const { authHeaders } = await createAuthUser("SkipUser");
      const inboxId = await getUserInboxId(authHeaders);

      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Weekly Workout",
            listId: inboxId,
            dueAt: new Date(Date.now() + 100000).toISOString(),
          }),
        })
      );
      const task = (await taskRes.json()) as any;

      const recRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/recurrence`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({
            rrule: "FREQ=WEEKLY;INTERVAL=1",
            mode: "fixed",
          }),
        })
      );
      const { recurrence } = (await recRes.json()) as any;

      // Skip current instance
      const skipRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/skip`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(skipRes.status).toBe(200);
      const skipData = (await skipRes.json()) as any;
      expect(skipData.status).toBe("cancelled");
      expect(skipData.nextTask).not.toBeNull();

      // Recurrence completedCount should still be 0!
      const [series] = await db
        .select()
        .from(recurrences)
        .where(eq(recurrences.id, recurrence.id));
      expect(series.completedCount).toBe(0);
    });
  });

  describe("3. Recurrence Rule Management & Deletion Cascade", () => {
    it("deleting open task deactivates series, restoring reactivates", async () => {
      const { authHeaders } = await createAuthUser("DeleteSeriesUser");
      const inboxId = await getUserInboxId(authHeaders);

      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Subscription Renewal",
            listId: inboxId,
            dueAt: new Date(Date.now() + 100000).toISOString(),
          }),
        })
      );
      const task = (await taskRes.json()) as any;

      const recRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/recurrence`, {
          method: "PUT",
          headers: authHeaders,
          body: JSON.stringify({
            rrule: "FREQ=MONTHLY;INTERVAL=1",
            mode: "fixed",
          }),
        })
      );
      const { recurrence } = (await recRes.json()) as any;
      expect(recurrence.active).toBe(true);

      // Delete the open task
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Verify series is deactivated
      const [seriesDeactivated] = await db
        .select()
        .from(recurrences)
        .where(eq(recurrences.id, recurrence.id));
      expect(seriesDeactivated.active).toBe(false);

      // Restore task from trash
      const restoreRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/trash/task/${task.id}/restore`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(restoreRes.status).toBe(200);

      // Verify series is reactivated
      const [seriesReactivated] = await db
        .select()
        .from(recurrences)
        .where(eq(recurrences.id, recurrence.id));
      expect(seriesReactivated.active).toBe(true);
    });
  });
});
