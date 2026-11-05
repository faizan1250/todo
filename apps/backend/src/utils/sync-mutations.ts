import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";
import { validateSubtaskHierarchy, getTaskDescendants } from "./tasks";
import { spawnNextRecurrenceInstance, validateRecurrenceRule } from "../services/recurrence";
import { validateLocationCoords } from "../utils/dates";
import { validateFilterDsl } from "../utils/filter-dsl";
import { validateTemplatePayload } from "../routes/templates";
import { runCompleteHooks } from "./tasks";
import { positionBetween } from "./position";

export type MutationStatus = 'applied' | 'duplicate' | 'rejected' | 'ignored';

export interface MutationResult {
  id: string;
  status: MutationStatus;
  version?: number;
  seq?: number;
  reason?: string;
}

export interface Mutation {
  id: string;
  entity: string;
  op: string;
  entityId: string;
  patch?: any;
  editedAt: number;
  schemaVersion?: number;
}

const TASK_FIELDS: Record<string, string> = {
  title: "title",
  notes: "notes",
  status: "status",
  priority: "priority",
  position: "position",
  start_at: "startAt",
  startAt: "startAt",
  due_at: "dueAt",
  dueAt: "dueAt",
  deadline_at: "deadlineAt",
  deadlineAt: "deadlineAt",
  all_day: "allDay",
  allDay: "allDay",
  estimate_min: "estimateMin",
  estimateMin: "estimateMin",
  list_id: "listId",
  listId: "listId",
  section_id: "sectionId",
  sectionId: "sectionId",
  parent_id: "parentId",
  parentId: "parentId",
  recurrence_id: "recurrenceId",
  recurrenceId: "recurrenceId",
  place_id: "placeId",
  placeId: "placeId",
  location_name: "locationName",
  locationName: "locationName",
  lat: "lat",
  lng: "lng",
  radius_m: "radiusM",
  radiusM: "radiusM",
  location_trigger: "locationTrigger",
  locationTrigger: "locationTrigger",
  archived_at: "archivedAt",
  archivedAt: "archivedAt",
};

const SERVER_OWNED = new Set([
  "id", "user_id", "userId", "created_at", "createdAt", "updated_at", "updatedAt",
  "version", "seq", "field_ts", "fieldTs", "deleted_at", "deletedAt",
  "completed_at", "completedAt", "completed_count", "completedCount",
]);

const DATE_FIELDS = new Set(["startAt", "dueAt", "deadlineAt", "archivedAt", "completedAt"]);

function parseDateVal(val: any): any {
  if (val === undefined) return undefined;
  if (val === null || val === "") return null;
  if (val instanceof Date) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d;
}

function normalizePatch(patch: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!patch || typeof patch !== "object") return out;
  for (const k of Object.keys(patch)) {
    if (SERVER_OWNED.has(k)) continue;
    const canonical = TASK_FIELDS[k];
    if (canonical) {
      out[canonical] = patch[k];
    }
  }
  return out;
}

function clampEditedAt(editedAt: number): number {
  const now = Date.now();
  const max = now + 5 * 60 * 1000;
  return Math.min(editedAt ?? now, max);
}

function applyDateFields(obj: Record<string, any>) {
  for (const f of DATE_FIELDS) {
    if (f in obj) obj[f] = parseDateVal(obj[f]);
  }
}

function readSeq(tx: any, id: string): number | undefined {
  const row = tx.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  return row?.seq;
}

function readVersion(tx: any, id: string): number | undefined {
  const row = tx.select().from(schema.tasks).where(eq(schema.tasks.id, id)).get();
  return row?.version;
}

function readRow(tx: any, table: any, id: string): any {
  return tx.select().from(table).where(eq(table.id, id)).get();
}

function readSeqGeneric(tx: any, table: any, id: string): number | undefined {
  const row = tx.select().from(table).where(eq(table.id, id)).get();
  return row?.seq;
}
function readVersionGeneric(tx: any, table: any, id: string): number | undefined {
  const row = tx.select().from(table).where(eq(table.id, id)).get();
  return row?.version;
}

const ENTITY_TABLE: Record<string, any> = {
  templates: schema.templates,
  reminders: schema.reminders,
  recurrences: schema.recurrences,
  places: schema.places,
  savedFilters: schema.savedFilters,
  timeBlocks: schema.timeBlocks,
  user: schema.users,
};

