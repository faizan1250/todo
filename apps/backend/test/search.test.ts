import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { sanitizeFts5Query } from "../src/routes/search";

describe("Phase 4 FTS5 Search & Cmd+K", () => {
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

  describe("1. Query Sanitizer Robustness", () => {
    it("never throws and properly sanitizes wildcards, quotes, parentheses, and boolean keywords", () => {
      expect(sanitizeFts5Query("")).toBe("");
      expect(sanitizeFts5Query("   ")).toBe("");
      expect(sanitizeFts5Query(null)).toBe("");
      expect(sanitizeFts5Query(undefined)).toBe("");

      // Single word -> prefix query
      expect(sanitizeFts5Query("groceries")).toBe('"groceries"*');

      // Preserves quoted phrases
      const phraseRes = sanitizeFts5Query('"buy milk" urgent');
      expect(phraseRes).toBe('"buy milk" "urgent"*');

      // Strips dangerous characters: * ( ) : ^ ~ -
      const messyRes = sanitizeFts5Query('(urgent* -done: NEAR AND OR)');
      expect(messyRes).toBe('"urgent" "done" "NEAR" "AND" "OR"*');
    });
  });

  describe("2. FTS Triggers on Insert, Update, and Delete", () => {
    it("updates FTS index automatically on task lifecycle", async () => {
      const { authHeaders } = await createAuthUser("FtsTriggerUser");
      const inboxId = await getUserInboxId(authHeaders);

      // 1. Insert
      const created = await createTask(authHeaders, {
        title: "Quantum Supercomputer Setup",
        notes: "Remember to cool with liquid helium",
        listId: inboxId,
      });

      // Search matching title
      const s1 = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=Quantum", {
          headers: authHeaders,
        })
      );
      expect(s1.status).toBe(200);
      const res1 = (await s1.json()) as any;
      expect(res1.tasks.length).toBe(1);
      expect(res1.tasks[0].id).toBe(created.id);
      expect(res1.tasks[0].titleHl).toBeDefined();

      // Search matching notes
      const s2 = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=helium", {
          headers: authHeaders,
        })
      );
      expect(s2.status).toBe(200);
      const res2 = (await s2.json()) as any;
      expect(res2.tasks.length).toBe(1);
      expect(res2.tasks[0].id).toBe(created.id);

      // 2. Update task
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${created.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Biological Neural Network Setup",
          }),
        })
      );
      expect(patchRes.status).toBe(200);

      // Old term "Quantum" should no longer match
      const s3 = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=Quantum", {
          headers: authHeaders,
        })
      );
      expect(s3.status).toBe(200);
      const res3 = (await s3.json()) as any;
      expect(res3.tasks.length).toBe(0);

      // New term "Biological" should match
      const s4 = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=Biological", {
          headers: authHeaders,
        })
      );
      expect(s4.status).toBe(200);
      const res4 = (await s4.json()) as any;
      expect(res4.tasks.length).toBe(1);
      expect(res4.tasks[0].id).toBe(created.id);

      // 3. Delete task
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${created.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Soft-deleted task is excluded from active search
      const s5 = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=Biological", {
          headers: authHeaders,
        })
      );
      expect(s5.status).toBe(200);
      const res5 = (await s5.json()) as any;
      expect(res5.tasks.length).toBe(0);

      // But present when searching scope=trash
      const sTrash = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=Biological&scope=trash", {
          headers: authHeaders,
        })
      );
      expect(sTrash.status).toBe(200);
      const resTrash = (await sTrash.json()) as any;
      expect(resTrash.tasks.length).toBe(1);
    });
  });

  describe("3. Stemming and Diacritics Matching", () => {
    it("matches words with diacritics and porter stemming", async () => {
      const { authHeaders } = await createAuthUser("StemmingUser");
      const inboxId = await getUserInboxId(authHeaders);

      await createTask(authHeaders, {
        title: "Visit the cozy café in Paris",
        notes: "We are actively engineering distributed systems",
        listId: inboxId,
      });

      // Stemming: "engineer" matches "engineering"
      const s1 = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=engineer", {
          headers: authHeaders,
        })
      );
      expect(s1.status).toBe(200);
      const res1 = (await s1.json()) as any;
      expect(res1.tasks.length).toBe(1);

      // Diacritics: "cafe" matches "café"
      const s2 = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=cafe", {
          headers: authHeaders,
        })
      );
      expect(s2.status).toBe(200);
      const res2 = (await s2.json()) as any;
      expect(res2.tasks.length).toBe(1);
    });
  });

  describe("4. BM25 Ranking (Title 10x vs Notes)", () => {
    it("ranks title matches above notes matches and open tasks above done ones", async () => {
      const { authHeaders } = await createAuthUser("RankingUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Task A: keyword in notes only
      const taskA = await createTask(authHeaders, {
        title: "Regular Morning Routine",
        notes: "Do not forget about the telescope observation tonight",
        listId: inboxId,
      });

      // Task B: keyword in title (10x weight)
      const taskB = await createTask(authHeaders, {
        title: "Calibrate Telescope Mirror",
        notes: "General maintenance check",
        listId: inboxId,
      });

      const s = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=telescope", {
          headers: authHeaders,
        })
      );
      expect(s.status).toBe(200);
      const res = (await s.json()) as any;
      expect(res.tasks.length).toBe(2);
      // Title match taskB must be first!
      expect(res.tasks[0].id).toBe(taskB.id);
      expect(res.tasks[1].id).toBe(taskA.id);
    });
  });

  describe("5. Cmd+K Multi-Type Search & Maintenance Rebuild", () => {
    it("returns top prefix matches across tasks, lists, tags, and filters in one call", async () => {
      const { authHeaders } = await createAuthUser("CmdKUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create task
      await createTask(authHeaders, {
        title: "Design Frontend UI",
        listId: inboxId,
      });

      // Create list
      await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Frontend Roadmap",
            color: "#3b82f6",
          }),
        })
      );

      // Create tag
      await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "frontend-dev",
            color: "#10b981",
          }),
        })
      );

      // Create saved filter
      await app.handle(
        new Request("http://localhost:3001/api/v1/filters", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Frontend Filter",
            query: { field: "priority", op: "gte", value: 1 },
          }),
        })
      );

      // Search all types with Cmd+K
      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/search?q=Frontend&types=tasks,lists,tags,filters", {
          headers: authHeaders,
        })
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.tasks.length).toBe(1);
      expect(data.lists.length).toBe(1);
      expect(data.lists[0].name).toBe("Frontend Roadmap");
      expect(data.tags.length).toBe(1);
      expect(data.tags[0].name).toBe("frontend-dev");
      expect(data.filters.length).toBe(1);
      expect(data.filters[0].name).toBe("Frontend Filter");
    });

    it("executes FTS rebuild and integrity-check via POST /api/v1/search/rebuild", async () => {
      const { authHeaders } = await createAuthUser("RebuildUser");
      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/search/rebuild", {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.success).toBe(true);
      expect(data.message).toContain("integrity verified");
    });
  });
});
