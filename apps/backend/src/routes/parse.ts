import { Elysia, t } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { parseNaturalLanguage, type ParsedTaskResult } from "../utils/parser";

export const parseRoutes = new Elysia()
  .use(authMacro)
  // POST /api/v1/parse - parse natural language task text into components
  .post(
    "/api/v1/parse",
    async ({ user, body, status }) => {
      const userLists = await db
        .select({ id: schema.lists.id, name: schema.lists.name, isInbox: schema.lists.isInbox })
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );

      const [userInfo] = await db
        .select({ timezone: schema.users.timezone })
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      const timezone = body.timezone || userInfo?.timezone || "UTC";

      let parsed: ParsedTaskResult;
      try {
        parsed = parseNaturalLanguage(body.text, userLists, timezone);
      } catch (err: any) {
        if (err.message === "EMPTY_TITLE") {
          return status(422, {
            error: "EMPTY_TITLE",
            message: "Title cannot be empty after parsing",
          });
        }
        return status(400, { error: err.message });
      }

      return parsed;
    },
    {
      auth: true,
      body: t.Object({
        text: t.String(),
        timezone: t.Optional(t.String()),
      }),
    }
  );