const FIELD_MAP: Record<string, Record<string, string>> = {
  templates: { name: "name", payload: "payload" },
  reminders: { taskId: "taskId", task_id: "taskId", kind: "kind", relativeTo: "relativeTo", relative_to: "relativeTo", offsetMin: "offsetMin", offset_min: "offsetMin", remindAt: "remindAt", remind_at: "remindAt", firedAt: "firedAt", fired_at: "firedAt" },
  recurrences: { rrule: "rrule", mode: "mode", timezone: "timezone", dtstart: "dtstart", until: "until", maxCount: "maxCount", max_count: "maxCount", completedCount: "completedCount", completed_count: "completedCount", active: "active" },
  places: { name: "name", lat: "lat", lng: "lng", radiusM: "radiusM", radius_m: "radiusM" },
  savedFilters: { name: "name", icon: "icon", color: "color", query: "query", sort: "sort", groupBy: "groupBy", group_by: "groupBy", position: "position", pinned: "pinned" },
  timeBlocks: { taskId: "taskId", task_id: "taskId", title: "title", startAt: "startAt", start_at: "startAt", endAt: "endAt", end_at: "endAt", color: "color" },
  user: { name: "name", timezone: "timezone", locale: "locale", weekStartsOn: "weekStartsOn", week_starts_on: "weekStartsOn", preferences: "preferences", image: "image" },
};

const DATE_FIELDS_BY_ENTITY: Record<string, Set<string>> = {
  templates: new Set([]),
  reminders: new Set(["remindAt", "firedAt"]),
  recurrences: new Set(["dtstart", "until"]),
  places: new Set([]),
  savedFilters: new Set([]),
  timeBlocks: new Set(["startAt", "endAt"]),
  user: new Set([]),
};

