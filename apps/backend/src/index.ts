import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { auth, trustedOrigins } from "./auth";
import { meRoutes } from "./routes/me";
import { notificationPrefsRoutes } from "./routes/notification-prefs";
import { notificationRoutes } from "./routes/notifications";
import { pushRoutes } from "./routes/push";
import { inviteRoutes } from "./routes/invite";
import { folderRoutes } from "./routes/folders";
import { listRoutes } from "./routes/lists";
import { sectionRoutes } from "./routes/sections";
import { tagRoutes } from "./routes/tags";
import { checklistRoutes } from "./routes/checklist";
import { taskRoutes } from "./routes/tasks";
import { templateRoutes } from "./routes/templates";
import { trashRoutes } from "./routes/trash";
import { reminderRoutes } from "./routes/reminders";
import { recurrenceRoutes } from "./routes/recurrences";
import { parseRoutes } from "./routes/parse";
import { placeRoutes } from "./routes/places";
import { geofenceRoutes } from "./routes/geofences";
import { viewRoutes } from "./routes/views";
import { filterRoutes } from "./routes/filters";
import { searchRoutes } from "./routes/search";
import { calendarRoutes } from "./routes/calendar";
import { boardRoutes } from "./routes/board";
import { plannerRoutes } from "./routes/planner";
import { syncRoutes } from "./routes/sync";
import { adminRoutes } from "./routes/admin";
import { wsRoutes } from "./routes/ws";
import { cron } from "@elysiajs/cron";
import { purgeOldSoftDeleted } from "./utils/purge";
import { runTick } from "./utils/notify-scheduler";
import { runWorkerOnce } from "./utils/notify-worker";
import { setServer } from "./utils/sync-publisher";

export const app = new Elysia()
  .use(
    swagger({
      path: "/swagger",
      documentation: {
        info: {
          title: "Todo App API",
          version: "1.0.0",
          description: "Production API for Todo App with tasks, subtasks, templates, and fractional ordering",
        },
        tags: [
          { name: "Auth", description: "Authentication endpoints" },
          { name: "Me", description: "User profile and preferences" },
          { name: "Invites", description: "Invitation code management" },
          { name: "Folders", description: "Folder organization" },
          { name: "Lists", description: "Task lists and projects" },
          { name: "Sections", description: "List sections / columns" },
          { name: "Tasks", description: "Tasks, subtasks, duplication, and templates" },
          { name: "Checklist", description: "Task checklist items" },
          { name: "Tags", description: "Tag taxonomy" },
          { name: "Templates", description: "Reusable task templates and instantiation" },
          { name: "Trash", description: "Soft-deleted items recovery and purge" },
        ],
      },
    })
  )
  .use(
    cors({
      origin: trustedOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: [
        "Content-Type",
        "Authorization",
        "X-Device-Id",
        "X-Client-Version",
      ],
      exposeHeaders: ["set-auth-token"],
    })
  )
  .mount(auth.handler)
  .use(meRoutes)
  .use(inviteRoutes)
  .use(folderRoutes)
  .use(listRoutes)
  .use(sectionRoutes)
  .use(tagRoutes)
  .use(checklistRoutes)
  .use(taskRoutes)
  .use(templateRoutes)
  .use(trashRoutes)
  .use(reminderRoutes)
  .use(recurrenceRoutes)
  .use(parseRoutes)
  .use(placeRoutes)
  .use(geofenceRoutes)
  .use(viewRoutes)
  .use(filterRoutes)
  .use(searchRoutes)
  .use(calendarRoutes)
  .use(boardRoutes)
  .use(plannerRoutes)
  .use(syncRoutes)
  .use(notificationPrefsRoutes)
  .use(notificationRoutes)
  .use(pushRoutes)
  .use(adminRoutes)
  .use(wsRoutes)
  .get(
    "/health",
    () => ({
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
    {
      response: t.Object({
        status: t.String(),
        timestamp: t.String(),
      }),
    }
  );

if (process.env.NODE_ENV !== "test") {
  app.use(
    cron({
      name: "purge",
      pattern: "0 3 * * *",
      run: async () => {
        await purgeOldSoftDeleted();
      },
    })
  );
  // Reminder scheduler: every 30s. `protect` (croner) plus the in-flight
  // guard in runTick() prevent overlapping ticks.
  app.use(
    cron({
      name: "notify",
      pattern: "*/30 * * * * *",
      protect: true,
      run: () => {
        void runTick().catch((err) => {
          console.error("[notify] tick failed", err);
        });
      },
    })
  );
  // Delivery worker: every 5s. In-flight guard in runWorkerOnce() plus
  // atomic claims keep overlapping runs safe. Also runs fire-and-forget
  // at the end of every scheduler tick.
  app.use(
    cron({
      name: "notify-worker",
      pattern: "*/5 * * * * *",
      protect: true,
      run: () => {
        void runWorkerOnce().catch((err) => {
          console.error("[notify] worker failed", err);
        });
      },
    })
  );
}

const PORT = Number(process.env.PORT) || 3001;

if (import.meta.main) {
  app.listen(PORT);
  setServer(app.server);
  console.log(`Backend server running on http://localhost:${app.server?.port ?? PORT}`);
  // Fire once at boot so reminders due during downtime are caught up
  // immediately (catch-up buckets apply via last_tick_at).
  if (process.env.NODE_ENV !== "test") {
    void runTick().catch((err) => {
      console.error("[notify] boot tick failed", err);
    });
  }
}

export type App = typeof app;
