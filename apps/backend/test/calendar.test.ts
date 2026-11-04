import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { db } from "../src/db";
import * as schema from "../src/db/schema";
import { DateTime } from "luxon";

describe("Phase 4 Calendar & Virtual Recurrence Expansion", () => {
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

  it("rejects date range exceeding 62 days with 422", async () => {
    const { authHeaders } = await createAuthUser("CalendarRangeUser");
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/calendar?from=2026-01-01&to=2026-03-15", {
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(422);
    const data = (await res.json()) as any;
    expect(data.error).toBe("Date range too large");
  });

  it("returns concrete tasks, time blocks, and expanded virtual recurrences with deduplication", async () => {
    const { authHeaders, user } = await createAuthUser("CalendarUser");
    const inboxId = await getUserInboxId(authHeaders);

    const baseDate = new Date("2026-05-01T10:00:00.000Z");

    // 1. Concrete Task (due on 2026-05-02)
    const concreteTask = await createTask(authHeaders, {
      title: "Design System Review",
      listId: inboxId,
      dueAt: new Date("2026-05-02T14:00:00.000Z").toISOString(),
      priority: 3,
    });

    // 2. Concrete Task with Recurrence (Daily recurrence starting 2026-05-01)
    const recurringTask = await createTask(authHeaders, {
      title: "Daily Standup",
      listId: inboxId,
      dueAt: new Date("2026-05-01T09:00:00.000Z").toISOString(),
      priority: 2,
    });

    // Attach recurrence via PUT /api/v1/tasks/:id/recurrence
    const recRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${recurringTask.id}/recurrence`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({
          rrule: "FREQ=DAILY;INTERVAL=1",
          mode: "fixed",
        }),
      })
    );
    expect(recRes.status).toBe(200);
    const recData = (await recRes.json()) as any;
    const recurrenceId = recData.recurrence.id;

    // 3. Time Block (2026-05-03 from 10:00 to 11:30)
    await db.insert(schema.timeBlocks).values({
      userId: user.id,
      title: "Focus Time Deep Work",
      startAt: new Date("2026-05-03T10:00:00.000Z"),
      endAt: new Date("2026-05-03T11:30:00.000Z"),
      color: "#8b5cf6",
    });

    // Request calendar for 7 days (2026-05-01 to 2026-05-07)
    const calRes = await app.handle(
      new Request("http://localhost:3001/api/v1/calendar?from=2026-05-01T00:00:00.000Z&to=2026-05-07T23:59:59.000Z", {
        headers: authHeaders,
      })
    );

    if (calRes.status !== 200) {
      console.error("CALENDAR ERROR:", await calRes.text());
    }
    expect(calRes.status).toBe(200);
    const calData = (await calRes.json()) as any;
    expect(Array.isArray(calData.items)).toBe(true);

    const taskItems = calData.items.filter((i: any) => i.type === "task");
    const blockItems = calData.items.filter((i: any) => i.type === "block");
    const virtualItems = calData.items.filter((i: any) => i.type === "virtual");

    // Concrete tasks: concreteTask + recurringTask
    expect(taskItems.some((t: any) => t.id === concreteTask.id)).toBe(true);
    expect(taskItems.some((t: any) => t.id === recurringTask.id)).toBe(true);

    // Block item: Focus Time Deep Work
    expect(blockItems.length).toBe(1);
    expect(blockItems[0].title).toBe("Focus Time Deep Work");

    // Virtual items: Should expand for days May 2 through May 7, but NOT duplicate May 1 (which already has concreteTask)
    expect(virtualItems.length).toBeGreaterThan(0);
    for (const v of virtualItems) {
      expect(v.virtual).toBe(true);
      expect(v.id).toContain(recurrenceId);
      expect(v.title).toBe("Daily Standup");
    }

    // Verify deduplication: No virtual item on 2026-05-01T09:00:00.000Z
    const may1Virtual = virtualItems.find((v: any) => v.start === "2026-05-01T09:00:00.000Z");
    expect(may1Virtual).toBeUndefined();
  });
});
