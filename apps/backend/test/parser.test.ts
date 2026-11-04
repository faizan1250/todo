import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { parseNaturalLanguage } from "../src/utils/parser";
import { db, lists, tags } from "../src/db";
import { eq } from "drizzle-orm";

describe("Phase 3 Natural Language Parser & Quick Add", () => {
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

  describe("1. ~30 Natural Language Sample Phrases", () => {
    const mockLists = [
      { id: "list-inbox", name: "Inbox", isInbox: true },
      { id: "list-work", name: "Work", isInbox: false },
      { id: "list-home", name: "Home Projects", isInbox: false },
      { id: "list-fin", name: "Finances", isInbox: false },
    ];

    it("1. call mom tomorrow 5pm #personal !high", () => {
      const p = parseNaturalLanguage("call mom tomorrow 5pm #personal !high", mockLists);
      expect(p.title).toBe("call mom");
      expect(p.dueAt).not.toBeNull();
      expect(p.allDay).toBe(false);
      expect(p.priority).toBe(3);
      expect(p.tags).toEqual(["personal"]);
    });

    it("2. pay rent every month on the 1st", () => {
      const p = parseNaturalLanguage("pay rent every month on the 1st", mockLists);
      expect(p.title).toBe("pay rent");
      expect(p.recurrence).not.toBeNull();
      expect(p.recurrence!.rrule).toBe("FREQ=MONTHLY;BYMONTHDAY=1");
      expect(p.recurrence!.mode).toBe("fixed");
    });

    it("3. gym every mon,wed,fri 7am ~1h", () => {
      const p = parseNaturalLanguage("gym every mon,wed,fri 7am ~1h", mockLists);
      expect(p.title).toBe("gym");
      expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,WE,FR");
      expect(p.estimateMin).toBe(60);
      expect(p.dueAt).not.toBeNull();
    });

    it("4. submit report next friday @work", () => {
      const p = parseNaturalLanguage("submit report next friday @work", mockLists);
      expect(p.title).toBe("submit report");
      expect(p.dueAt).not.toBeNull();
      expect(p.allDay).toBe(true);
      expect(p.list?.name).toBe("Work");
    });

    it("5. buy milk", () => {
      const p = parseNaturalLanguage("buy milk", mockLists);
      expect(p.title).toBe("buy milk");
      expect(p.dueAt).toBeNull();
      expect(p.priority).toBe(0);
      expect(p.tags).toEqual([]);
    });

    it("6. dentist 5", () => {
      const p = parseNaturalLanguage("dentist 5", mockLists);
      expect(p.title).toBe("dentist");
      expect(p.dueAt).not.toBeNull();
      expect(p.allDay).toBe(false);
    });

    it("7. standup every weekday 9:30", () => {
      const p = parseNaturalLanguage("standup every weekday 9:30", mockLists);
      expect(p.title).toBe("standup");
      expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR");
      expect(p.dueAt).not.toBeNull();
    });

    it("8. water plants every 3 days after done", () => {
      const p = parseNaturalLanguage("water plants every 3 days after done", mockLists);
      expect(p.title).toBe("water plants");
      expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=3");
      expect(p.recurrence!.mode).toBe("after_completion");
    });

    it("9. pickup laundry remind 1h before", () => {
      const p = parseNaturalLanguage("pickup laundry remind 1h before", mockLists);
      expect(p.title).toBe("pickup laundry");
      expect(p.reminders).toHaveLength(1);
      expect(p.reminders[0].kind).toBe("relative");
      expect(p.reminders[0].offsetMin).toBe(-60);
    });

    it("10. dentist appointment next monday 10am ~45m #health !urgent", () => {
      const p = parseNaturalLanguage(
        "dentist appointment next monday 10am ~45m #health !urgent",
        mockLists
      );
      expect(p.title).toBe("dentist appointment");
      expect(p.dueAt).not.toBeNull();
      expect(p.allDay).toBe(false);
      expect(p.estimateMin).toBe(45);
      expect(p.tags).toEqual(["health"]);
      expect(p.priority).toBe(4);
    });

    it("11. read book ~30m", () => {
      const p = parseNaturalLanguage("read book ~30m", mockLists);
      expect(p.title).toBe("read book");
      expect(p.estimateMin).toBe(30);
    });

    it("12. prepare taxes !urgent", () => {
      const p = parseNaturalLanguage("prepare taxes !urgent", mockLists);
      expect(p.title).toBe("prepare taxes");
      expect(p.priority).toBe(4);
    });

    it("13. call plumber #\"urgent repairs\"", () => {
      const p = parseNaturalLanguage('call plumber #"urgent repairs"', mockLists);
      expect(p.title).toBe("call plumber");
      expect(p.tags).toEqual(["urgent repairs"]);
    });

    it("14. meeting @\"Home Projects\" tomorrow", () => {
      const p = parseNaturalLanguage('meeting @"Home Projects" tomorrow', mockLists);
      expect(p.title).toBe("meeting");
      expect(p.list?.name).toBe("Home Projects");
      expect(p.dueAt).not.toBeNull();
    });

    it("15. review PR !2 ~45m", () => {
      const p = parseNaturalLanguage("review PR !2 ~45m", mockLists);
      expect(p.title).toBe("review PR");
      expect(p.priority).toBe(2);
      expect(p.estimateMin).toBe(45);
    });

    it("16. take vitamins daily", () => {
      const p = parseNaturalLanguage("take vitamins daily", mockLists);
      expect(p.title).toBe("take vitamins");
      expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=1");
    });

    it("17. trash night every other friday", () => {
      const p = parseNaturalLanguage("trash night every other friday", mockLists);
      expect(p.title).toBe("trash night");
      expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;INTERVAL=2;BYDAY=FR");
    });

    it("18. mow lawn every 2 weeks", () => {
      const p = parseNaturalLanguage("mow lawn every 2 weeks", mockLists);
      expect(p.title).toBe("mow lawn");
      expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;INTERVAL=2");
    });

    it("19. car maintenance every 6 months after completion", () => {
      const p = parseNaturalLanguage("car maintenance every 6 months after completion", mockLists);
      expect(p.title).toBe("car maintenance");
      expect(p.recurrence!.rrule).toBe("FREQ=MONTHLY;INTERVAL=6");
      expect(p.recurrence!.mode).toBe("after_completion");
    });

    it("20. doctor checkup remind me at 8am", () => {
      const p = parseNaturalLanguage("doctor checkup remind me at 8am", mockLists);
      expect(p.title).toBe("doctor checkup");
      expect(p.reminders).toHaveLength(1);
      expect(p.reminders[0].kind).toBe("absolute");
    });

    it("21. grocery shopping #groceries #errands", () => {
      const p = parseNaturalLanguage("grocery shopping #groceries #errands", mockLists);
      expect(p.title).toBe("grocery shopping");
      expect(p.tags).toEqual(["groceries", "errands"]);
    });

    it("22. board meeting next tuesday 3pm !high", () => {
      const p = parseNaturalLanguage("board meeting next tuesday 3pm !high", mockLists);
      expect(p.title).toBe("board meeting");
      expect(p.dueAt).not.toBeNull();
      expect(p.allDay).toBe(false);
      expect(p.priority).toBe(3);
    });

    it("23. write tests ~2h !3", () => {
      const p = parseNaturalLanguage("write tests ~2h !3", mockLists);
      expect(p.title).toBe("write tests");
      expect(p.estimateMin).toBe(120);
      expect(p.priority).toBe(3);
    });

    it("24. client call at 5", () => {
      const p = parseNaturalLanguage("client call at 5", mockLists);
      expect(p.title).toBe("client call");
      expect(p.dueAt).not.toBeNull();
      expect(p.allDay).toBe(false);
    });

    it("25. flight to nyc next month", () => {
      const p = parseNaturalLanguage("flight to nyc next month", mockLists);
      expect(p.title).toBe("flight to nyc");
      expect(p.dueAt).not.toBeNull();
    });

    it("26. clean garage ~3h", () => {
      const p = parseNaturalLanguage("clean garage ~3h", mockLists);
      expect(p.title).toBe("clean garage");
      expect(p.estimateMin).toBe(180);
    });

    it("27. guitar practice every day", () => {
      const p = parseNaturalLanguage("guitar practice every day", mockLists);
      expect(p.title).toBe("guitar practice");
      expect(p.recurrence!.rrule).toBe("FREQ=DAILY;INTERVAL=1");
    });

    it("28. weekly sync every monday", () => {
      const p = parseNaturalLanguage("weekly sync every monday", mockLists);
      expect(p.title).toBe("weekly sync");
      expect(p.recurrence!.rrule).toBe("FREQ=WEEKLY;BYDAY=MO");
    });

    it("29. submit expense report @finances", () => {
      const p = parseNaturalLanguage("submit expense report @finances", mockLists);
      expect(p.title).toBe("submit expense report");
      expect(p.list?.name).toBe("Finances");
    });

    it("30. renew passport remind 2 days before", () => {
      const p = parseNaturalLanguage("renew passport remind 2 days before", mockLists);
      expect(p.title).toBe("renew passport");
      expect(p.reminders).toHaveLength(1);
      expect(p.reminders[0].offsetMin).toBe(-2880); // 2 days
    });
  });

  describe("2. Edge Cases & API Endpoints", () => {
    it("returns 422 EMPTY_TITLE when input only contains tokens", async () => {
      const { authHeaders } = await createAuthUser("EmptyTitleUser");

      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/parse", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            text: "#personal !urgent @work",
          }),
        })
      );

      expect(res.status).toBe(422);
      const err = (await res.json()) as any;
      expect(err.error).toBe("EMPTY_TITLE");
    });

    it("POST /api/v1/tasks/quick creates task, tags, reminders, and recurrence atomically", async () => {
      const { authHeaders } = await createAuthUser("QuickUser");
      const inboxId = await getUserInboxId(authHeaders);

      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/quick", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            text: "Fix server outage tomorrow 3pm ~1h30m #devops #urgent !urgent remind 30m before",
          }),
        })
      );

      expect(res.status).toBe(201);
      const task = (await res.json()) as any;
      expect(task.title).toBe("Fix server outage");
      expect(task.priority).toBe(4);
      expect(task.estimateMin).toBe(90);
      expect(task.dueAt).not.toBeNull();
      expect(task.allDay).toBe(false);
      expect(task.listId).toBe(inboxId);

      // Verify tags created
      expect(task.tags).toHaveLength(2);
      const tagNames = task.tags.map((t: any) => t.name.toLowerCase());
      expect(tagNames).toContain("devops");
      expect(tagNames).toContain("urgent");

      // Verify reminders created
      const remRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/reminders`, {
          headers: authHeaders,
        })
      );
      const rems = (await remRes.json()) as any[];
      expect(rems).toHaveLength(1);
      expect(rems[0].offsetMin).toBe(-30);
    });

    it("falls back to Inbox when unknown list is specified in @list", async () => {
      const { authHeaders } = await createAuthUser("ListFallbackUser");
      const inboxId = await getUserInboxId(authHeaders);

      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/quick", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            text: "Plan vacation @nonexistentlist",
          }),
        })
      );

      expect(res.status).toBe(201);
      const task = (await res.json()) as any;
      expect(task.title).toBe("Plan vacation");
      expect(task.listId).toBe(inboxId);
    });

    it("enforces multi-tenant security on parse endpoints", async () => {
      const userA = await createAuthUser("UserAParse");
      const userB = await createAuthUser("UserBParse");

      // User A creates a private list "SuperSecret"
      const createListRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({
            name: "SuperSecret",
          }),
        })
      );
      expect(createListRes.status).toBe(201);

      // User B tries to parse a task referencing @SuperSecret
      // Should not find User A's list, should fallback to User B's inbox
      const parseBRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/parse", {
          method: "POST",
          headers: userB.authHeaders,
          body: JSON.stringify({
            text: "Do thing @SuperSecret",
          }),
        })
      );
      expect(parseBRes.status).toBe(200);
      const parsedB = (await parseBRes.json()) as any;
      expect(parsedB.list?.name).not.toBe("SuperSecret");
    });
  });
});
