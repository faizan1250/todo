import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { db, tasks, lists, folders, sections } from "../src/db";
import { eq } from "drizzle-orm";

describe("Phase 2 Part 1 Backend: Containers (Folders, Lists, Sections)", () => {
  // Helper to create an authenticated user and return token and user info
  async function createAuthUser(namePrefix = "User") {
    const email = `${namePrefix.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
    const password = "Password123!";
    const name = `${namePrefix} ${Date.now()}`;

    const signupRes = await app.handle(
      new Request("http://localhost:3001/api/auth/sign-up/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, name }),
      })
    );

    expect(signupRes.status).toBe(200);
    const data = (await signupRes.json()) as {
      token: string;
      user: { id: string; email: string; name: string };
    };
    const token = signupRes.headers.get("set-auth-token") || data.token;

    return {
      token,
      user: data.user,
      authHeaders: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    };
  }

  describe("1. Better Auth Inbox List Auto-Creation & Protection", () => {
    it("automatically creates an 'Inbox' list (isInbox: true, position: 'a0') upon user signup", async () => {
      const { user, authHeaders } = await createAuthUser("InboxUser");

      // Verify list in database
      const userLists = await db
        .select()
        .from(lists)
        .where(eq(lists.userId, user.id));

      expect(userLists.length).toBe(1);
      expect(userLists[0].name).toBe("Inbox");
      expect(userLists[0].isInbox).toBe(true);
      expect(userLists[0].position).toBe("a0");

      // Verify list via GET /api/v1/lists endpoint
      const res = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          headers: authHeaders,
        })
      );

      expect(res.status).toBe(200);
      const apiLists = (await res.json()) as Array<{
        id: string;
        name: string;
        isInbox: boolean;
        position: string;
      }>;

      expect(apiLists.length).toBe(1);
      expect(apiLists[0].name).toBe("Inbox");
      expect(apiLists[0].isInbox).toBe(true);
      expect(apiLists[0].position).toBe("a0");
    });

    it("rejects deleting the default Inbox list with 400 Bad Request", async () => {
      const { authHeaders } = await createAuthUser("NoDeleteInbox");

      const listsRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          headers: authHeaders,
        })
      );
      const [inbox] = (await listsRes.json()) as Array<{ id: string }>;

      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${inbox.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );

      expect(delRes.status).toBe(400);
      const delBody = (await delRes.json()) as { error: string };
      expect(delBody.error).toBe("Cannot delete the default Inbox list");
    });

    it("rejects archiving the default Inbox list with 400 Bad Request", async () => {
      const { authHeaders } = await createAuthUser("NoArchiveInbox");

      const listsRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          headers: authHeaders,
        })
      );
      const [inbox] = (await listsRes.json()) as Array<{ id: string }>;

      const archiveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${inbox.id}/archive`, {
          method: "POST",
          headers: authHeaders,
        })
      );

      expect(archiveRes.status).toBe(400);
      const archiveBody = (await archiveRes.json()) as { error: string };
      expect(archiveBody.error).toBe("Cannot archive the default Inbox list");
    });
  });

  describe("2. Folders API (/api/v1/folders)", () => {
    it("performs full folder CRUD lifecycle with version incrementing and fractional positions", async () => {
      const { authHeaders } = await createAuthUser("FolderUser");

      // 1. Create first folder
      const res1 = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Work",
            color: "#3b82f6",
            icon: "briefcase",
          }),
        })
      );
      expect(res1.status).toBe(201);
      const folder1 = (await res1.json()) as {
        id: string;
        name: string;
        position: string;
        version: number;
        color: string;
        icon: string;
      };
      expect(folder1.name).toBe("Work");
      expect(folder1.version).toBe(1);
      expect(folder1.position).toBe("a0");

      // 2. Create second folder (appended at end)
      const res2 = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Personal",
            color: "#10b981",
            icon: "home",
          }),
        })
      );
      expect(res2.status).toBe(201);
      const folder2 = (await res2.json()) as { id: string; name: string; position: string };
      expect(folder2.name).toBe("Personal");
      expect(folder2.position > folder1.position).toBe(true);

      // 3. GET /api/v1/folders
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          headers: authHeaders,
        })
      );
      expect(listRes.status).toBe(200);
      const foldersList = (await listRes.json()) as Array<{ id: string; name: string }>;
      expect(foldersList.length).toBe(2);
      expect(foldersList[0].id).toBe(folder1.id);
      expect(foldersList[1].id).toBe(folder2.id);

      // 4. GET /api/v1/folders/:id
      const getRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${folder1.id}`, {
          headers: authHeaders,
        })
      );
      expect(getRes.status).toBe(200);
      const singleFolder = (await getRes.json()) as { id: string; name: string };
      expect(singleFolder.id).toBe(folder1.id);

      // 5. PATCH /api/v1/folders/:id
      const patchRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${folder1.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Work & Projects",
            color: "#6366f1",
          }),
        })
      );
      expect(patchRes.status).toBe(200);
      const updatedFolder = (await patchRes.json()) as {
        name: string;
        color: string;
        icon: string;
        version: number;
      };
      expect(updatedFolder.name).toBe("Work & Projects");
      expect(updatedFolder.color).toBe("#6366f1");
      expect(updatedFolder.icon).toBe("briefcase");
      expect(updatedFolder.version).toBe(2);
    });

    it("reorders folders using POST /api/v1/folders/:id/move", async () => {
      const { authHeaders } = await createAuthUser("MoveFolderUser");

      // Create 3 folders: F1, F2, F3
      const create = async (name: string) => {
        const res = await app.handle(
          new Request("http://localhost:3001/api/v1/folders", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name }),
          })
        );
        return (await res.json()) as { id: string; name: string; position: string };
      };

      const f1 = await create("Folder 1");
      const f2 = await create("Folder 2");
      const f3 = await create("Folder 3");

      // Move F3 before F1
      const moveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${f3.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ beforeId: f1.id }),
        })
      );
      expect(moveRes.status).toBe(200);
      const movedF3 = (await moveRes.json()) as { id: string; position: string };
      expect(movedF3.position < f1.position).toBe(true);

      // Verify order via GET /api/v1/folders -> F3, F1, F2
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          headers: authHeaders,
        })
      );
      const reordered = (await listRes.json()) as Array<{ id: string; name: string }>;
      expect(reordered.map((f) => f.name)).toEqual(["Folder 3", "Folder 1", "Folder 2"]);

      // Move F2 between F3 and F1
      const moveMidRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${f2.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ afterId: f3.id, beforeId: f1.id }),
        })
      );
      expect(moveMidRes.status).toBe(200);

      // Verify order -> F3, F2, F1
      const listRes2 = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          headers: authHeaders,
        })
      );
      const reordered2 = (await listRes2.json()) as Array<{ id: string; name: string }>;
      expect(reordered2.map((f) => f.name)).toEqual(["Folder 3", "Folder 2", "Folder 1"]);
    });

    it("soft deletes a folder and moves its child lists to root (folder_id = null)", async () => {
      const { authHeaders } = await createAuthUser("CascadeFolderUser");

      // Create folder
      const folderRes = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Parent Folder" }),
        })
      );
      const folder = (await folderRes.json()) as { id: string };

      // Create list inside folder
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Child List",
            folderId: folder.id,
          }),
        })
      );
      expect(listRes.status).toBe(201);
      const childList = (await listRes.json()) as { id: string; folderId: string };
      expect(childList.folderId).toBe(folder.id);

      // Delete folder
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${folder.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Folder should no longer appear in folders list
      const foldersListRes = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          headers: authHeaders,
        })
      );
      const foldersList = (await foldersListRes.json()) as Array<{ id: string }>;
      expect(foldersList.some((f) => f.id === folder.id)).toBe(false);

      // Child list should now have folderId = null
      const getListRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${childList.id}`, {
          headers: authHeaders,
        })
      );
      expect(getListRes.status).toBe(200);
      const updatedList = (await getListRes.json()) as { id: string; folderId: string | null };
      expect(updatedList.folderId).toBeNull();
    });
  });

  describe("3. Lists API (/api/v1/lists)", () => {
    it("handles list creation, updating, archiving, unarchiving, moving and deletion", async () => {
      const { authHeaders } = await createAuthUser("ListOperationsUser");

      // Create custom list
      const createRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Sprint Backlog",
            viewType: "board",
            color: "#ec4899",
            icon: "kanban",
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const list = (await createRes.json()) as {
        id: string;
        name: string;
        viewType: string;
        color: string;
        isInbox: boolean;
        version: number;
      };
      expect(list.name).toBe("Sprint Backlog");
      expect(list.viewType).toBe("board");
      expect(list.isInbox).toBe(false);

      // Archive list
      const archiveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}/archive`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(archiveRes.status).toBe(200);
      const archived = (await archiveRes.json()) as { archivedAt: string | null };
      expect(archived.archivedAt).not.toBeNull();

      // List should not appear in default (unarchived) query
      const activeRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          headers: authHeaders,
        })
      );
      const activeLists = (await activeRes.json()) as Array<{ id: string }>;
      expect(activeLists.some((l) => l.id === list.id)).toBe(false);

      // List should appear in archived query ?archived=true
      const archivedQueryRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists?archived=true", {
          headers: authHeaders,
        })
      );
      const archivedLists = (await archivedQueryRes.json()) as Array<{ id: string }>;
      expect(archivedLists.some((l) => l.id === list.id)).toBe(true);

      // Unarchive list
      const unarchiveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}/unarchive`, {
          method: "POST",
          headers: authHeaders,
        })
      );
      expect(unarchiveRes.status).toBe(200);
      const unarchived = (await unarchiveRes.json()) as { archivedAt: string | null };
      expect(unarchived.archivedAt).toBeNull();

      // Soft delete list
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Deleted list should not appear
      const afterDelRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          headers: authHeaders,
        })
      );
      const afterDelLists = (await afterDelRes.json()) as Array<{ id: string }>;
      expect(afterDelLists.some((l) => l.id === list.id)).toBe(false);
    });

    it("moves list between positions and assigns folderId", async () => {
      const { authHeaders } = await createAuthUser("MoveListUser");

      // Create folder
      const folderRes = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Client Work" }),
        })
      );
      const folder = (await folderRes.json()) as { id: string };

      // Create 2 lists
      const l1Res = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "List 1" }),
        })
      );
      const l1 = (await l1Res.json()) as { id: string; position: string };

      const l2Res = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "List 2" }),
        })
      );
      const l2 = (await l2Res.json()) as { id: string; position: string };

      // Move List 2 before List 1 and put it into folder
      const moveRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${l2.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            beforeId: l1.id,
            folderId: folder.id,
          }),
        })
      );
      expect(moveRes.status).toBe(200);
      const movedL2 = (await moveRes.json()) as { id: string; folderId: string; position: string };
      expect(movedL2.folderId).toBe(folder.id);
      expect(movedL2.position < l1.position).toBe(true);

      // Verify folder filter ?folderId=...
      const filterRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists?folderId=${folder.id}`, {
          headers: authHeaders,
        })
      );
      const filtered = (await filterRes.json()) as Array<{ id: string }>;
      expect(filtered.length).toBe(1);
      expect(filtered[0].id).toBe(l2.id);
    });
  });

  describe("4. Sections API (/api/v1/sections & /api/v1/lists/:id/sections)", () => {
    it("handles section creation, ordering, moving, and disassociating tasks on delete", async () => {
      const { user, authHeaders } = await createAuthUser("SectionUser");

      // Create list
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ name: "Project Kanban" }),
        })
      );
      const list = (await listRes.json()) as { id: string };

      // Create 3 sections in list: Todo, Doing, Done
      const createSec = async (name: string) => {
        const res = await app.handle(
          new Request(`http://localhost:3001/api/v1/lists/${list.id}/sections`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name }),
          })
        );
        expect(res.status).toBe(201);
        return (await res.json()) as { id: string; name: string; position: string; version: number };
      };

      const s1 = await createSec("Todo");
      const s2 = await createSec("Doing");
      const s3 = await createSec("Done");

      expect(s1.position < s2.position).toBe(true);
      expect(s2.position < s3.position).toBe(true);

      // Query sections for list
      const listSectionsRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}/sections`, {
          headers: authHeaders,
        })
      );
      expect(listSectionsRes.status).toBe(200);
      const sectionsList = (await listSectionsRes.json()) as Array<{ id: string; name: string }>;
      expect(sectionsList.map((s) => s.name)).toEqual(["Todo", "Doing", "Done"]);

      // PATCH section name
      const patchSecRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/sections/${s1.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({ name: "Backlog / Ready" }),
        })
      );
      expect(patchSecRes.status).toBe(200);
      const updatedS1 = (await patchSecRes.json()) as { name: string; version: number };
      expect(updatedS1.name).toBe("Backlog / Ready");
      expect(updatedS1.version).toBe(2);

      // Move Done before Backlog / Ready
      const moveSecRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/sections/${s3.id}/move`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ beforeId: s1.id }),
        })
      );
      expect(moveSecRes.status).toBe(200);

      // Verify new order -> Done, Backlog / Ready, Doing
      const reorderedSecRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}/sections`, {
          headers: authHeaders,
        })
      );
      const reordered = (await reorderedSecRes.json()) as Array<{ name: string }>;
      expect(reordered.map((s) => s.name)).toEqual(["Done", "Backlog / Ready", "Doing"]);

      // Insert a task in section Doing
      const taskId = "task-" + Bun.randomUUIDv7();
      await db.insert(tasks).values({
        id: taskId,
        userId: user.id,
        listId: list.id,
        sectionId: s2.id,
        title: "Test Section Task",
        position: "a0",
      });

      // Delete section Doing
      const delSecRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/sections/${s2.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delSecRes.status).toBe(200);

      // Section Doing should no longer appear
      const afterDelSecRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${list.id}/sections`, {
          headers: authHeaders,
        })
      );
      const remainingSecs = (await afterDelSecRes.json()) as Array<{ id: string }>;
      expect(remainingSecs.some((s) => s.id === s2.id)).toBe(false);

      // Task's sectionId should be nullified
      const [taskRow] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId));
      expect(taskRow.sectionId).toBeNull();
    });
  });

  describe("5. Multi-Tenant Isolation & Object-Level Authorization", () => {
    it("prevents User A from reading or modifying User B's folders, lists, and sections", async () => {
      const userA = await createAuthUser("TenantA");
      const userB = await createAuthUser("TenantB");

      // User A creates a folder, list, and section
      const folderRes = await app.handle(
        new Request("http://localhost:3001/api/v1/folders", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({ name: "User A Folder" }),
        })
      );
      const folderA = (await folderRes.json()) as { id: string };

      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/lists", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({ name: "User A List", folderId: folderA.id }),
        })
      );
      const listA = (await listRes.json()) as { id: string };

      const secRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${listA.id}/sections`, {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({ name: "User A Section" }),
        })
      );
      const secA = (await secRes.json()) as { id: string };

      // User B tries to GET User A's folder -> 404
      const bFolderGet = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${folderA.id}`, {
          headers: userB.authHeaders,
        })
      );
      expect(bFolderGet.status).toBe(404);

      // User B tries to PATCH User A's folder -> 404
      const bFolderPatch = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${folderA.id}`, {
          method: "PATCH",
          headers: userB.authHeaders,
          body: JSON.stringify({ name: "Hacked Folder" }),
        })
      );
      expect(bFolderPatch.status).toBe(404);

      // User B tries to DELETE User A's folder -> 404
      const bFolderDel = await app.handle(
        new Request(`http://localhost:3001/api/v1/folders/${folderA.id}`, {
          method: "DELETE",
          headers: userB.authHeaders,
        })
      );
      expect(bFolderDel.status).toBe(404);

      // User B tries to GET User A's list -> 404
      const bListGet = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${listA.id}`, {
          headers: userB.authHeaders,
        })
      );
      expect(bListGet.status).toBe(404);

      // User B tries to DELETE User A's list -> 404
      const bListDel = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${listA.id}`, {
          method: "DELETE",
          headers: userB.authHeaders,
        })
      );
      expect(bListDel.status).toBe(404);

      // User B tries to GET User A's sections -> 404
      const bSecGet = await app.handle(
        new Request(`http://localhost:3001/api/v1/lists/${listA.id}/sections`, {
          headers: userB.authHeaders,
        })
      );
      expect(bSecGet.status).toBe(404);

      // User B tries to PATCH User A's section -> 404
      const bSecPatch = await app.handle(
        new Request(`http://localhost:3001/api/v1/sections/${secA.id}`, {
          method: "PATCH",
          headers: userB.authHeaders,
          body: JSON.stringify({ name: "Hacked Section" }),
        })
      );
      expect(bSecPatch.status).toBe(404);
    });

    it("rejects unauthenticated requests with 401 Unauthorized", async () => {
      const getFolders = await app.handle(new Request("http://localhost:3001/api/v1/folders"));
      expect(getFolders.status).toBe(401);

      const getLists = await app.handle(new Request("http://localhost:3001/api/v1/lists"));
      expect(getLists.status).toBe(401);

      const getSections = await app.handle(new Request("http://localhost:3001/api/v1/lists/any/sections"));
      expect(getSections.status).toBe(401);
    });
  });
});
