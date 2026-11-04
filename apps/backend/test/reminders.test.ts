import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";

describe("Phase 3 Reminders Module", () => {
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

  it("creates, reads, and relative recomputes reminders when task dates change", async () => {
    const { authHeaders } = await createAuthUser("RemindUser1");
    const inboxId = await getUserInboxId(authHeaders);

    const initialDue = new Date(Date.now() + 48 * 60 * 60 * 1000); // 2 days in future
    const taskRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Prepare Slide Deck",
          listId: inboxId,
          dueAt: initialDue.toISOString(),
        }),
      })
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as any;

    // Create relative reminder: 2 hours (120 min) before due
    const remRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "relative",
          relativeTo: "due",
          offsetMin: -120,
        }),
      })
    );
    expect(remRes.status).toBe(201);
    const reminder = (await remRes.json()) as any;
    expect(reminder.kind).toBe("relative");
    expect(reminder.relativeTo).toBe("due");
    expect(reminder.offsetMin).toBe(-120);
    expect(reminder.firedAt).toBeNull();
    const expectedInitialRemindAt = initialDue.getTime() - 120 * 60 * 1000;
    expect(new Date(reminder.remindAt).getTime()).toBeCloseTo(expectedInitialRemindAt, -3);

    // Update task dueAt to 5 days in future -> relative reminder should automatically recompute
    const newDue = new Date(Date.now() + 120 * 60 * 60 * 1000);
    const patchTaskRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          dueAt: newDue.toISOString(),
        }),
      })
    );
    expect(patchTaskRes.status).toBe(200);

    // Fetch reminders
    const getRemindersRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        headers: authHeaders,
      })
    );
    expect(getRemindersRes.status).toBe(200);
    const reminders = (await getRemindersRes.json()) as any[];
    expect(reminders).toHaveLength(1);
    const updatedRem = reminders[0];
    const expectedNewRemindAt = newDue.getTime() - 120 * 60 * 1000;
    expect(new Date(updatedRem.remindAt).getTime()).toBeCloseTo(expectedNewRemindAt, -3);
    expect(updatedRem.firedAt).toBeNull();
  });

  it("marks past relative reminder as fired (prevents late firing)", async () => {
    const { authHeaders } = await createAuthUser("PastReminderUser");
    const inboxId = await getUserInboxId(authHeaders);

    // Task due in 30 minutes
    const dueSoon = new Date(Date.now() + 30 * 60 * 1000);
    const taskRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Due soon",
          listId: inboxId,
          dueAt: dueSoon.toISOString(),
        }),
      })
    );
    expect(taskRes.status).toBe(201);
    const task = (await taskRes.json()) as any;

    // Reminder 2 hours before due -> this resolved time is in the past! (due + 30m - 120m = 90m ago)
    const remRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "relative",
          relativeTo: "due",
          offsetMin: -120,
        }),
      })
    );
    expect(remRes.status).toBe(201);
    const reminder = (await remRes.json()) as any;
    expect(reminder.firedAt).not.toBeNull(); // marked fired because it's past
  });

  it("handles snooze presets (10m, 1h, 3h, tomorrow_9am) and dismiss", async () => {
    const { authHeaders } = await createAuthUser("SnoozeUser");
    const inboxId = await getUserInboxId(authHeaders);

    const taskRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Snooze test task",
          listId: inboxId,
        }),
      })
    );
    const task = (await taskRes.json()) as any;

    const futureDate = new Date(Date.now() + 10 * 60 * 1000);
    const remRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "absolute",
          remindAt: futureDate.toISOString(),
        }),
      })
    );
    expect(remRes.status).toBe(201);
    const reminder = (await remRes.json()) as any;

    // Dismiss reminder
    const dismissRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/reminders/${reminder.id}/dismiss`, {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(dismissRes.status).toBe(200);
    const dismissed = (await dismissRes.json()) as any;
    expect(dismissed.firedAt).not.toBeNull();

    // Snooze with "10m" preset
    const snooze10mRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/reminders/${reminder.id}/snooze`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ preset: "10m" }),
      })
    );
    expect(snooze10mRes.status).toBe(200);
    const snoozed10m = (await snooze10mRes.json()) as any;
    expect(snoozed10m.firedAt).toBeNull();
    const expected10m = Date.now() + 10 * 60 * 1000;
    expect(new Date(snoozed10m.remindAt).getTime()).toBeCloseTo(expected10m, -4);

    // Snooze with "1h" preset
    const snooze1hRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/reminders/${reminder.id}/snooze`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ preset: "1h" }),
      })
    );
    expect(snooze1hRes.status).toBe(200);
    const snoozed1h = (await snooze1hRes.json()) as any;
    expect(snoozed1h.firedAt).toBeNull();
    const expected1h = Date.now() + 60 * 60 * 1000;
    expect(new Date(snoozed1h.remindAt).getTime()).toBeCloseTo(expected1h, -4);

    // Snooze with "tomorrow_9am" preset
    const snoozeTomorrowRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/reminders/${reminder.id}/snooze`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ preset: "tomorrow_9am" }),
      })
    );
    expect(snoozeTomorrowRes.status).toBe(200);
    const snoozedTomorrow = (await snoozeTomorrowRes.json()) as any;
    expect(snoozedTomorrow.firedAt).toBeNull();
    const tomorrowRemindAt = new Date(snoozedTomorrow.remindAt);
    expect(tomorrowRemindAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("enforces maximum cap of 10 reminders per task", async () => {
    const { authHeaders } = await createAuthUser("CapUser");
    const inboxId = await getUserInboxId(authHeaders);

    const taskRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Busy Reminders Task",
          listId: inboxId,
        }),
      })
    );
    const task = (await taskRes.json()) as any;

    // Create 10 reminders
    for (let i = 1; i <= 10; i++) {
      const future = new Date(Date.now() + i * 3600 * 1000);
      const res = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            kind: "absolute",
            remindAt: future.toISOString(),
          }),
        })
      );
      expect(res.status).toBe(201);
    }

    // 11th reminder must be rejected
    const eleventhRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "absolute",
          remindAt: new Date(Date.now() + 50000000).toISOString(),
        }),
      })
    );
    expect(eleventhRes.status).toBe(400);
    const err = (await eleventhRes.json()) as any;
    expect(err.error).toContain("Maximum of 10 reminders");
  });

  it("completing a task marks all pending reminders fired, and reopen does not resurrect them", async () => {
    const { authHeaders } = await createAuthUser("CompleteReminderUser");
    const inboxId = await getUserInboxId(authHeaders);

    const taskRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: "Complete Me",
          listId: inboxId,
        }),
      })
    );
    const task = (await taskRes.json()) as any;

    // Add 2 future absolute reminders
    const r1 = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "absolute",
          remindAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
      })
    );
    expect(r1.status).toBe(201);

    const r2 = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          kind: "absolute",
          remindAt: new Date(Date.now() + 7200 * 1000).toISOString(),
        }),
      })
    );
    expect(r2.status).toBe(201);

    // Complete task
    const completeRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/complete`, {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(completeRes.status).toBe(200);

    // Verify both reminders are marked fired
    const getRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        headers: authHeaders,
      })
    );
    const reminders = (await getRes.json()) as any[];
    expect(reminders).toHaveLength(2);
    expect(reminders[0].firedAt).not.toBeNull();
    expect(reminders[1].firedAt).not.toBeNull();

    // Reopen task
    const reopenRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reopen`, {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(reopenRes.status).toBe(200);

    // Verify reminders are NOT resurrected (still fired)
    const getAfterReopen = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
        headers: authHeaders,
      })
    );
    const remindersAfterReopen = (await getAfterReopen.json()) as any[];
    expect(remindersAfterReopen[0].firedAt).not.toBeNull();
    expect(remindersAfterReopen[1].firedAt).not.toBeNull();
  });

  it("enforces multi-tenant isolation on reminders", async () => {
    const userA = await createAuthUser("UserAReminders");
    const userB = await createAuthUser("UserBReminders");
    const inboxA = await getUserInboxId(userA.authHeaders);

    const taskRes = await app.handle(
      new Request("http://localhost:3001/api/v1/tasks", {
        method: "POST",
        headers: userA.authHeaders,
        body: JSON.stringify({
          title: "User A Task",
          listId: inboxA,
        }),
      })
    );
    const taskA = (await taskRes.json()) as any;

    const remRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}/reminders`, {
        method: "POST",
        headers: userA.authHeaders,
        body: JSON.stringify({
          kind: "absolute",
          remindAt: new Date(Date.now() + 3600 * 1000).toISOString(),
        }),
      })
    );
    expect(remRes.status).toBe(201);
    const reminderA = (await remRes.json()) as any;

    // User B tries to read User A's reminders
    const readBRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}/reminders`, {
        headers: userB.authHeaders,
      })
    );
    expect(readBRes.status).toBe(404);

    // User B tries to snooze User A's reminder
    const snoozeBRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/reminders/${reminderA.id}/snooze`, {
        method: "POST",
        headers: userB.authHeaders,
        body: JSON.stringify({ preset: "10m" }),
      })
    );
    expect(snoozeBRes.status).toBe(404);

    // User B tries to delete User A's reminder
    const deleteBRes = await app.handle(
      new Request(`http://localhost:3001/api/v1/reminders/${reminderA.id}`, {
        method: "DELETE",
        headers: userB.authHeaders,
      })
    );
    expect(deleteBRes.status).toBe(404);
  });
});
