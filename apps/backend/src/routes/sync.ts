import { Elysia, t } from "elysia";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
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

      let epoch: string;
      let seq: number;

      if (cursor === "") {
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

      if (
        epoch !== syncState.epoch ||
        seq < syncState.minValidSeq ||
        seq > syncState.seq
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
  );