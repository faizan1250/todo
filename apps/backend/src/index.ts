import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth, trustedOrigins } from "./auth";
import { meRoutes } from "./routes/me";
import { inviteRoutes } from "./routes/invite";
import { folderRoutes } from "./routes/folders";
import { listRoutes } from "./routes/lists";
import { sectionRoutes } from "./routes/sections";
import { tagRoutes } from "./routes/tags";
import { checklistRoutes } from "./routes/checklist";
import { taskRoutes } from "./routes/tasks";
import { templateRoutes } from "./routes/templates";
import { trashRoutes } from "./routes/trash";
import { cron } from "@elysiajs/cron";
import { purgeOldSoftDeleted } from "./utils/purge";

export const app = new Elysia()
  .use(
    cors({
      origin: trustedOrigins,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
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
}

const PORT = Number(process.env.PORT) || 3001;

if (import.meta.main) {
  app.listen(PORT);
  console.log(`Backend server running on http://localhost:${app.server?.port ?? PORT}`);
}

export type App = typeof app;
