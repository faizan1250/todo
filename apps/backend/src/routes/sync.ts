import { Elysia, t } from "elysia";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";

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

      return {
        cursor: `${epoch}:${seq}`,
        hasMore: false,
        serverTime: Date.now(),
        changes: {},
      };
    },
    {
      auth: true,
      query: t.Object({
        cursor: t.String({ default: "" }),
        limit: t.Number({ default: 500 }),
      }),
    }
  );