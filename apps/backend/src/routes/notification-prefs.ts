import { Elysia, t } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";

const HHMM = "^([01][0-9]|2[0-3]):[0-5][0-9]$";

const ChannelPref = t.Object({
  webPush: t.Optional(t.Boolean()),
  email: t.Optional(t.Boolean()),
});

const PrefsBody = t.Object({
  types: t.Optional(t.Record(t.String(), ChannelPref)),
  quietEnabled: t.Optional(t.Boolean()),
  quietStart: t.Optional(t.String({ pattern: HHMM })),
  quietEnd: t.Optional(t.String({ pattern: HHMM })),
  urgentBreaksQuiet: t.Optional(t.Boolean()),
  pausedUntil: t.Optional(t.Union([t.String({ format: "date-time" }), t.Null()])),
  hideContent: t.Optional(t.Boolean()),
  digestDailyEnabled: t.Optional(t.Boolean()),
  digestTime: t.Optional(t.String({ pattern: HHMM })),
  weeklyEnabled: t.Optional(t.Boolean()),
  weeklyDay: t.Optional(t.Number({ minimum: 0, maximum: 6 })),
  weeklyTime: t.Optional(t.String({ pattern: HHMM })),
});

type PrefsRow = typeof schema.notificationPrefs.$inferSelect;

function toDTO(p: PrefsRow) {
  return {
    userId: p.userId,
    types: p.types ?? {},
    quietEnabled: p.quietEnabled,
    quietStart: p.quietStart,
    quietEnd: p.quietEnd,
    urgentBreaksQuiet: p.urgentBreaksQuiet,
    pausedUntil: p.pausedUntil ? p.pausedUntil.toISOString() : null,
    hideContent: p.hideContent,
    digestDailyEnabled: p.digestDailyEnabled,
    digestTime: p.digestTime,
    weeklyEnabled: p.weeklyEnabled,
    weeklyDay: p.weeklyDay,
    weeklyTime: p.weeklyTime,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function ensurePrefs(userId: string): Promise<PrefsRow> {
  const [existing] = await db
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId));
  if (existing) return existing;
  try {
    await db.insert(schema.notificationPrefs).values({ userId });
  } catch {
    // Lost an insert race — fall through to re-read.
  }
  const [row] = await db
    .select()
    .from(schema.notificationPrefs)
    .where(eq(schema.notificationPrefs.userId, userId));
  if (!row) throw new Error("Failed to create notification prefs");
  return row;
}

export const notificationPrefsRoutes = new Elysia({ name: "routes-notification-prefs" })
  .use(authMacro)
  .get("/api/v1/notification-prefs", async ({ user }) => toDTO(await ensurePrefs(user.id)), {
    auth: true,
  })
  .patch(
    "/api/v1/notification-prefs",
    async ({ user, body, status }) => {
      const current = await ensurePrefs(user.id);
      const updates: Partial<typeof schema.notificationPrefs.$inferInsert> = {
        updatedAt: new Date(),
      };
      if (body.types !== undefined) {
        updates.types = { ...(current.types ?? {}), ...body.types };
      }
      if (body.quietEnabled !== undefined) updates.quietEnabled = body.quietEnabled;
      if (body.quietStart !== undefined) updates.quietStart = body.quietStart;
      if (body.quietEnd !== undefined) updates.quietEnd = body.quietEnd;
      if (body.urgentBreaksQuiet !== undefined) updates.urgentBreaksQuiet = body.urgentBreaksQuiet;
      if (body.pausedUntil !== undefined) {
        if (body.pausedUntil === null) {
          updates.pausedUntil = null;
        } else {
          const d = new Date(body.pausedUntil);
          if (Number.isNaN(d.getTime())) {
            return status(400, { error: "Invalid pausedUntil datetime" });
          }
          updates.pausedUntil = d;
        }
      }
      if (body.hideContent !== undefined) updates.hideContent = body.hideContent;
      if (body.digestDailyEnabled !== undefined) updates.digestDailyEnabled = body.digestDailyEnabled;
      if (body.digestTime !== undefined) updates.digestTime = body.digestTime;
      if (body.weeklyEnabled !== undefined) updates.weeklyEnabled = body.weeklyEnabled;
      if (body.weeklyDay !== undefined) updates.weeklyDay = body.weeklyDay;
      if (body.weeklyTime !== undefined) updates.weeklyTime = body.weeklyTime;

      await db
        .update(schema.notificationPrefs)
        .set(updates)
        .where(eq(schema.notificationPrefs.userId, user.id));
      return toDTO(await ensurePrefs(user.id));
    },
    { auth: true, body: PrefsBody }
  )
  .put(
    "/api/v1/lists/:id/notification-rule",
    async ({ user, params: { id }, body, status }) => {
      const [list] = await db
        .select({ id: schema.lists.id })
        .from(schema.lists)
        .where(
          and(
            eq(schema.lists.id, id),
            eq(schema.lists.userId, user.id),
            isNull(schema.lists.deletedAt)
          )
        );
      if (!list) {
        return status(404, { error: "List not found" });
      }
      await db
        .insert(schema.listNotificationRules)
        .values({ userId: user.id, listId: id, mode: body.mode })
        .onConflictDoUpdate({
          target: [schema.listNotificationRules.userId, schema.listNotificationRules.listId],
          set: { mode: body.mode, updatedAt: new Date() },
        });
      return { userId: user.id, listId: id, mode: body.mode };
    },
    {
      auth: true,
      params: t.Object({ id: t.String() }),
      body: t.Object({ mode: t.Union([t.Literal("all"), t.Literal("silent"), t.Literal("off")]) }),
    }
  )
  .post(
    "/api/v1/notifications/pause",
    async ({ user, body, status }) => {
      const until = new Date(body.until);
      if (Number.isNaN(until.getTime())) {
        return status(400, { error: "Invalid until datetime" });
      }
      if (until.getTime() <= Date.now()) {
        return status(400, { error: "until must be in the future" });
      }
      const prefs = await ensurePrefs(user.id);
      await db
        .update(schema.notificationPrefs)
        .set({ pausedUntil: until, updatedAt: new Date() })
        .where(eq(schema.notificationPrefs.userId, user.id));
      return toDTO({ ...prefs, pausedUntil: until });
    },
    {
      auth: true,
      body: t.Object({ until: t.String({ format: "date-time" }) }),
    }
  )
  .delete("/api/v1/notifications/pause", async ({ user }) => {
    const prefs = await ensurePrefs(user.id);
    await db
      .update(schema.notificationPrefs)
      .set({ pausedUntil: null, updatedAt: new Date() })
      .where(eq(schema.notificationPrefs.userId, user.id));
    return toDTO({ ...prefs, pausedUntil: null });
  }, { auth: true });
