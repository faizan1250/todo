import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { db, tasks, checklistItems, tags, templates } from "../src/db";
import { and, eq, isNull } from "drizzle-orm";
import { createAuthUser } from "./helpers";

describe("Phase 2 Part 5 Backend: Templates, Save-As-Template, Instantiate & Swagger", () => {
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

  /* -------------------------------------------------------------
   * 1. SAVE AS TEMPLATE
   * ----------------------------------------------------------- */
  describe("1. Save as Template (POST /api/v1/tasks/:id/save-as-template)", () => {
    it("snapshots a task tree with tags, checklist, and subtasks into template payload", async () => {
      const { user, authHeaders } = await createAuthUser("SaveTmplUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create tag
      const tagRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Onboarding" }),
        })
      );
      const tag = (await tagRes.json()) as any;

      // Root task
      const rootRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Employee Onboarding Workflow",
            notes: "Complete standard IT setup",
            priority: 2,
            estimateMin: 180,
            listId: inboxId,
            tagIds: [tag.id],
          }),
        })
      );
      const rootTask = (await rootRes.json()) as any;

      // Add root checklist
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${rootTask.id}/checklist`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ text: "Sign contracts" }),
        })
      );

      // Subtask
      const subRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Hardware Provisioning",
            listId: inboxId,
            parentId: rootTask.id,
          }),
        })
      );
      const subTask = (await subRes.json()) as any;

      // Subtask checklist
      await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${subTask.id}/checklist`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ text: "Order MacBook Pro" }),
        })
      );

      // Save as template
      const saveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${rootTask.id}/save-as-template`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "New Hire Onboarding",
          }),
        })
      );

      expect(saveRes.status).toBe(201);
      const saved = (await saveRes.json()) as any;
      expect(saved.id).toBeDefined();
      expect(saved.name).toBe("New Hire Onboarding");
      expect(saved.version).toBe(1);

      // Check payload snapshot
      const payload = saved.payload;
      expect(payload.title).toBe("Employee Onboarding Workflow");
      expect(payload.notes).toBe("Complete standard IT setup");
      expect(payload.priority).toBe(2);
      expect(payload.estimateMin).toBe(180);
      expect(payload.tags).toEqual(["Onboarding"]);
      expect(payload.checklist).toEqual(["Sign contracts"]);

      // Check subtasks in payload
      expect(payload.subtasks).toBeDefined();
      expect(payload.subtasks.length).toBe(1);
      expect(payload.subtasks[0].title).toBe("Hardware Provisioning");
      expect(payload.subtasks[0].checklist).toEqual(["Order MacBook Pro"]);
    });

    it("rejects save-as-template when empty name or non-existent task is provided", async () => {
      const { authHeaders } = await createAuthUser("SaveValidationUser");
      const inboxId = await getUserInboxId(authHeaders);

      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Valid Task", listId: inboxId }),
        })
      );
      const task = (await taskRes.json()) as any;

      // Empty name
      const emptyNameRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/save-as-template`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "   " }),
        })
      );
      expect(emptyNameRes.status).toBe(400);

      // Non-existent task
      const missingTaskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks/non-existent-task/save-as-template", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Template Name" }),
        })
      );
      expect(missingTaskRes.status).toBe(404);
    });
  });

  /* -------------------------------------------------------------
   * 2. TEMPLATES CRUD
   * ----------------------------------------------------------- */
  describe("2. Templates CRUD (/api/v1/templates)", () => {
    it("creates, reads, updates, and soft deletes a template with version incrementing", async () => {
      const { user, authHeaders } = await createAuthUser("TemplatesCrudUser");

      // 1. Create Template
      const createRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Bug Report Template",
            payload: {
              title: "Bug: [Summary]",
              notes: "Steps to reproduce:\n1.\n2.",
              priority: 3,
              tags: ["Bug", "Triage"],
              checklist: ["Reproduce locally", "Write test case", "Submit PR"],
              subtasks: [
                {
                  title: "Root Cause Investigation",
                  checklist: ["Check server logs", "Inspect database state"],
                },
              ],
            },
          }),
        })
      );

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as any;
      expect(created.id).toBeDefined();
      expect(created.name).toBe("Bug Report Template");
      expect(created.version).toBe(1);

      // 2. List Templates
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          headers: authHeaders,
        })
      );
      expect(listRes.status).toBe(200);
      const list = (await listRes.json()) as any[];
      expect(list.length).toBe(1);
      expect(list[0].id).toBe(created.id);

      // 3. Get Single Template
      const getRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${created.id}`, {
          headers: authHeaders,
        })
      );
      expect(getRes.status).toBe(200);
      const single = (await getRes.json()) as any;
      expect(single.id).toBe(created.id);
      expect(single.payload.title).toBe("Bug: [Summary]");

      // 4. Update Template (PATCH)
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${created.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Critical Bug Template",
            payload: {
              title: "CRITICAL: [Summary]",
              priority: 4,
            },
          }),
        })
      );
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as any;
      expect(patched.name).toBe("Critical Bug Template");
      expect(patched.payload.title).toBe("CRITICAL: [Summary]");
      expect(patched.version).toBe(2);

      // 5. Delete Template (Soft Delete)
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${created.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Verify list no longer returns deleted template
      const listAfterRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          headers: authHeaders,
        })
      );
      const listAfter = (await listAfterRes.json()) as any[];
      expect(listAfter.length).toBe(0);

      // Verify get returns 404
      const getAfterRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${created.id}`, {
          headers: authHeaders,
        })
      );
      expect(getAfterRes.status).toBe(404);
    });

    it("rejects templates exceeding max depth 3 or node cap 100", async () => {
      const { authHeaders } = await createAuthUser("TemplatesValidationUser");

      // Construct a payload with depth 4 (Level 1 -> 2 -> 3 -> 4)
      const depth4Payload = {
        title: "Level 1",
        subtasks: [
          {
            title: "Level 2",
            subtasks: [
              {
                title: "Level 3",
                subtasks: [
                  {
                    title: "Level 4 (Invalid)",
                  },
                ],
              },
            ],
          },
        ],
      };

      const depthRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Deep Template",
            payload: depth4Payload,
          }),
        })
      );
      expect(depthRes.status).toBe(400);

      // Construct a payload with 101 nodes
      const subtasks100 = Array.from({ length: 101 }, (_, i) => ({ title: `Task ${i}` }));
      const overflowPayload = {
        title: "Root",
        subtasks: subtasks100,
      };

      const overflowRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Overflow Template",
            payload: overflowPayload,
          }),
        })
      );
      expect(overflowRes.status).toBe(400);
    });

    it("enforces multi-tenant isolation on templates", async () => {
      const userA = await createAuthUser("TmplTenantA");
      const userB = await createAuthUser("TmplTenantB");

      const createRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({
            name: "Tenant A Template",
            payload: { title: "Private Template" },
          }),
        })
      );
      const tmplA = (await createRes.json()) as any;

      // User B attempts GET
      const getRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${tmplA.id}`, {
          headers: userB.authHeaders,
        })
      );
      expect(getRes.status).toBe(404);

      // User B attempts PATCH
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${tmplA.id}`, {
          method: "PATCH",
          headers: userB.authHeaders,
          body: JSON.stringify({ name: "Hacked" }),
        })
      );
      expect(patchRes.status).toBe(404);

      // User B attempts DELETE
      const deleteRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${tmplA.id}`, {
          method: "DELETE",
          headers: userB.authHeaders,
        })
      );
      expect(deleteRes.status).toBe(404);
    });
  });

  /* -------------------------------------------------------------
   * 3. TEMPLATE INSTANTIATE ENGINE
   * ----------------------------------------------------------- */
  describe("3. Template Instantiate (POST /api/v1/templates/:id/instantiate)", () => {
    it("instantiates a template tree, auto-creates missing tags case-insensitively, and creates checklist and subtasks", async () => {
      const { user, authHeaders } = await createAuthUser("InstantiateUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Pre-create existing tag "frontend" in lowercase
      const preTagRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tags", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "frontend", color: "#3b82f6" }),
        })
      );
      expect(preTagRes.status).toBe(201);
      const preTag = (await preTagRes.json()) as any;

      // Create template with "Frontend" (matching pre-existing tag case-insensitively)
      // and "DesignSystem" + "Accessibility" (new missing tags)
      const tmplRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Component Workflow",
            payload: {
              title: "Build UI Component",
              notes: "Adhere to tokens and guidelines",
              priority: 2,
              estimateMin: 90,
              tags: ["Frontend", "DesignSystem"],
              checklist: ["Component spec", "Figma sync"],
              subtasks: [
                {
                  title: "Storybook & A11y",
                  tags: ["Accessibility"],
                  checklist: ["Add stories", "Run axe audit"],
                  subtasks: [
                    {
                      title: "Screen Reader Testing",
                      checklist: ["Test with VoiceOver"],
                    },
                  ],
                },
              ],
            },
          }),
        })
      );
      expect(tmplRes.status).toBe(201);
      const tmpl = (await tmplRes.json()) as any;

      // Instantiate template into inbox
      const instRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${tmpl.id}/instantiate`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            listId: inboxId,
          }),
        })
      );
      expect(instRes.status).toBe(201);
      const tree = (await instRes.json()) as any;

      // Root task assertions
      expect(tree.id).toBeDefined();
      expect(tree.title).toBe("Build UI Component");
      expect(tree.notes).toBe("Adhere to tokens and guidelines");
      expect(tree.priority).toBe(2);
      expect(tree.estimateMin).toBe(90);
      expect(tree.status).toBe("todo");
      expect(tree.listId).toBe(inboxId);
      expect(tree.parentId).toBeNull();

      // Verify root tags
      expect(tree.tags.length).toBe(2);
      // "frontend" tag was reused (same id)
      const reusedTag = tree.tags.find((t: any) => t.name.toLowerCase() === "frontend");
      expect(reusedTag).toBeDefined();
      expect(reusedTag.id).toBe(preTag.id);

      // "DesignSystem" was newly created
      const newDsTag = tree.tags.find((t: any) => t.name === "DesignSystem");
      expect(newDsTag).toBeDefined();

      // Verify root checklist
      expect(tree.checklist.length).toBe(2);
      expect(tree.checklist[0].text).toBe("Component spec");
      expect(tree.checklist[0].done).toBe(false);
      expect(tree.checklist[1].text).toBe("Figma sync");
      expect(tree.checklist[1].done).toBe(false);

      // Level 2 Subtask assertions
      expect(tree.subtasks.length).toBe(1);
      const subtask = tree.subtasks[0];
      expect(subtask.title).toBe("Storybook & A11y");
      expect(subtask.parentId).toBe(tree.id);
      expect(subtask.tags.length).toBe(1);
      expect(subtask.tags[0].name).toBe("Accessibility"); // auto-created!
      expect(subtask.checklist.length).toBe(2);
      expect(subtask.checklist[0].text).toBe("Add stories");

      // Level 3 Grandchild assertions
      expect(subtask.subtasks.length).toBe(1);
      const grandchild = subtask.subtasks[0];
      expect(grandchild.title).toBe("Screen Reader Testing");
      expect(grandchild.parentId).toBe(subtask.id);
      expect(grandchild.checklist.length).toBe(1);
      expect(grandchild.checklist[0].text).toBe("Test with VoiceOver");

      // Verify in DB that missing tags were auto-created for this user
      const userTags = await db
        .select()
        .from(tags)
        .where(and(eq(tags.userId, user.id), isNull(tags.deletedAt)));
      const tagNames = userTags.map((t) => t.name);
      expect(tagNames).toContain("frontend");
      expect(tagNames).toContain("DesignSystem");
      expect(tagNames).toContain("Accessibility");
    });

    it("validates target container: rejects alien sections and parent nesting depth overflow", async () => {
      const { user, authHeaders } = await createAuthUser("InstantiateValidationUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Create another list and section
      const list2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Work List" }),
        })
      );
      const list2 = (await list2Res.json()) as any;

      const sectionRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list2.id}/sections`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Work Section" }),
        })
      );
      const alienSection = (await sectionRes.json()) as any;

      // Template with 2 levels of hierarchy (Root -> Child)
      const tmplRes = await app.handle(
        new Request("http://localhost:3001/api/v1/templates", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Two-Level Template",
            payload: {
              title: "Tmpl Root",
              subtasks: [{ title: "Tmpl Child" }],
            },
          }),
        })
      );
      const tmpl = (await tmplRes.json()) as any;

      // 1. Alien section check: section belongs to list2, not inboxId
      const alienSectionRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${tmpl.id}/instantiate`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            listId: inboxId,
            sectionId: alienSection.id,
          }),
        })
      );
      expect(alienSectionRes.status).toBe(400);

      // 2. Parent nesting depth overflow:
      // Create root task (depth 1) and subtask (depth 2)
      const pRootRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Existing Root", listId: inboxId }),
        })
      );
      const pRoot = (await pRootRes.json()) as any;

      const pSubRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ title: "Existing Subtask (depth 2)", listId: inboxId, parentId: pRoot.id }),
        })
      );
      const pSub = (await pSubRes.json()) as any;

      // Instantiating a 2-level template under a depth 2 parent would reach depth 4 (2 + 2 = 4 > 3)
      const depthOverflowRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/templates/${tmpl.id}/instantiate`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            listId: inboxId,
            parentId: pSub.id,
          }),
        })
      );
      expect(depthOverflowRes.status).toBe(400);
    });
  });

  /* -------------------------------------------------------------
   * 4. SWAGGER OPENAPI DOCUMENTATION
   * ----------------------------------------------------------- */
  describe("4. Swagger OpenAPI Documentation", () => {
    it("responds with 200 on /swagger HTML documentation UI", async () => {
      const res = await app.handle(new Request("http://localhost:3001/swagger"));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("responds with 200 on /swagger/json containing OpenAPI 3 spec and documentation info", async () => {
      const res = await app.handle(new Request("http://localhost:3001/swagger/json"));
      expect(res.status).toBe(200);
      const json = (await res.json()) as any;

      expect(json.openapi).toBeDefined();
      expect(json.info).toBeDefined();
      expect(json.info.title).toBe("Todo App API");
      expect(json.info.version).toBe("1.0.0");

      // Verify defined tags exist
      expect(json.tags).toBeDefined();
      const tagNames = json.tags.map((t: any) => t.name);
      expect(tagNames).toContain("Tasks");
      expect(tagNames).toContain("Templates");

      // Verify OpenAPI paths are populated
      expect(json.paths).toBeDefined();
      expect(json.paths["/health"]).toBeDefined();
    });
  });
});
