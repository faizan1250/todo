import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import { auth } from "./auth";
import { meRoutes } from "./routes/me";
import { inviteRoutes } from "./routes/invite";

export const app = new Elysia()
  .use(
    cors({
      origin: ["http://localhost:3000"],
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
      exposeHeaders: ["set-auth-token"],
    })
  )
  .mount(auth.handler)
  .use(meRoutes)
  .use(inviteRoutes)
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
