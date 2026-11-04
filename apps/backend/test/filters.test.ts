import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { dayBounds, toUtcMidnight } from "../src/utils/dates";
import { validateFilterDsl, compileFilterDsl } from "../src/utils/filter-dsl";

describe("Phase 4 Filter DSL & Saved Filters", () => {
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

  describe("1. DSL Validation & Schema", () => {
    it("returns schema with fields, operators, and relativeDates", async () => {
      const res = await app.handle(new Request("http://localhost:3001/api/v1/filters/schema"));
      expect(res.status).toBe(200);
      const data = (await res.json()) as any;
      expect(data.fields).toContain("status");
      expect(data.fields).toContain("priority");
      expect(data.fields).toContain("due_at");
      expect(data.operators).toContain("eq");
      expect(data.operators).toContain("between");
      expect(data.relativeDates).toContain("today");
    });

    it("rejects depth > 4 with 422 and path", () => {
      // Depth 5
      const query = {
        and: [
          {
            or: [
              {
                and: [
                  {
                    or: [
                      {
                        field: "priority",
                        op: "gte",
                        value: 3,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      };
      const check = validateFilterDsl(query);
      expect(check.valid).toBe(false);
      if (!check.valid) {
        expect(check.error.details).toContain("Exceeds maximum depth of 4");
        expect(check.error.path).toContain("and[0].or[0].and[0].or[0]");
      }
    });

    it("rejects node count > 30 with 422 and path", () => {
      const children = Array.from({ length: 32 }, (_, i) => ({
        field: "priority",
        op: "eq",
        value: i % 4,
      }));
      const query = { and: children };
      const check = validateFilterDsl(query);
      expect(check.valid).toBe(false);
      if (!check.valid) {
        expect(check.error.details).toContain("Exceeds maximum node limit of 30");
      }
    });

    it("rejects un-whitelisted fields and operators with 422", () => {
      const badField = { field: "drop_table", op: "eq", value: "test" };
      const checkField = validateFilterDsl(badField);
      expect(checkField.valid).toBe(false);
      if (!checkField.valid) {
        expect(checkField.error.details).toContain("Field 'drop_table' is not allowed");
      }

      const badOp = { field: "priority", op: "regex", value: ".*" };
      const checkOp = validateFilterDsl(badOp);
      expect(checkOp.valid).toBe(false);
      if (!checkOp.valid) {
        expect(checkOp.error.details).toContain("Operator 'regex' is not allowed");
      }
    });
  });

  describe("2. DSL Compiler & SQL Injection Safety", () => {
    it("parameterizes all literals and prevents SQL injection", () => {
      const maliciousVal = "'; DROP TABLE tasks; --";
      const compiled = compileFilterDsl({
        field: "title",
        op: "contains",
        value: maliciousVal,
      });

      expect(compiled.sql).toBe("t.title LIKE ?");
      expect(compiled.params).toEqual([`%${maliciousVal}%`]);
    });

    it("compiles relative dates and nested compound expressions", () => {
      const compiled = compileFilterDsl(
        {
          and: [
            { field: "priority", op: "gte", value: 3 },
            {
              or: [
                { field: "due_at", op: "eq", value: "today" },
                { field: "has_recurrence", op: "eq", value: true },
              ],
            },
          ],
        },
        "UTC"
      );

      expect(compiled.sql).toContain("t.priority >= ?");
      expect(compiled.sql).toContain("t.recurrence_id IS NOT NULL");
      expect(compiled.params).toContain(3);
    });
  });

  describe("3. Saved Filters CRUD & Tasks Execution", () => {
    it("creates, retrieves, previews, and queries tasks with metadata enrichment", async () => {
      const { authHeaders, user } = await createAuthUser("FilterCrudUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create test tasks
      const task1 = await createTask(authHeaders, {
        title: "High Priority Today",
        listId: inboxId,
        priority: 4,
        dueAt: new Date().toISOString(),
      });

      const task2 = await createTask(authHeaders, {
        title: "Low Priority",
        listId: inboxId,
        priority: 1,
      });

      // 1. Preview unsaved DSL query
      const previewRes = await app.handle(
        new Request("http://localhost:3001/api/v1/filters/preview", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            query: {
              field: "priority",
              op: "gte",
              value: 3,
            },
          }),
        })
      );
      expect(previewRes.status).toBe(200);
      const previewData = (await previewRes.json()) as any;
      expect(previewData.items.length).toBe(1);
      expect(previewData.items[0].id).toBe(task1.id);
      expect(previewData.items[0].listName).toBeDefined();

      // 2. Create saved filter
      const createRes = await app.handle(
        new Request("http://localhost:3001/api/v1/filters", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Important Tasks",
            icon: "star",
            color: "#f59e0b",
            query: {
              field: "priority",
              op: "gte",
              value: 3,
            },
            pinned: true,
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const filter = (await createRes.json()) as any;
      expect(filter.id).toBeDefined();
      expect(filter.name).toBe("Important Tasks");
      expect(filter.pinned).toBe(true);

      // 3. List filters
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/filters", {
          headers: authHeaders,
        })
      );
      expect(listRes.status).toBe(200);
      const filters = (await listRes.json()) as any[];
      expect(filters.length).toBe(1);
      expect(filters[0].id).toBe(filter.id);

      // 4. Run saved filter tasks
      const tasksRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/filters/${filter.id}/tasks`, {
          headers: authHeaders,
        })
      );
      expect(tasksRes.status).toBe(200);
      const tasksData = (await tasksRes.json()) as any;
      expect(tasksData.items.length).toBe(1);
      expect(tasksData.items[0].id).toBe(task1.id);

      // 5. Update filter
      const updateRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/filters/${filter.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Urgent & Important",
            pinned: false,
          }),
        })
      );
      expect(updateRes.status).toBe(200);
      const updatedFilter = (await updateRes.json()) as any;
      expect(updatedFilter.name).toBe("Urgent & Important");
      expect(updatedFilter.pinned).toBe(false);

      // 6. Delete filter
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/filters/${filter.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Verify list is now empty
      const listAfterRes = await app.handle(
        new Request("http://localhost:3001/api/v1/filters", {
          headers: authHeaders,
        })
      );
      expect(listAfterRes.status).toBe(200);
      const filtersAfter = (await listAfterRes.json()) as any[];
      expect(filtersAfter.length).toBe(0);
    });

    it("reorders filters via /move with positionBetween", async () => {
      const { authHeaders } = await createAuthUser("FilterMoveUser");

      const f1 = (await (
        await app.handle(
          new Request("http://localhost:3001/api/v1/filters", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              name: "Filter 1",
              query: { field: "priority", op: "eq", value: 1 },
            }),
          })
        )
      ).json()) as any;

      const f2 = (await (
        await app.handle(
          new Request("http://localhost:3001/api/v1/filters", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
              name: "Filter 2",
              query: { field: "priority", op: "eq", value: 2 },
            }),
          })
        )
      ).json()) as any;

      // Move f2 before f1
      const moveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/filters/${f2.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            beforeId: f1.id,
          }),
        })
      );
      expect(moveRes.status).toBe(200);

      // List filters and check ordering
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/filters", {
          headers: authHeaders,
        })
      );
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as any[];
      expect(list[0].id).toBe(f2.id);
      expect(list[1].id).toBe(f1.id);
    });
  });
});
