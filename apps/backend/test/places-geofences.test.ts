import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { db, notifications } from "../src/db";
import { eq } from "drizzle-orm";

describe("Phase 3 Places & Geofences Module", () => {
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

  describe("1. Places CRUD", () => {
    it("creates, reads, updates, and soft deletes saved places", async () => {
      const { authHeaders } = await createAuthUser("PlaceUser");

      // Create place
      const createRes = await app.handle(
        new Request("http://localhost:3001/api/v1/places", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Headquarters",
            lat: 37.7749,
            lng: -122.4194,
            radiusM: 300,
          }),
        })
      );
      expect(createRes.status).toBe(201);
      const place = (await createRes.json()) as any;
      expect(place.name).toBe("Headquarters");
      expect(place.lat).toBe(37.7749);
      expect(place.lng).toBe(-122.4194);
      expect(place.radiusM).toBe(300);

      // List places
      const listRes = await app.handle(
        new Request("http://localhost:3001/api/v1/places", {
          headers: authHeaders,
        })
      );
      expect(listRes.status).toBe(200);
      const placesList = (await listRes.json()) as any[];
      expect(placesList).toHaveLength(1);
      expect(placesList[0].id).toBe(place.id);

      // Update place
      const updateRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/places/${place.id}`, {
          method: "PATCH",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Main Office HQ",
            radiusM: 500,
          }),
        })
      );
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as any;
      expect(updated.name).toBe("Main Office HQ");
      expect(updated.radiusM).toBe(500);

      // Soft delete place
      const delRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/places/${place.id}`, {
          method: "DELETE",
          headers: authHeaders,
        })
      );
      expect(delRes.status).toBe(200);

      // Verify omitted from list
      const afterDelRes = await app.handle(
        new Request("http://localhost:3001/api/v1/places", {
          headers: authHeaders,
        })
      );
      const afterDel = (await afterDelRes.json()) as any[];
      expect(afterDel).toHaveLength(0);
    });

    it("validates coordinate boundaries (lat -90..90, lng -180..180, radius 50..5000)", async () => {
      const { authHeaders } = await createAuthUser("InvalidCoordsUser");

      // Invalid lat (> 90)
      const invLat = await app.handle(
        new Request("http://localhost:3001/api/v1/places", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "North Pole Beyond",
            lat: 95.0,
            lng: 0,
          }),
        })
      );
      expect(invLat.status).toBe(400);

      // Invalid lng (< -180)
      const invLng = await app.handle(
        new Request("http://localhost:3001/api/v1/places", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Way West",
            lat: 0,
            lng: -190.0,
          }),
        })
      );
      expect(invLng.status).toBe(400);

      // Invalid radius (< 50)
      const invRad = await app.handle(
        new Request("http://localhost:3001/api/v1/places", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: "Tiny Circle",
            lat: 0,
            lng: 0,
            radiusM: 10,
          }),
        })
      );
      expect(invRad.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("2. Geofences & Location Trigger Notifications", () => {
    it("GET /api/v1/geofences returns open tasks with coordinates sorted by priority desc", async () => {
      const { authHeaders } = await createAuthUser("GeofenceUser");
      const inboxId = await getUserInboxId(authHeaders);

      // Task 1: Priority 1 with coords
      await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Low Priority Grocery",
            listId: inboxId,
            priority: 1,
            lat: 40.7128,
            lng: -74.006,
            radiusM: 200,
          }),
        })
      );

      // Task 2: Priority 4 with coords
      await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Urgent Hardware Store",
            listId: inboxId,
            priority: 4,
            lat: 40.7589,
            lng: -73.9851,
            radiusM: 250,
          }),
        })
      );

      // Task 3: No coords
      await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Online Coding",
            listId: inboxId,
            priority: 3,
          }),
        })
      );

      // Fetch geofences
      const geoRes = await app.handle(
        new Request("http://localhost:3001/api/v1/geofences", {
          headers: authHeaders,
        })
      );
      expect(geoRes.status).toBe(200);
      const geoTasks = (await geoRes.json()) as any[];

      // Expect exactly 2 tasks, sorted by priority desc (Urgent first, then Low)
      expect(geoTasks).toHaveLength(2);
      expect(geoTasks[0].title).toBe("Urgent Hardware Store");
      expect(geoTasks[0].priority).toBe(4);
      expect(geoTasks[1].title).toBe("Low Priority Grocery");
      expect(geoTasks[1].priority).toBe(1);
    });

    it("POST /api/v1/tasks/:id/location-triggered records a notification record", async () => {
      const { user, authHeaders } = await createAuthUser("LocTriggerUser");
      const inboxId = await getUserInboxId(authHeaders);

      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Pick up dry cleaning",
            listId: inboxId,
            locationName: "Downtown Cleaners",
            lat: 34.0522,
            lng: -118.2437,
            radiusM: 200,
          }),
        })
      );
      expect(taskRes.status).toBe(201);
      const task = (await taskRes.json()) as any;

      // Trigger location notification
      const triggerRes = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${task.id}/location-triggered`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({
            title: "Arrived at Downtown Cleaners",
            body: "Don't forget the blue ticket #402!",
          }),
        })
      );
      expect(triggerRes.status).toBe(201);
      const triggerData = (await triggerRes.json()) as any;
      expect(triggerData.success).toBe(true);
      expect(triggerData.notification.taskId).toBe(task.id);
      expect(triggerData.notification.title).toBe("Arrived at Downtown Cleaners");
      expect(triggerData.notification.read).toBe(false);

      // Verify in DB
      const [dbNotif] = await db
        .select()
        .from(notifications)
        .where(eq(notifications.id, triggerData.notification.id));
      expect(dbNotif).toBeDefined();
      expect(dbNotif.userId).toBe(user.id);
      expect(dbNotif.type).toBe("location_trigger");
    });

    it("enforces multi-tenant isolation on places and location triggers", async () => {
      const userA = await createAuthUser("UserAPlaces");
      const userB = await createAuthUser("UserBPlaces");
      const inboxA = await getUserInboxId(userA.authHeaders);

      // User A creates place
      const placeRes = await app.handle(
        new Request("http://localhost:3001/api/v1/places", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({
            name: "User A Place",
            lat: 10,
            lng: 20,
          }),
        })
      );
      const placeA = (await placeRes.json()) as any;

      // User B cannot patch or delete User A's place
      const patchB = await app.handle(
        new Request(`http://localhost:3001/api/v1/places/${placeA.id}`, {
          method: "PATCH",
          headers: userB.authHeaders,
          body: JSON.stringify({ name: "Hacked" }),
        })
      );
      expect(patchB.status).toBe(404);

      const delB = await app.handle(
        new Request(`http://localhost:3001/api/v1/places/${placeA.id}`, {
          method: "DELETE",
          headers: userB.authHeaders,
        })
      );
      expect(delB.status).toBe(404);

      // User A creates task
      const taskRes = await app.handle(
        new Request("http://localhost:3001/api/v1/tasks", {
          method: "POST",
          headers: userA.authHeaders,
          body: JSON.stringify({
            title: "Secret Task A",
            listId: inboxA,
            lat: 10,
            lng: 20,
          }),
        })
      );
      const taskA = (await taskRes.json()) as any;

      // User B cannot trigger location notification on User A's task
      const triggerB = await app.handle(
        new Request(`http://localhost:3001/api/v1/tasks/${taskA.id}/location-triggered`, {
          method: "POST",
          headers: userB.authHeaders,
        })
      );
      expect(triggerB.status).toBe(404);
    });
  });
});
