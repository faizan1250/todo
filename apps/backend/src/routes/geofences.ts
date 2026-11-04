import { Elysia, t } from "elysia";
import { and, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { getTasksWithIncludes } from "../utils/tasks";

export const geofenceRoutes = new Elysia()
  .use(authMacro)
  // GET /api/v1/geofences - returns user's open, non-deleted tasks that have lat and lng, sorted by priority desc
  .get(
    "/api/v1/geofences",
    async ({ user }) => {
      const geoTasks = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt),
            isNull(schema.tasks.archivedAt),
            ne(schema.tasks.status, "done"),
            ne(schema.tasks.status, "cancelled"),
            isNotNull(schema.tasks.lat),
            isNotNull(schema.tasks.lng)
          )
        )
        .orderBy(desc(schema.tasks.priority), desc(schema.tasks.createdAt));

      const tasksWithIncludes = await getTasksWithIncludes(geoTasks, null, user.id);
      return tasksWithIncludes;
    },
    {
      auth: true,
    }
  )
  // POST /api/v1/tasks/:id/location-triggered - records a notification record for the user
  .post(
    "/api/v1/tasks/:id/location-triggered",
    async ({ user, params: { id }, body, status }) => {
      const [task] = await db
        .select()
        .from(schema.tasks)
        .where(
          and(
            eq(schema.tasks.id, id),
            eq(schema.tasks.userId, user.id),
            isNull(schema.tasks.deletedAt)
          )
        );

      if (!task) {
        return status(404, { error: "Task not found" });
      }

      const now = new Date();
      const title = (body as any)?.title || `Location Reminder: ${task.title}`;
      const notificationBody =
        (body as any)?.body ||
        task.notes ||
        `You have arrived at ${task.locationName || "the task location"}`;

      const [notification] = await db
        .insert(schema.notifications)
        .values({
          userId: user.id,
          taskId: id,
          type: "location_trigger",
          title,
          body: notificationBody,
          read: false,
          triggeredAt: now,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return status(201, { success: true, notification });
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Optional(
        t.Object({
          title: t.Optional(t.String()),
          body: t.Optional(t.String()),
        })
      ),
    }
  );
