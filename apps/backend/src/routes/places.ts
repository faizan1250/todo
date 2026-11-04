import { Elysia, t } from "elysia";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";
import { authMacro } from "../plugins/auth-macro";
import { validateLocationCoords } from "../utils/dates";

export const placeRoutes = new Elysia({ prefix: "/api/v1/places" })
  .use(authMacro)
  // GET /api/v1/places - list user's saved places
  .get(
    "/",
    async ({ user }) => {
      const userPlaces = await db
        .select()
        .from(schema.places)
        .where(
          and(
            eq(schema.places.userId, user.id),
            isNull(schema.places.deletedAt)
          )
        )
        .orderBy(asc(schema.places.name));

      return userPlaces;
    },
    {
      auth: true,
    }
  )
  // POST /api/v1/places - create a saved place
  .post(
    "/",
    async ({ user, body, status }) => {
      const trimmedName = body.name.trim();
      if (!trimmedName) {
        return status(400, { error: "Name cannot be empty" });
      }

      const locValidation = validateLocationCoords(body.lat, body.lng, body.radiusM);
      if (!locValidation.valid) {
        return status(400, { error: locValidation.error });
      }

      const radiusM = body.radiusM ?? 200;
      const now = new Date();

      const [newPlace] = await db
        .insert(schema.places)
        .values({
          userId: user.id,
          name: trimmedName,
          lat: body.lat,
          lng: body.lng,
          radiusM,
          version: 1,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      return status(201, newPlace);
    },
    {
      auth: true,
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        lat: t.Number(),
        lng: t.Number(),
        radiusM: t.Optional(t.Integer({ minimum: 50, maximum: 5000 })),
      }),
    }
  )
  // PATCH /api/v1/places/:id - update a saved place
  .patch(
    "/:id",
    async ({ user, params: { id }, body, status }) => {
      const [existing] = await db
        .select()
        .from(schema.places)
        .where(
          and(
            eq(schema.places.id, id),
            eq(schema.places.userId, user.id),
            isNull(schema.places.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Place not found" });
      }

      let nextName = existing.name;
      if (body.name !== undefined) {
        const trimmed = body.name.trim();
        if (!trimmed) {
          return status(400, { error: "Name cannot be empty" });
        }
        nextName = trimmed;
      }

      const nextLat = body.lat !== undefined ? body.lat : existing.lat;
      const nextLng = body.lng !== undefined ? body.lng : existing.lng;
      const nextRadiusM = body.radiusM !== undefined ? body.radiusM : existing.radiusM;

      const locValidation = validateLocationCoords(nextLat, nextLng, nextRadiusM);
      if (!locValidation.valid) {
        return status(400, { error: locValidation.error });
      }

      const now = new Date();

      const [updated] = await db
        .update(schema.places)
        .set({
          name: nextName,
          lat: nextLat,
          lng: nextLng,
          radiusM: nextRadiusM,
          version: sql`${schema.places.version} + 1`,
          updatedAt: now,
        })
        .where(eq(schema.places.id, id))
        .returning();

      return updated;
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        lat: t.Optional(t.Number()),
        lng: t.Optional(t.Number()),
        radiusM: t.Optional(t.Integer({ minimum: 50, maximum: 5000 })),
      }),
    }
  )
  // DELETE /api/v1/places/:id - soft delete a saved place
  .delete(
    "/:id",
    async ({ user, params: { id }, status }) => {
      const [existing] = await db
        .select()
        .from(schema.places)
        .where(
          and(
            eq(schema.places.id, id),
            eq(schema.places.userId, user.id),
            isNull(schema.places.deletedAt)
          )
        );

      if (!existing) {
        return status(404, { error: "Place not found" });
      }

      const now = new Date();
      await db
        .update(schema.places)
        .set({
          deletedAt: now,
          updatedAt: now,
          version: sql`${schema.places.version} + 1`,
        })
        .where(eq(schema.places.id, id));

      return { success: true };
    },
    {
      auth: true,
      params: t.Object({
        id: t.String(),
      }),
    }
  );
