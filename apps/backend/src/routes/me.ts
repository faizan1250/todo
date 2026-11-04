import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";

function parsePreferences(val: unknown): Record<string, unknown> {
  if (typeof val === "object" && val !== null) {
    return val as Record<string, unknown>;
  }
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function formatProfile(profile: typeof schema.users.$inferSelect) {
  return {
    id: profile.id,
    name: profile.name,
    email: profile.email,
    emailVerified: profile.emailVerified,
    image: profile.image ?? null,
    twoFactorEnabled: profile.twoFactorEnabled ?? false,
    role: profile.role,
    timezone: profile.timezone,
    locale: profile.locale,
    weekStartsOn: profile.weekStartsOn,
    preferences: parsePreferences(profile.preferences),
    createdAt: profile.createdAt.toISOString(),
    updatedAt: profile.updatedAt.toISOString(),
  };
}

export const meRoutes = new Elysia({ name: "routes-me" })
  .use(authMacro)
  .get(
    "/me",
    async ({ user, status }) => {
      const [profile] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      if (!profile) {
        return status(404, { error: "User not found" });
      }

      return formatProfile(profile);
    },
    {
      auth: true,
    }
  )
  .patch(
    "/me",
    async ({ user, body, status }) => {
      const updates: Partial<{
        name: string;
        timezone: string;
        locale: string;
        weekStartsOn: number;
        preferences: schema.Preferences;
        updatedAt: Date;
      }> = {
        updatedAt: new Date(),
      };

      if (body.name !== undefined) updates.name = body.name;
      if (body.timezone !== undefined) updates.timezone = body.timezone;
      if (body.locale !== undefined) updates.locale = body.locale;
      if (body.weekStartsOn !== undefined) updates.weekStartsOn = body.weekStartsOn;
      if (body.preferences !== undefined) updates.preferences = body.preferences;

      await db
        .update(schema.users)
        .set(updates)
        .where(eq(schema.users.id, user.id));

      const [updated] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, user.id));

      if (!updated) {
        return status(404, { error: "User not found" });
      }

      return formatProfile(updated);
    },
    {
      auth: true,
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        timezone: t.Optional(t.String()),
        locale: t.Optional(t.String()),
        weekStartsOn: t.Optional(t.Number({ minimum: 0, maximum: 6 })),
        preferences: t.Optional(t.Record(t.String(), t.Any())),
      }),
    }
  );
