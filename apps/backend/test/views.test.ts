import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { dayBounds, toUtcMidnight } from "../src/utils/dates";
import { DateTime } from "luxon";

describe("Phase 4 Smart Views & Fast Conditional Counts", () => {
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

  it("GET /api/v1/views returns built-in views and empty savedFilters by default", async () => {
    const { authHeaders } = await createAuthUser("ViewsUser");
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/views", {
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as any;
    expect(Array.isArray(data.builtIns)).toBe(true);
    expect(data.builtIns.length).toBe(7);
    const keys = data.builtIns.map((b: any) => b.key);
    expect(keys).toEqual(["today", "upcoming", "overdue", "priority", "no-date", "completed", "all"]);
    expect(Array.isArray(data.savedFilters)).toBe(true);
  });

  it("counts match view lengths, Today includes overdue, and No Date excludes subtasks", async () => {
    const { authHeaders, user } = await createAuthUser("CountsUser");
    const inboxId = await getUserInboxId(authHeaders);

    const tz = "UTC";
    const now = new Date();
    const bounds = dayBounds(now, tz);
    const todayStr = bounds.localDate;
    const yesterdayStr = DateTime.fromJSDate(bounds.startUtc, { zone: tz }).minus({ days: 1 }).toISODate()!;
    const tomorrowStr = DateTime.fromJSDate(bounds.startUtc, { zone: tz }).plus({ days: 1 }).toISODate()!;

    // 1. Overdue task (yesterday noon)
    const overdueTask = await createTask(authHeaders, {
      title: "Overdue Task 1",
      listId: inboxId,
      dueAt: new Date(bounds.startUtc.getTime() - 12 * 60 * 60 * 1000).toISOString(),
      allDay: false,
      priority: 3, // Also matches priority!
    });

    // 2. Today task (timed, today at startUtc + 10h)
    // If startUtc + 10h is before now (which at 23:27 it is), wait! If due_at is before now, it's overdue!
    // But today includes overdue anyway. Wait, to have a Today task that is NOT overdue:
    // timed task due_at must be >= now AND < todayEndUtcMs.
    // BUT at 23:27 UTC, now + 10 minutes (23:37 UTC) is >= now AND < 24:00 (todayEndUtcMs)!
    const safeFutureTodayMs = now.getTime() + 5 * 60 * 1000 < bounds.endUtc.getTime()
      ? now.getTime() + 5 * 60 * 1000
      : bounds.endUtc.getTime() - 1000;
    const todayTask = await createTask(authHeaders, {
      title: "Today Timed Task",
      listId: inboxId,
      dueAt: new Date(safeFutureTodayMs).toISOString(),
      allDay: false,
      priority: 2,
    });

    // 3. Today task (all-day)
    const todayAllDayTask = await createTask(authHeaders, {
      title: "Today All-Day Task",
      listId: inboxId,
      dueAt: toUtcMidnight(todayStr).toISOString(),
      allDay: true,
      priority: 1,
    });

    // 4. Upcoming task (tomorrow)
    const tomorrowTask = await createTask(authHeaders, {
      title: "Tomorrow Task",
      listId: inboxId,
      dueAt: toUtcMidnight(tomorrowStr).toISOString(),
      allDay: true,
      priority: 4, // Also priority
    });

    // 5. No-date root task
    const noDateRootTask = await createTask(authHeaders, {
      title: "No Date Root Task",
      listId: inboxId,
      priority: 0,
    });

    // 6. Subtask without date under no-date root task (must NOT appear in no-date view)
    const subtaskNoDate = await createTask(authHeaders, {
      title: "Subtask Without Date",
      listId: inboxId,
      parentId: noDateRootTask.id,
      priority: 1,
    });

    // 7. Completed task
    const completedTask = await createTask(authHeaders, {
      title: "Finished Task",
      listId: inboxId,
      priority: 2,
    });
    // Complete it via patch or complete endpoint
    const completeRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${completedTask.id}/complete`, {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(completeRes.status).toBe(200);

    // Verify GET /api/v1/views/counts
    const countsRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/counts?tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(countsRes.status).toBe(200);
    const { counts } = (await countsRes.json()) as any;

    expect(counts.overdue).toBe(1);
    // Today includes overdue (1) + today timed (1) + today all-day (1) = 3
    expect(counts.today).toBe(3);
    expect(counts.upcoming).toBe(1);
    // Priority >= 3: overdueTask (3) + tomorrowTask (4) = 2
    expect(counts.priority).toBe(2);
    // No-date: only top-level without due/start: noDateRootTask (subtask excluded!) = 1
    expect(counts["no-date"]).toBe(1);
    expect(counts.completed).toBe(1);
    // All active tasks: overdue (1), today (2), tomorrow (1), noDateRoot (1), subtaskNoDate (1) = 6
    expect(counts.all).toBe(6);

    // Verify GET /api/v1/views/today returns 3 items
    const todayRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/today?tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(todayRes.status).toBe(200);
    const todayData = (await todayRes.json()) as any;
    expect(todayData.items.length).toBe(3);
    const todayIds = todayData.items.map((i: any) => i.id);
    expect(todayIds).toContain(overdueTask.id);
    expect(todayIds).toContain(todayTask.id);
    expect(todayIds).toContain(todayAllDayTask.id);

    // Verify GET /api/v1/views/overdue returns 1 item
    const overdueRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/overdue?tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(overdueRes.status).toBe(200);
    const overdueData = (await overdueRes.json()) as any;
    expect(overdueData.items.length).toBe(1);
    expect(overdueData.items[0].id).toBe(overdueTask.id);

    // Verify GET /api/v1/views/no-date returns only noDateRootTask, excludes subtask
    const noDateRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/no-date?tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(noDateRes.status).toBe(200);
    const noDateData = (await noDateRes.json()) as any;
    expect(noDateData.items.length).toBe(1);
    expect(noDateData.items[0].id).toBe(noDateRootTask.id);

    // Verify GET /api/v1/views/upcoming returns grouped by date
    const upcomingRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/upcoming?tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(upcomingRes.status).toBe(200);
    const upcomingData = (await upcomingRes.json()) as any;
    expect(upcomingData.items.length).toBe(1);
    expect(upcomingData.items[0].id).toBe(tomorrowTask.id);
    expect(Array.isArray(upcomingData.groups)).toBe(true);
    expect(upcomingData.groups.length).toBe(1);
    expect(upcomingData.groups[0].date).toBe(tomorrowStr);
    expect(upcomingData.groups[0].tasks.length).toBe(1);
    expect(upcomingData.groups[0].tasks[0].id).toBe(tomorrowTask.id);

    // Verify GET /api/v1/views/priority
    const priorityRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/priority?tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(priorityRes.status).toBe(200);
    const priorityData = (await priorityRes.json()) as any;
    expect(priorityData.items.length).toBe(2);
    // Highest priority (4) first
    expect(priorityData.items[0].priority).toBe(4);
    expect(priorityData.items[1].priority).toBe(3);

    // Verify GET /api/v1/views/completed
    const completedRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/completed?tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(completedRes.status).toBe(200);
    const completedData = (await completedRes.json()) as any;
    expect(completedData.items.length).toBe(1);
    expect(completedData.items[0].id).toBe(completedTask.id);
  });

  it("handles keyset cursor pagination across pages", async () => {
    const { authHeaders } = await createAuthUser("PaginationUser");
    const inboxId = await getUserInboxId(authHeaders);

    // Create 5 tasks with priority 4
    for (let i = 1; i <= 5; i++) {
      await createTask(authHeaders, {
        title: `Priority Item ${i}`,
        listId: inboxId,
        priority: 4,
      });
    }

    // Page 1: limit 2
    const page1Res = await app.handle(
      new Request("http://localhost:3001/api/v1/views/priority?limit=2&tz=UTC", {
        headers: authHeaders,
      })
    );
    expect(page1Res.status).toBe(200);
    const page1 = (await page1Res.json()) as any;
    expect(page1.items.length).toBe(2);
    expect(page1.hasMore).toBe(true);
    expect(page1.nextCursor).toBeDefined();

    // Page 2: limit 2 with cursor
    const page2Res = await app.handle(
      new Request(`http://localhost:3001/api/v1/views/priority?limit=2&cursor=${page1.nextCursor}&tz=UTC`, {
        headers: authHeaders,
      })
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as any;
    expect(page2.items.length).toBe(2);
    expect(page2.hasMore).toBe(true);
    expect(page2.nextCursor).toBeDefined();

    // Ensure no overlap between page 1 and page 2
    const page1Ids = page1.items.map((i: any) => i.id);
    const page2Ids = page2.items.map((i: any) => i.id);
    for (const id of page2Ids) {
      expect(page1Ids.includes(id)).toBe(false);
    }
  });

  it("enforces multi-tenant isolation on views", async () => {
    const userA = await createAuthUser("IsolationUserA");
    const userB = await createAuthUser("IsolationUserB");
    const inboxA = await getUserInboxId(userA.authHeaders);

    await createTask(userA.authHeaders, {
      title: "User A Secret Task",
      listId: inboxA,
      priority: 4,
    });

    const userBViewsRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/all", {
        headers: userB.authHeaders,
      })
    );
    expect(userBViewsRes.status).toBe(200);
    const bData = (await userBViewsRes.json()) as any;
    expect(bData.items.length).toBe(0);

    const bCountsRes = await app.handle(
      new Request("http://localhost:3001/api/v1/views/counts", {
        headers: userB.authHeaders,
      })
    );
    expect(bCountsRes.status).toBe(200);
    const bCounts = (await bCountsRes.json()) as any;
    expect(bCounts.counts.all).toBe(0);
    expect(bCounts.counts.priority).toBe(0);
  });
});
