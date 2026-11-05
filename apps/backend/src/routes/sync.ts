import { Elysia, t } from "elysia";
import { and, asc, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { processMutations } from "../utils/sync-mutations";

export const syncRoutes = new Elysia({ prefix: "/api/v1/sync" })
  .use(authMacro)
  .get(
    "/",
    async ({ user, query, request, status }) => {
      const syncState = db.select().from(schema.syncState).get();

      if (!syncState) {
        return status(500);
      }

      const cursor = query.cursor ?? "";
      const isFirstSync = cursor === "";

      let epoch: string;
      let seq: number;

      if (isFirstSync) {
        epoch = syncState.epoch;
        seq = 0;
      } else {
        const parts = cursor.split(":");
        if (parts.length !== 2) {
          return status(409, { resync: true });
        }
        const [parsedEpoch, parsedSeq] = parts;
        const parsedNumber = Number(parsedSeq);
        if (!parsedEpoch || !Number.isInteger(parsedNumber)) {
          return status(409, { resync: true });
        }
        epoch = parsedEpoch;
        seq = parsedNumber;
      }

      const clientVersion = request.headers.get("x-client-version");
      if (
        clientVersion &&
        syncState.minClientVersion &&
        clientVersion < syncState.minClientVersion
      ) {
        return status(426, { error: "Please refresh to get the latest update." });
      }

      // First sync (no cursor) is itself a full sync: start from seq 0 and
      // skip staleness checks. Only enforce the epoch check when the
      // client actually sent an epoch.
      if (
        epoch !== syncState.epoch ||
        (!isFirstSync &&
          (seq < syncState.minValidSeq || seq > syncState.seq))
      ) {
        return status(409, { resync: true });
      }

      const deviceId = request.headers.get("x-device-id");
      if (deviceId) {
        await db
          .update(schema.devices)
          .set({ lastSyncSeq: seq, lastSyncAt: new Date() })
          .where(
            and(
              eq(schema.devices.id, deviceId),
              eq(schema.devices.userId, user.id)
            )
          );
      }

      const limit = query.limit ?? 500;

      const entities: { entity: string; table: any; isUser: boolean }[] = [
        { entity: "folders", table: schema.folders, isUser: false },
        { entity: "lists", table: schema.lists, isUser: false },
        { entity: "sections", table: schema.sections, isUser: false },
        { entity: "tasks", table: schema.tasks, isUser: false },
        { entity: "checklistItems", table: schema.checklistItems, isUser: false },
        { entity: "tags", table: schema.tags, isUser: false },
        { entity: "templates", table: schema.templates, isUser: false },
        { entity: "reminders", table: schema.reminders, isUser: false },
        { entity: "recurrences", table: schema.recurrences, isUser: false },
        { entity: "places", table: schema.places, isUser: false },
        { entity: "savedFilters", table: schema.savedFilters, isUser: false },
        { entity: "timeBlocks", table: schema.timeBlocks, isUser: false },
        { entity: "user", table: schema.users, isUser: true },
      ];

      const result = await db.transaction(async (tx) => {
        type Collected = { entity: string; row: any; seq: number };
        const collected: Collected[] = [];

        for (const e of entities) {
          const table = e.table;
          const conditions: any[] = [];
          if (e.isUser) {
            conditions.push(eq(table.id, user.id));
          } else {
            conditions.push(eq(table.userId, user.id));
          }
          conditions.push(gt(table.seq, seq));
          if (seq === 0 && table?.deletedAt) {
            conditions.push(isNull(table.deletedAt));
          }
          const rows = await tx
            .select()
            .from(table)
            .where(and(...conditions))
            .orderBy(asc(table.seq))
            .limit(501);
          for (const row of rows) {
            collected.push({ entity: e.entity, row, seq: row.seq });
          }
        }

        collected.sort((a, b) => a.seq - b.seq);
        const taken = collected.slice(0, limit);
        const hasMore = collected.length > limit;

        const changes: Record<string, any[]> = {};
        for (const item of taken) {
          if (!changes[item.entity]) changes[item.entity] = [];
          changes[item.entity].push(item.row);
        }

        // embed tagIds for tasks
        const taskRows = changes.tasks;
        if (taskRows && taskRows.length) {
          const taskIds = taskRows.map((r: any) => r.id);
          const tagRows = await tx
            .select()
            .from(schema.taskTags)
            .where(inArray(schema.taskTags.taskId, taskIds));
          const map: Record<string, string[]> = {};
          for (const tr of tagRows) {
            if (!map[tr.taskId]) map[tr.taskId] = [];
            map[tr.taskId].push(tr.tagId);
          }
          for (const row of taskRows) {
            row.tagIds = map[row.id] ?? [];
          }
        }

        const newCursorSeq = taken.length
          ? taken[taken.length - 1].seq
          : seq;

        return { hasMore, changes, newCursorSeq };
      });

      return {
        cursor: `${epoch}:${result.newCursorSeq}`,
        hasMore: result.hasMore,
        serverTime: Date.now(),
        changes: result.changes,
      };
    },
    {
      auth: true,
      query: t.Object({
        cursor: t.String({ default: "" }),
        limit: t.Number({ default: 500 }),
      }),
    }
  )
  .post(
    "/push",
    async ({ user, body, request }) => {
      const deviceId =
        request.headers.get("x-device-id") ?? body.deviceId ?? null;
      const results = await processMutations(
        user.id,
        deviceId,
        body.mutations
      );
      return { results };
    },
    {
      auth: true,
      body: t.Object({
        deviceId: t.Optional(t.String()),
        mutations: t.Array(t.Any(), { maxItems: 100 }),
      }),
    }
  )
  .get(
    "/conflicts",
    async ({ user, query }) => {
      const rawLimit = Number(query.limit ?? 50);
      const limit = Math.min(
        Math.max(Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 50, 1),
        200
      );
      const rawOffset = Number(query.cursor ?? 0);
      const offset =
        Number.isFinite(rawOffset) && rawOffset > 0
          ? Math.floor(rawOffset)
          : 0;

      const rows = await db
        .select()
        .from(schema.syncConflicts)
        .where(eq(schema.syncConflicts.userId, user.id))
        .orderBy(
          desc(schema.syncConflicts.at),
          desc(schema.syncConflicts.id)
        )
        .limit(limit + 1)
        .offset(offset);

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      // Batch-resolve task titles (single query, own tasks only).
      const taskIds = [
        ...new Set(
          page.filter((r) => r.entity === "tasks").map((r) => r.entityId)
        ),
      ];
      const titleById = new Map<string, string>();
      if (taskIds.length > 0) {
        const taskRows = await db
          .select({ id: schema.tasks.id, title: schema.tasks.title })
          .from(schema.tasks)
          .where(
            and(
              inArray(schema.tasks.id, taskIds),
              eq(schema.tasks.userId, user.id),
              isNull(schema.tasks.deletedAt)
            )
          );
        for (const tr of taskRows) titleById.set(tr.id, tr.title);
      }

      const conflicts = page.map((r) => ({
        id: r.id,
        entity: r.entity,
        entityId: r.entityId,
        field: r.field,
        losingValue: r.losingValue,
        winningValue: r.winningValue,
        at: r.at ? r.at.getTime() : null,
        taskTitle:
          r.entity === "tasks" ? (titleById.get(r.entityId) ?? null) : null,
      }));

      return {
        conflicts,
        nextCursor: hasMore ? String(offset + limit) : null,
        hasMore,
      };
    },
    {
      auth: true,
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Number()),
      }),
    }
  )
  .get(
    "/devices",
    async ({ user }) => {
      const rows = await db
        .select({
          id: schema.devices.id,
          name: schema.devices.name,
          platform: schema.devices.platform,
          lastSeenAt: schema.devices.lastSeenAt,
          lastSyncAt: schema.devices.lastSyncAt,
        })
        .from(schema.devices)
        .where(eq(schema.devices.userId, user.id))
        .orderBy(desc(schema.devices.createdAt), desc(schema.devices.id));

      return {
        devices: rows.map((r) => ({
          id: r.id,
          name: r.name,
          platform: r.platform,
          lastSeenAt: r.lastSeenAt ? r.lastSeenAt.getTime() : null,
          lastSyncAt: r.lastSyncAt ? r.lastSyncAt.getTime() : null,
        })),
      };
    },
    { auth: true }
  )
  .post(
    "/devices",
    async ({ user, body, status }) => {
      const platform = body.platform ?? "web";
      const now = new Date();

      const toDTO = (r: {
        id: string;
        name: string | null;
        platform: "web" | "ios" | "android";
        lastSeenAt: Date | null;
        lastSyncAt: Date | null;
      }) => ({
        id: r.id,
        name: r.name,
        platform: r.platform,
        lastSeenAt: r.lastSeenAt ? r.lastSeenAt.getTime() : null,
        lastSyncAt: r.lastSyncAt ? r.lastSyncAt.getTime() : null,
      });

      const lookup = async () => {
        const rows = await db
          .select({
            id: schema.devices.id,
            userId: schema.devices.userId,
          })
          .from(schema.devices)
          .where(eq(schema.devices.id, body.deviceId));
        return rows[0];
      };

      const existing = await lookup();
      if (existing && existing.userId !== user.id) {
        return status(403, { error: "Forbidden" });
      }

      if (existing) {
        await db
          .update(schema.devices)
          .set({ name: body.name, platform, lastSeenAt: now })
          .where(
            and(
              eq(schema.devices.id, body.deviceId),
              eq(schema.devices.userId, user.id)
            )
          );
      } else {
        try {
          await db.insert(schema.devices).values({
            id: body.deviceId,
            userId: user.id,
            name: body.name,
            platform,
            lastSeenAt: now,
          });
        } catch {
          // Lost an insert race: re-check ownership instead of leaking.
          const raced = await lookup();
          if (!raced || raced.userId !== user.id) {
            return status(403, { error: "Forbidden" });
          }
          await db
            .update(schema.devices)
            .set({ name: body.name, platform, lastSeenAt: now })
            .where(
              and(
                eq(schema.devices.id, body.deviceId),
                eq(schema.devices.userId, user.id)
              )
            );
        }
      }

      const rows = await db
        .select({
          id: schema.devices.id,
          name: schema.devices.name,
          platform: schema.devices.platform,
          lastSeenAt: schema.devices.lastSeenAt,
          lastSyncAt: schema.devices.lastSyncAt,
        })
        .from(schema.devices)
        .where(
          and(
            eq(schema.devices.id, body.deviceId),
            eq(schema.devices.userId, user.id)
          )
        );
      const row = rows[0];
      if (!row) {
        return status(403, { error: "Forbidden" });
      }
      return toDTO(row);
    },
    {
      auth: true,
      body: t.Object({
        deviceId: t.String({ minLength: 1, maxLength: 128 }),
        name: t.String({ minLength: 1, maxLength: 64 }),
        platform: t.Optional(
          t.Union([t.Literal("web"), t.Literal("ios"), t.Literal("android")])
        ),
      }),
    }
  );