async function applySimpleMutation(tx: any, userId: string, m: Mutation, entity: string, now: Date, editedAt: number): Promise<MutationResult> {
  const table = ENTITY_TABLE[entity];
  const fieldMap = FIELD_MAP[entity];
  const dateFields = DATE_FIELDS_BY_ENTITY[entity];

  const isUser = entity === "user";
  const idField = isUser ? "id" : "id";

  switch (m.op) {
    case "create": {
      const existing = tx.select().from(table).where(eq(table.id, m.entityId)).get();
      if (existing) {
        if (!isUser && existing.userId !== userId) return { id: m.id, status: "rejected", reason: "not_found" };
        if (isUser && m.entityId !== userId) return { id: m.id, status: "rejected", reason: "not_found" };
        return { id: m.id, status: "rejected", reason: "id_taken" };
      }

      const patch = m.patch ?? {};
      // map fields
      const values: Record<string, any> = {};
      if (!isUser) values.userId = userId;
      if (isUser) values.id = userId; else values.id = m.entityId;

      // validation + mapping
      for (const k of Object.keys(patch)) {
        if (k in fieldMap === false) continue;
        const canon = fieldMap[k];
        values[canon] = patch[k];
      }
      // date parse
      for (const f of dateFields) {
        if (f in values) values[f] = parseDateVal(values[f]);
      }

      // entity-specific validation
      if (entity === "templates") {
        const name = (values.name ?? "").trim?.() ?? values.name;
        if (!name) return { id: m.id, status: "rejected", reason: "invalid_name" };
        values.name = name;
        if (!values.payload) return { id: m.id, status: "rejected", reason: "invalid_payload" };
        const v = validateTemplatePayload(values.payload);
        if (!v.valid) return { id: m.id, status: "rejected", reason: v.error ?? "invalid_payload" };
      }
      if (entity === "places") {
        const name = (values.name ?? "").trim?.();
        if (!name) return { id: m.id, status: "rejected", reason: "invalid_name" };
        values.name = name;
        const loc = validateLocationCoords(values.lat, values.lng, values.radiusM ?? 200);
        if (!loc.valid) return { id: m.id, status: "rejected", reason: loc.error ?? "invalid_location" };
        if (values.radiusM === undefined) values.radiusM = 200;
      }
      if (entity === "reminders") {
        if (!values.taskId) return { id: m.id, status: "rejected", reason: "task_required" };
        const task = tx.select().from(schema.tasks).where(and(eq(schema.tasks.id, values.taskId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt))).get();
        if (!task) return { id: m.id, status: "rejected", reason: "not_found" };
        if (!values.kind) return { id: m.id, status: "rejected", reason: "invalid_kind" };
        if (values.remindAt === undefined) return { id: m.id, status: "rejected", reason: "remindAt_required" };
        values.remindAt = parseDateVal(values.remindAt);
      }
      if (entity === "recurrences") {
        if (!values.rrule) return { id: m.id, status: "rejected", reason: "rrule_required" };
        const mode = values.mode ?? "fixed";
        const maxCount = values.maxCount ?? null;
        const v = validateRecurrenceRule(values.rrule, mode, maxCount);
        if (!v.valid) return { id: m.id, status: "rejected", reason: v.error ?? "invalid_rrule" };
        if (!values.timezone) values.timezone = "UTC";
        if (values.dtstart === undefined) values.dtstart = new Date();
        else values.dtstart = parseDateVal(values.dtstart);
        if (values.until !== undefined) values.until = parseDateVal(values.until);
        if (values.active === undefined) values.active = true;
        if (values.completedCount === undefined) values.completedCount = 0;
      }
      if (entity === "savedFilters") {
        const name = (values.name ?? "").trim?.();
        if (!name) return { id: m.id, status: "rejected", reason: "invalid_name" };
        values.name = name;
        if (values.query !== undefined) {
          const dsl = validateFilterDsl(values.query);
          if (!dsl.valid) return { id: m.id, status: "rejected", reason: "invalid_query" };
        } else {
          return { id: m.id, status: "rejected", reason: "query_required" };
        }
        if (values.position === undefined) {
          // default position at end
          values.position = await positionBetween({ table, where: and(eq(table.userId, userId), isNull(table.deletedAt)) });
        }
        if (values.pinned === undefined) values.pinned = false;
      }
      if (entity === "timeBlocks") {
        if (!values.startAt || !values.endAt) return { id: m.id, status: "rejected", reason: "time_required" };
        values.startAt = parseDateVal(values.startAt);
        values.endAt = parseDateVal(values.endAt);
        if (!(values.endAt > values.startAt)) return { id: m.id, status: "rejected", reason: "invalid_time" };
      }
      if (entity === "user") {
        // only update allowed; create not applicable
        return { id: m.id, status: "rejected", reason: "unsupported_op" };
      }

      values.version = 1;
      values.createdAt = now;
      values.updatedAt = now;
      values.deletedAt = null;
      if (table === schema.savedFilters) {}
      // fieldTs
      const fieldTs: Record<string, number> = {};
      for (const k of Object.keys(patch)) {
        const canon = fieldMap[k];
        if (canon) fieldTs[canon] = editedAt;
      }
      if (!isUser) values.fieldTs = fieldTs;

      tx.insert(table).values(values).run();

      const version = readVersionGeneric(tx, table, m.entityId)!;
      const seq = readSeqGeneric(tx, table, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "update": {
      let existing;
      if (isUser) {
        existing = tx.select().from(table).where(eq(table.id, userId)).get();
        if (!existing || m.entityId !== userId) {
          // not found
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
      } else {
        existing = tx.select().from(table).where(and(eq(table.id, m.entityId), eq(table.userId, userId), isNull(table.deletedAt))).get();
        if (!existing) {
          const anyRow = tx.select().from(table).where(eq(table.id, m.entityId)).get();
          if (anyRow && anyRow.userId !== userId) return { id: m.id, status: "rejected", reason: "not_found" };
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
      }

      const patch = m.patch ?? {};
      const updates: Record<string, any> = {};
      const newFieldTs = { ...(existing.fieldTs ?? {}) };

      for (const k of Object.keys(patch)) {
        if (!(k in fieldMap)) continue;
        const canon = fieldMap[k];
        // LWW
        const ts = existing.fieldTs?.[canon] ?? 0;
        if (ts > editedAt) continue;
        updates[canon] = patch[k];
        newFieldTs[canon] = editedAt;
      }

      // date parse
      for (const f of dateFields) {
        if (f in updates) updates[f] = parseDateVal(updates[f]);
      }

      // validation for specific fields
      if (entity === "templates" && updates.name !== undefined) {
        const nm = String(updates.name).trim();
        if (!nm) return { id: m.id, status: "rejected", reason: "invalid_name" };
        updates.name = nm;
      }
      if (entity === "templates" && updates.payload !== undefined) {
        const v = validateTemplatePayload(updates.payload);
        if (!v.valid) return { id: m.id, status: "rejected", reason: v.error ?? "invalid_payload" };
      }
      if (entity === "places") {
        const nextLat = updates.lat !== undefined ? updates.lat : existing.lat;
        const nextLng = updates.lng !== undefined ? updates.lng : existing.lng;
        const nextRadius = updates.radiusM !== undefined ? updates.radiusM : existing.radiusM;
        const loc = validateLocationCoords(nextLat, nextLng, nextRadius);
        if (!loc.valid) return { id: m.id, status: "rejected", reason: loc.error ?? "invalid_location" };
        if (updates.name !== undefined) {
          const nm = String(updates.name).trim();
          if (!nm) return { id: m.id, status: "rejected", reason: "invalid_name" };
          updates.name = nm;
        }
      }
      if (entity === "reminders") {
        if (updates.taskId !== undefined) {
          const task = tx.select().from(schema.tasks).where(and(eq(schema.tasks.id, updates.taskId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt))).get();
          if (!task) return { id: m.id, status: "rejected", reason: "not_found" };
        }
      }
      if (entity === "recurrences") {
        const nextRrule = updates.rrule ?? existing.rrule;
        const nextMode = updates.mode ?? existing.mode;
        const nextMaxCount = updates.maxCount !== undefined ? updates.maxCount : existing.maxCount;
        const v = validateRecurrenceRule(nextRrule, nextMode, nextMaxCount);
        if (!v.valid) return { id: m.id, status: "rejected", reason: v.error ?? "invalid_rrule" };
      }
      if (entity === "savedFilters") {
        if (updates.name !== undefined) {
          const nm = String(updates.name).trim();
          if (!nm) return { id: m.id, status: "rejected", reason: "invalid_name" };
          updates.name = nm;
        }
        if (updates.query !== undefined) {
          const dsl = validateFilterDsl(updates.query);
          if (!dsl.valid) return { id: m.id, status: "rejected", reason: "invalid_query" };
        }
      }
      if (entity === "timeBlocks") {
        const nextStart = updates.startAt !== undefined ? updates.startAt : existing.startAt;
        const nextEnd = updates.endAt !== undefined ? updates.endAt : existing.endAt;
        const s = parseDateVal(nextStart);
        const e = parseDateVal(nextEnd);
        if (!(e > s)) return { id: m.id, status: "rejected", reason: "invalid_time" };
      }

      if (Object.keys(updates).length === 0) {
        // still bump? apply no-op but return current
      }

      updates.version = sql`${table.version} + 1`;
      updates.updatedAt = now;
      if (!isUser) updates.fieldTs = newFieldTs;
      if (isUser && "preferences" in updates) {
        // keep json
      }

      const where = isUser
        ? eq(table.id, userId)
        : and(eq(table.id, m.entityId), eq(table.userId, userId));

      tx.update(table).set(updates).where(where).run();

      const targetId = isUser ? userId : m.entityId;
      const version = readVersionGeneric(tx, table, targetId)!;
      const seq = readSeqGeneric(tx, table, targetId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "delete": {
      let existing;
      if (isUser) {
        return { id: m.id, status: "rejected", reason: "unsupported_op" };
      }
      existing = tx.select().from(table).where(and(eq(table.id, m.entityId), eq(table.userId, userId), isNull(table.deletedAt))).get();
      if (!existing) return { id: m.id, status: "rejected", reason: "not_found" };

      tx.update(table).set({ deletedAt: now, updatedAt: now, version: sql`${table.version} + 1` }).where(and(eq(table.id, m.entityId), eq(table.userId, userId))).run();

      const version = readVersionGeneric(tx, table, m.entityId)!;
      const seq = readSeqGeneric(tx, table, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "restore": {
      if (isUser) return { id: m.id, status: "rejected", reason: "unsupported_op" };
      const existing = tx.select().from(table).where(and(eq(table.id, m.entityId), eq(table.userId, userId), sql`${table.deletedAt} IS NOT NULL`)).get();
      if (!existing) return { id: m.id, status: "rejected", reason: "not_found" };

      tx.update(table).set({ deletedAt: null, updatedAt: now, version: sql`${table.version} + 1` }).where(and(eq(table.id, m.entityId), eq(table.userId, userId))).run();

      const version = readVersionGeneric(tx, table, m.entityId)!;
      const seq = readSeqGeneric(tx, table, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "move": {
      if (entity !== "savedFilters") return { id: m.id, status: "rejected", reason: "unsupported_op" };
      const existing = tx.select().from(table).where(and(eq(table.id, m.entityId), eq(table.userId, userId), isNull(table.deletedAt))).get();
      if (!existing) return { id: m.id, status: "rejected", reason: "not_found" };

      const patch = m.patch ?? {};
      let newPosition = patch.position ?? existing.position;
      if (patch.position === undefined && (patch.afterId !== undefined || patch.beforeId !== undefined)) {
        newPosition = await positionBetween(
          { table, where: and(eq(table.userId, userId), isNull(table.deletedAt)), excludeId: m.entityId },
          patch.afterId ?? null,
          patch.beforeId ?? null
        );
      }

      tx.update(table).set({ position: newPosition, updatedAt: now, version: sql`${table.version} + 1` }).where(and(eq(table.id, m.entityId), eq(table.userId, userId))).run();

      const version = readVersionGeneric(tx, table, m.entityId)!;
      const seq = readSeqGeneric(tx, table, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    default:
      return { id: m.id, status: "rejected", reason: "unknown_op" };
  }
}


function normalizeEntity(e: string): string {
  if (e === "saved_filters") return "savedFilters";
  if (e === "time_blocks") return "timeBlocks";
  return e;
}

const SIMPLE_ENTITIES = new Set([
  "templates",
  "reminders",
  "recurrences",
  "places",
  "savedFilters",
  "timeBlocks",
  "user",
]);

async function applyMutation(tx: any, userId: string, m: Mutation): Promise<MutationResult> {
  const entity = normalizeEntity(m.entity);
  const now = new Date();
  const editedAt = clampEditedAt(m.editedAt);

  if (entity !== "tasks" && !SIMPLE_ENTITIES.has(entity)) {
    return { id: m.id, status: "rejected", reason: "unsupported_entity" };
  }

  if (entity !== "tasks") {
    return await applySimpleMutation(tx, userId, m, entity, now, editedAt);
  }

  switch (m.op) {
    case "create": {
      const patch = normalizePatch(m.patch ?? {});
      applyDateFields(patch);

      // existing id checks
      const existing = tx
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.id, m.entityId))
        .get();
      if (existing) {
        if (existing.userId !== userId) {
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
        return { id: m.id, status: "rejected", reason: "id_taken" };
      }

      // resolve parent/list
      let parentId = patch.parentId ?? null;
      let listId = patch.listId ?? null;
      if (parentId) {
        const parent = tx
          .select()
          .from(schema.tasks)
          .where(and(eq(schema.tasks.id, parentId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt)))
          .get();
        if (!parent) {
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
        listId = parent.listId;
        const v = validateSubtaskHierarchy(userId, null, parentId);
        if (!v.valid) {
          return { id: m.id, status: "rejected", reason: v.error ?? "invalid_hierarchy" };
        }
      } else {
        if (!listId) {
          return { id: m.id, status: "rejected", reason: "list_required" };
        }
        const list = tx
          .select()
          .from(schema.lists)
          .where(and(eq(schema.lists.id, listId), eq(schema.lists.userId, userId), isNull(schema.lists.deletedAt)))
          .get();
        if (!list) {
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
      }

      // section validation
      let sectionId = patch.sectionId ?? null;
      if (sectionId) {
        const sec = tx
          .select()
          .from(schema.sections)
          .where(and(eq(schema.sections.id, sectionId), eq(schema.sections.userId, userId), eq(schema.sections.listId, listId), isNull(schema.sections.deletedAt)))
          .get();
        if (!sec) {
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
      }

      // place validation
      let placeId = patch.placeId ?? null;
      if (placeId) {
        const place = tx
          .select()
          .from(schema.places)
          .where(and(eq(schema.places.id, placeId), eq(schema.places.userId, userId), isNull(schema.places.deletedAt)))
          .get();
        if (!place) {
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
      }

      const title = (patch.title ?? "").trim();
      if (!title) {
        return { id: m.id, status: "rejected", reason: "invalid_title" };
      }

      // position
      let position = patch.position;
      if (!position) {
        const scopeConditions = [
          eq(schema.tasks.userId, userId),
          eq(schema.tasks.listId, listId),
          isNull(schema.tasks.deletedAt),
        ];
        if (parentId) scopeConditions.push(eq(schema.tasks.parentId, parentId));
        else scopeConditions.push(isNull(schema.tasks.parentId));
        if (sectionId) scopeConditions.push(eq(schema.tasks.sectionId, sectionId));
        else scopeConditions.push(isNull(schema.tasks.sectionId));
        position = await positionBetween(
          { table: schema.tasks, where: and(...scopeConditions) },
          patch.afterId ?? null,
          patch.beforeId ?? null
        );
      }

      const status = patch.status ?? "todo";
      const allDay = patch.allDay ?? false;
      const fieldTs: Record<string, number> = {};
      for (const k of Object.keys(patch)) {
        const canon = TASK_FIELDS[k];
        if (canon && !SERVER_OWNED.has(canon)) fieldTs[canon] = editedAt;
      }

      tx.insert(schema.tasks)
        .values({
          id: m.entityId,
          userId,
          listId,
          sectionId,
          parentId,
          title,
          notes: patch.notes ?? null,
          priority: patch.priority ?? 0,
          status,
          position,
          startAt: patch.startAt ?? null,
          dueAt: patch.dueAt ?? null,
          deadlineAt: patch.deadlineAt ?? null,
          allDay,
          estimateMin: patch.estimateMin ?? null,
          placeId,
          locationName: patch.locationName ?? null,
          lat: patch.lat ?? null,
          lng: patch.lng ?? null,
          radiusM: patch.radiusM ?? (patch.lat ? 200 : null),
          locationTrigger: patch.locationTrigger ?? null,
          completedAt: status === "done" ? now : null,
          archivedAt: patch.archivedAt ?? null,
          recurrenceId: patch.recurrenceId ?? null,
          fieldTs,
          version: 1,
        })
        .run();

      const version = readVersion(tx, m.entityId)!;
      const seq = readSeq(tx, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "update": {
      const existing = tx
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt)))
        .get();
      if (!existing) {
        // could be another user's row
        const anyRow = tx.select().from(schema.tasks).where(eq(schema.tasks.id, m.entityId)).get();
        if (anyRow && anyRow.userId !== userId) {
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
        return { id: m.id, status: "rejected", reason: "not_found" };
      }

      const patch = normalizePatch(m.patch ?? {});
      applyDateFields(patch);

      const updates: Record<string, any> = {};
      const newFieldTs = { ...(existing.fieldTs ?? {}) };

      // list/parent handling
      let nextListId = existing.listId;
      let nextParentId = existing.parentId;
      let shouldUpdateDescendantList = false;

      if (patch.parentId !== undefined) {
        const targetParentId = patch.parentId ?? null;
        const v = validateSubtaskHierarchy(userId, m.entityId, targetParentId);
        if (!v.valid) {
          return { id: m.id, status: "rejected", reason: v.error ?? "invalid_hierarchy" };
        }
        // LWW check
        const fieldKey = "parentId";
        const ts = (existing.fieldTs?.[fieldKey] ?? existing.fieldTs?.parent_id ?? 0);
        if (ts <= editedAt) {
          nextParentId = targetParentId;
          if (targetParentId) {
            nextListId = v.parent!.listId;
            shouldUpdateDescendantList = nextListId !== existing.listId;
          }
          updates.parentId = nextParentId;
          updates.listId = nextListId;
          newFieldTs[fieldKey] = editedAt;
        }
      }

      if (patch.listId !== undefined && patch.listId !== existing.listId && !("parentId" in patch)) {
        // only if not parent-locked
        if (nextParentId) {
          // subtask locked
        } else {
          const targetList = tx
            .select()
            .from(schema.lists)
            .where(and(eq(schema.lists.id, patch.listId), eq(schema.lists.userId, userId), isNull(schema.lists.deletedAt)))
            .get();
          if (!targetList) {
            return { id: m.id, status: "rejected", reason: "not_found" };
          }
          const ts = (existing.fieldTs?.listId ?? existing.fieldTs?.list_id ?? 0);
          if (ts <= editedAt) {
            nextListId = patch.listId;
            shouldUpdateDescendantList = true;
            updates.listId = nextListId;
            newFieldTs.listId = editedAt;
          }
        }
      }

      // section
      if (patch.sectionId !== undefined) {
        const ts = (existing.fieldTs?.sectionId ?? existing.fieldTs?.section_id ?? 0);
        if (ts <= editedAt) {
          let val = patch.sectionId;
          if (val === null || val === "") val = null;
          else {
            const sec = tx
              .select()
              .from(schema.sections)
              .where(and(eq(schema.sections.id, val), eq(schema.sections.userId, userId), eq(schema.sections.listId, nextListId), isNull(schema.sections.deletedAt)))
              .get();
            if (!sec) {
              return { id: m.id, status: "rejected", reason: "not_found" };
            }
          }
          updates.sectionId = val;
          newFieldTs.sectionId = editedAt;
        }
      }

      // generic whitelisted fields
      const skip = new Set(["parentId", "listId", "sectionId", "afterId", "beforeId", "tagIds"]);
      for (const [canon, val] of Object.entries(patch)) {
        if (skip.has(canon)) continue;
        const ts = (existing.fieldTs?.[canon] ?? 0);
        if (ts > editedAt) continue;
        // validate place
        if (canon === "placeId" && val) {
          const place = tx.select().from(schema.places).where(and(eq(schema.places.id, val), eq(schema.places.userId, userId), isNull(schema.places.deletedAt))).get();
          if (!place) return { id: m.id, status: "rejected", reason: "not_found" };
        }
        updates[canon] = val;
        newFieldTs[canon] = editedAt;
      }

      // status/completedAt handling
      if (updates.status !== undefined) {
        if (updates.status === "done" && existing.status !== "done") {
          updates.completedAt = now;
        } else if (updates.status !== "done" && existing.status === "done") {
          updates.completedAt = null;
        }
      }
      if (patch.completedAt !== undefined) {
        // completedAt is server-owned-ish but allowed via complete; skip direct? Requirement strip completed_at. So ignore.
      }

      if (Object.keys(updates).length === 0 && !shouldUpdateDescendantList) {
        // still bump version? We'll bump to mark applied
      }

      // cascade descendant list
      if (shouldUpdateDescendantList) {
        const descendants = getTaskDescendants(m.entityId, userId);
        if (descendants.length > 0) {
          tx.update(schema.tasks)
            .set({ listId: nextListId, version: sql`${schema.tasks.version} + 1`, updatedAt: now })
            .where(and(inArray(schema.tasks.id, descendants.map((d) => d.id)), eq(schema.tasks.userId, userId)))
            .run();
        }
      }

      updates.version = sql`${schema.tasks.version} + 1`;
      updates.updatedAt = now;
      updates.fieldTs = newFieldTs;

      tx.update(schema.tasks)
        .set(updates)
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId)))
        .run();

      const version = readVersion(tx, m.entityId)!;
      const seq = readSeq(tx, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "delete": {
      const existing = tx
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt)))
        .get();
      if (!existing) {
        return { id: m.id, status: "rejected", reason: "not_found" };
      }
      const nowMs = now.getTime();
      sqlite.run(
        `WITH RECURSIVE sub(id) AS (
          SELECT id FROM tasks WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
          UNION ALL
          SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ?2 AND t.deleted_at IS NULL
        )
        UPDATE tasks
        SET deleted_at = ?3, updated_at = ?3, version = version + 1
        WHERE id IN (SELECT id FROM sub);`,
        [m.entityId, userId, nowMs]
      );
      if (existing.recurrenceId) {
        tx.update(schema.recurrences)
          .set({ active: false, version: sql`${schema.recurrences.version} + 1`, updatedAt: now })
          .where(and(eq(schema.recurrences.id, existing.recurrenceId), eq(schema.recurrences.userId, userId)))
          .run();
      }
      const version = readVersion(tx, m.entityId)!;
      const seq = readSeq(tx, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "restore": {
      const existing = tx
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId), sql`${schema.tasks.deletedAt} IS NOT NULL`))
        .get();
      if (!existing) {
        return { id: m.id, status: "rejected", reason: "not_found" };
      }

      let targetListId = existing.listId;
      let targetSectionId = existing.sectionId;
      let targetParentId = existing.parentId;

      const activeList = tx
        .select()
        .from(schema.lists)
        .where(and(eq(schema.lists.id, existing.listId), eq(schema.lists.userId, userId), isNull(schema.lists.deletedAt)))
        .get();

      if (!activeList) {
        const inbox = tx
          .select()
          .from(schema.lists)
          .where(and(eq(schema.lists.userId, userId), eq(schema.lists.isInbox, true), isNull(schema.lists.deletedAt)))
          .get();
        if (!inbox) {
          return { id: m.id, status: "rejected", reason: "not_found" };
        }
        targetListId = inbox.id;
        targetSectionId = null;
        targetParentId = null;
      } else {
        if (targetSectionId) {
          const activeSection = tx
            .select()
            .from(schema.sections)
            .where(and(eq(schema.sections.id, targetSectionId), eq(schema.sections.userId, userId), isNull(schema.sections.deletedAt)))
            .get();
          if (!activeSection) targetSectionId = null;
        }
        if (targetParentId) {
          const activeParent = tx
            .select()
            .from(schema.tasks)
            .where(and(eq(schema.tasks.id, targetParentId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt)))
            .get();
          if (!activeParent) targetParentId = null;
        }
      }

      const targetStamp = existing.deletedAt!.getTime();
      const nowMs = now.getTime();

      tx.update(schema.tasks)
        .set({
          deletedAt: null,
          version: sql`${schema.tasks.version} + 1`,
          updatedAt: now,
          listId: targetListId,
          sectionId: targetSectionId,
          parentId: targetParentId,
        })
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId)))
        .run();

      sqlite.run(
        `WITH RECURSIVE sub(id) AS (
          SELECT id FROM tasks WHERE parent_id = ?1 AND user_id = ?2
          UNION ALL
          SELECT t.id FROM tasks t JOIN sub ON t.parent_id = sub.id WHERE t.user_id = ?2
        )
        UPDATE tasks
        SET deleted_at = NULL, updated_at = ?3, version = version + 1, list_id = ?4
        WHERE id IN (SELECT id FROM sub) AND deleted_at = ?5;`,
        [m.entityId, userId, nowMs, targetListId, targetStamp]
      );

      const version = readVersion(tx, m.entityId)!;
      const seq = readSeq(tx, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "complete": {
      const existing = tx
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt)))
        .get();
      if (!existing) {
        return { id: m.id, status: "rejected", reason: "not_found" };
      }

      const completeSubtasks = Boolean(m.patch?.completeSubtasks);
      const completedAt = now;

      if (completeSubtasks) {
        const descendants = getTaskDescendants(m.entityId, userId);
        if (descendants.length > 0) {
          tx.update(schema.tasks)
            .set({ status: "done", completedAt, version: sql`${schema.tasks.version} + 1`, updatedAt: completedAt })
            .where(and(inArray(schema.tasks.id, descendants.map((d) => d.id)), eq(schema.tasks.userId, userId)))
            .run();
        }
      }

      const updated = tx
        .update(schema.tasks)
        .set({ status: "done", completedAt, version: sql`${schema.tasks.version} + 1`, updatedAt: completedAt })
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId)))
        .returning()
        .get();

      // fire recurrence hook
      try {
        await spawnNextRecurrenceInstance({ taskId: m.entityId, userId, isSkip: false, tx, now: completedAt });
      } catch (e) {
        // ignore
      }
      try {
        await runCompleteHooks(updated);
      } catch (e) {
        // ignore
      }

      const version = readVersion(tx, m.entityId)!;
      const seq = readSeq(tx, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    case "move": {
      const existing = tx
        .select()
        .from(schema.tasks)
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId), isNull(schema.tasks.deletedAt)))
        .get();
      if (!existing) {
        return { id: m.id, status: "rejected", reason: "not_found" };
      }

      const patch = m.patch ?? {};
      let nextListId = existing.listId;
      let nextParentId = existing.parentId;
      let nextSectionId = existing.sectionId;
      let shouldUpdateDescendantList = false;

      if (patch.parentId !== undefined) {
        const targetParentId = patch.parentId ?? null;
        const v = validateSubtaskHierarchy(userId, m.entityId, targetParentId);
        if (!v.valid) {
          return { id: m.id, status: "rejected", reason: v.error ?? "invalid_hierarchy" };
        }
        nextParentId = targetParentId;
        if (targetParentId) {
          nextListId = v.parent!.listId;
          shouldUpdateDescendantList = nextListId !== existing.listId;
        }
      }

      if (patch.listId !== undefined && patch.listId !== existing.listId) {
        if (nextParentId) {
          return { id: m.id, status: "rejected", reason: "subtasks_must_share_list" };
        }
        const targetList = tx
          .select()
          .from(schema.lists)
          .where(and(eq(schema.lists.id, patch.listId), eq(schema.lists.userId, userId), isNull(schema.lists.deletedAt)))
          .get();
        if (!targetList) {
          // deleted or missing
          return { id: m.id, status: "rejected", reason: "deleted_list" };
        }
        nextListId = patch.listId;
        shouldUpdateDescendantList = true;
      }

      if (nextListId !== existing.listId && patch.sectionId === undefined) {
        nextSectionId = null;
      }

      if (patch.sectionId !== undefined) {
        if (patch.sectionId === null || patch.sectionId === "") {
          nextSectionId = null;
        } else {
          const sec = tx
            .select()
            .from(schema.sections)
            .where(and(eq(schema.sections.id, patch.sectionId), eq(schema.sections.userId, userId), eq(schema.sections.listId, nextListId), isNull(schema.sections.deletedAt)))
            .get();
          if (!sec) {
            return { id: m.id, status: "rejected", reason: "not_found" };
          }
          nextSectionId = patch.sectionId;
        }
      }

      // position
      let newPosition = patch.position ?? existing.position;
      if (patch.position === undefined && (patch.afterId !== undefined || patch.beforeId !== undefined)) {
        const scopeConditions = [
          eq(schema.tasks.userId, userId),
          eq(schema.tasks.listId, nextListId),
          isNull(schema.tasks.deletedAt),
        ];
        if (nextParentId) scopeConditions.push(eq(schema.tasks.parentId, nextParentId));
        else scopeConditions.push(isNull(schema.tasks.parentId));
        if (nextSectionId) scopeConditions.push(eq(schema.tasks.sectionId, nextSectionId));
        else scopeConditions.push(isNull(schema.tasks.sectionId));
        newPosition = await positionBetween(
          { table: schema.tasks, where: and(...scopeConditions), excludeId: m.entityId },
          patch.afterId ?? null,
          patch.beforeId ?? null
        );
      }

      if (shouldUpdateDescendantList) {
        const descendants = getTaskDescendants(m.entityId, userId);
        if (descendants.length > 0) {
          tx.update(schema.tasks)
            .set({ listId: nextListId, version: sql`${schema.tasks.version} + 1`, updatedAt: now })
            .where(and(inArray(schema.tasks.id, descendants.map((d) => d.id)), eq(schema.tasks.userId, userId)))
            .run();
        }
      }

      tx.update(schema.tasks)
        .set({
          position: newPosition,
          listId: nextListId,
          sectionId: nextSectionId,
          parentId: nextParentId,
          version: sql`${schema.tasks.version} + 1`,
          updatedAt: now,
        })
        .where(and(eq(schema.tasks.id, m.entityId), eq(schema.tasks.userId, userId)))
        .run();

      const version = readVersion(tx, m.entityId)!;
      const seq = readSeq(tx, m.entityId)!;
      return { id: m.id, status: "applied", version, seq };
    }

    default:
      return { id: m.id, status: "rejected", reason: "unknown_op" };
  }
}

export async function processMutations(
  userId: string,
  deviceId: string | null,
  mutations: Mutation[]
): Promise<MutationResult[]> {
  const results: MutationResult[] = [];
  for (const mutation of mutations) {
    const stored = db
      .select()
      .from(schema.processedMutations)
      .where(and(eq(schema.processedMutations.userId, userId), eq(schema.processedMutations.id, mutation.id)))
      .get();

    if (stored) {
      let version: number | undefined;
      let seq: number | undefined;
      if (stored.result) {
        try {
          const parsed = JSON.parse(stored.result);
          version = parsed?.version;
          seq = parsed?.seq;
        } catch {
          // ignore parse errors
        }
      }
      results.push({ id: mutation.id, status: "duplicate", version, seq });
      continue;
    }

    const result = await db.transaction(async (tx) => {
      const r = await applyMutation(tx, userId, mutation);
      tx.insert(schema.processedMutations)
        .values({
          userId,
          id: mutation.id,
          deviceId,
          status: r.status,
          result: JSON.stringify(r),
          createdAt: Date.now() as any,
        })
        .run();
      return r;
    });

    results.push(result);
  }
  return results;
}
