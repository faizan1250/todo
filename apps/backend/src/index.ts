import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth, trustedOrigins } from "./auth";
import { meRoutes } from "./routes/me";
import { inviteRoutes } from "./routes/invite";
import { folderRoutes } from "./routes/folders";
import { listRoutes } from "./routes/lists";
import { sectionRoutes } from "./routes/sections";

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

const PORT = Number(process.env.PORT) || 3001;

if (import.meta.main) {
  app.listen(PORT);
  console.log(`Backend server running on http://localhost:${app.server?.port ?? PORT}`);
}

export type App = typeof app;
