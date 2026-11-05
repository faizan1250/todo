import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";

/* ---------- helpers ---------- */
const ts = (name: string) => integer(name, { mode: "timestamp_ms" });
const bool = (name: string) => integer(name, { mode: "boolean" });
const uuid = () => text("id").primaryKey().$defaultFn(() => Bun.randomUUIDv7());

// Shared columns for all synced entities.
// Bump `version` in the service layer: set({ version: sql`version + 1` })
const base = () => ({
  id: uuid(),
  createdAt: ts("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: ts("updated_at")
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date()),
  version: integer("version").notNull().default(1),
  deletedAt: ts("deleted_at"), // soft delete / trash
});

/* =====================================================
   PHASE 1: AUTH (Better Auth compatible)
   ==================================================== */
export type Preferences = {
  theme?: "light" | "dark" | "system";
  accent?: string;
  defaultListId?: string;
  quietHours?: { start: string; end: string };
  dailyDigestTime?: string; // "08:00" in user's timezone
  defaultReminderTime?: string; // "09:00" in user's timezone
  workHours?: string; // "09:00-18:00"
};

export const users = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: bool("email_verified").notNull().default(false),
  image: text("image"),
  twoFactorEnabled: bool("two_factor_enabled").default(false),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  timezone: text("timezone").notNull().default("UTC"),
  locale: text("locale").notNull().default("en"),
  weekStartsOn: integer("week_starts_on").notNull().default(1), // 0=Sun, 1=Mon
  preferences: text("preferences", { mode: "json" }).$type<Preferences>().default({}),
  seq: integer("seq").notNull().default(0),
  fieldTs: text("field_ts", { mode: "json" }),
  createdAt: ts("created_at").notNull().$defaultFn(() => new Date()),
  updatedAt: ts("updated_at").notNull().$defaultFn(() => new Date()),
},
(t) => [index("user_seq_idx").on(t.id, t.seq)]
);

export const sessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("session_user_idx").on(t.userId)]
);

export const accounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(), // "credential" | "google" | "apple"
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: ts("access_token_expires_at"),
    refreshTokenExpiresAt: ts("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"), // hashed
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
  },
  (t) => [index("account_user_idx").on(t.userId)]
);

export const verifications = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at"),
  updatedAt: ts("updated_at"),
});

export const twoFactors = sqliteTable("two_factor", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
});

export const devices = sqliteTable(
  "devices",
  {
    id: uuid(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name"),
    platform: text("platform", { enum: ["web", "ios", "android"] }).notNull(),
    fcmToken: text("fcm_token"),
    webPushSub: text("web_push_sub", { mode: "json" }).$type<{
      endpoint: string;
      keys: { p256dh: string; auth: string };
    }>(),
    lastSeenAt: ts("last_seen_at"),
    lastSyncSeq: integer("last_sync_seq"),
    lastSyncAt: ts("last_sync_at"),
    createdAt: ts("created_at").notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("device_user_idx").on(t.userId)]
);

export const invites = sqliteTable("invites", {
  id: uuid(),
  code: text("code").notNull().unique(),
  createdBy: text("created_by").notNull().references(() => users.id),
  usedBy: text("used_by").references(() => users.id),
  usedAt: ts("used_at"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().$defaultFn(() => new Date()),
});

/* =====================================================
   PHASE 2: CORE TASKS
   ===================================================== */
export const folders = sqliteTable(
  "folders",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    icon: text("icon"),
    position: text("position").notNull(), // fractional index
  },
  (t) => [index("folder_user_idx").on(t.userId, t.position), index("folder_user_seq_idx").on(t.userId, t.seq)]
);

export const lists = sqliteTable(
  "lists",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // owner
    folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    color: text("color"),
    icon: text("icon"),
    viewType: text("view_type", { enum: ["list", "board", "calendar"] }).notNull().default("list"),
    isInbox: bool("is_inbox").notNull().default(false),
    archivedAt: ts("archived_at"),
    position: text("position").notNull(),
  },
  (t) => [index("list_user_idx").on(t.userId, t.position), index("list_folder_idx").on(t.folderId), index("list_user_seq_idx").on(t.userId, t.seq)]
);

export const sections = sqliteTable(
  "sections",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    listId: text("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: text("position").notNull(),
  },
  (t) => [index("section_list_idx").on(t.listId, t.position), index("section_user_seq_idx").on(t.userId, t.seq)]
);

/* =====================================================
   PHASE 3: SCHEDULING (recurrences and places defined before tasks)
   ===================================================== */
export const recurrences = sqliteTable(
  "recurrences",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    rrule: text("rrule").notNull(), // e.g. "FREQ=WEEKLY;BYDAY=MO"
    mode: text("mode", { enum: ["fixed", "after_completion"] }).notNull().default("fixed"),
    timezone: text("timezone").notNull(),
    dtstart: ts("dtstart").notNull(),
    until: ts("until"),
    maxCount: integer("max_count"),
    completedCount: integer("completed_count").notNull().default(0),
    active: bool("active").notNull().default(true),
  },
  (t) => [index("recurrence_user_idx").on(t.userId), index("recurrence_user_seq_idx").on(t.userId, t.seq)]
);

export const places = sqliteTable(
  "places",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    radiusM: integer("radius_m").notNull().default(200),
  },
  (t) => [index("place_user_idx").on(t.userId), index("place_user_seq_idx").on(t.userId, t.seq)]
);

export const tasks = sqliteTable(
  "tasks",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // creator
    listId: text("list_id").notNull().references(() => lists.id, { onDelete: "cascade" }),
    sectionId: text("section_id").references(() => sections.id, { onDelete: "set null" }),
    parentId: text("parent_id").references((): AnySQLiteColumn => tasks.id, { onDelete: "cascade" }), // subtasks

    title: text("title").notNull(),
    notes: text("notes"), // markdown
    status: text("status", { enum: ["todo", "in_progress", "done", "cancelled"] })
      .notNull()
      .default("todo"),
    priority: integer("priority").notNull().default(0), // 0 none, 1 low, 2 med, 3 high, 4 urgent
    position: text("position").notNull(),

    // scheduling
    startAt: ts("start_at"),
    dueAt: ts("due_at"),
    deadlineAt: ts("deadline_at"),
    allDay: bool("all_day").notNull().default(false),
    estimateMin: integer("estimate_min"),
    recurrenceId: text("recurrence_id").references(() => recurrences.id, { onDelete: "set null" }),

    // location reminders (geofencing runs client-side)
    placeId: text("place_id").references(() => places.id, { onDelete: "set null" }),
    locationName: text("location_name"),
    lat: real("lat"),
    lng: real("lng"),
    radiusM: integer("radius_m"),
    locationTrigger: text("location_trigger", { enum: ["arrive", "leave"] }),

    completedAt: ts("completed_at"),
    archivedAt: ts("archived_at"),
  },
  (t) => [
    index("task_user_due_idx").on(t.userId, t.dueAt),
    index("task_user_status_idx").on(t.userId, t.status),
    index("task_list_pos_idx").on(t.listId, t.position),
    index("task_section_pos_idx").on(t.sectionId, t.position),
    index("task_parent_idx").on(t.parentId, t.position),
    index("task_recurrence_idx").on(t.recurrenceId),
    index("task_place_idx").on(t.placeId),
    index("task_active_user_due_idx")
      .on(t.userId, t.dueAt)
      .where(sql`deleted_at IS NULL AND archived_at IS NULL AND status IN ('todo', 'in_progress')`),
    index("task_active_user_priority_idx")
      .on(t.userId, t.priority)
      .where(sql`deleted_at IS NULL AND archived_at IS NULL AND status IN ('todo', 'in_progress')`),
    index("task_done_user_completed_idx")
      .on(t.userId, t.completedAt)
      .where(sql`deleted_at IS NULL AND archived_at IS NULL AND status = 'done'`),
    index("task_user_seq_idx").on(t.userId, t.seq),
  ]
);

export const checklistItems = sqliteTable(
  "checklist_items",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    done: bool("done").notNull().default(false),
    position: text("position").notNull(),
  },
  (t) => [index("checklist_task_idx").on(t.taskId, t.position), index("checklist_user_seq_idx").on(t.userId, t.seq)]
);

export const tags = sqliteTable(
  "tags",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
  },
  (t) => [
    uniqueIndex("tags_user_name_unique")
      .on(t.userId, sql`${t.name} COLLATE NOCASE`)
      .where(sql`deleted_at IS NULL`),
    index("tag_user_seq_idx").on(t.userId, t.seq),
  ]
);

export const taskTags = sqliteTable(
  "task_tags",
  {
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tagId] }), index("task_tags_tag_idx").on(t.tagId)]
);

export const templates = sqliteTable(
  "templates",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Task tree snapshot: title, notes, priority, subtasks, checklist, tags
    payload: text("payload", { mode: "json" }).$type<TemplatePayload>().notNull(),
  },
  (t) => [index("template_user_idx").on(t.userId), index("template_user_seq_idx").on(t.userId, t.seq)]
);

export type TemplatePayload = {
  title: string;
  notes?: string;
  priority?: number;
  estimateMin?: number;
  tags?: string[];
  checklist?: string[];
  subtasks?: TemplatePayload[];
};

export const reminders = sqliteTable(
  "reminders",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["absolute", "relative"] }).notNull(),
    relativeTo: text("relative_to", { enum: ["due", "start", "deadline"] }),
    offsetMin: integer("offset_min"), // negative = before
    remindAt: ts("remind_at").notNull(), // resolved fire time; snooze = update this + clear firedAt
    firedAt: ts("fired_at"),
  },
  (t) => [
    index("reminder_due_idx").on(t.firedAt, t.remindAt), // scheduler scan
    index("reminder_task_idx").on(t.taskId),
    index("reminder_user_seq_idx").on(t.userId, t.seq),
  ]
);

export const notifications = sqliteTable(
  "notifications",
  {
    ...base(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    type: text("type").notNull().default("location_trigger"),
    title: text("title").notNull(),
    body: text("body"),
    read: bool("read").notNull().default(false),
    triggeredAt: ts("triggered_at").notNull().$defaultFn(() => new Date()),
  },
  (t) => [index("notification_user_idx").on(t.userId)]
);

/* =====================================================
   PHASE 4: VIEWS, FILTERS & TIME BLOCKING
   ===================================================== */
export const savedFilters = sqliteTable(
  "saved_filters",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    icon: text("icon"),
    color: text("color"),
    query: text("query", { mode: "json" }).$type<Record<string, any>>().notNull(),
    sort: text("sort", { mode: "json" }).$type<Array<{ by: string; order: "asc" | "desc" }>>(),
    groupBy: text("group_by"),
    position: text("position").notNull(),
    pinned: bool("pinned").notNull().default(false),
  },
  (t) => [index("saved_filters_user_pos_idx").on(t.userId, t.position), index("saved_filters_user_seq_idx").on(t.userId, t.seq)]
);

export const timeBlocks = sqliteTable(
  "time_blocks",
  {
    ...base(),
    seq: integer("seq").notNull().default(0),
    fieldTs: text("field_ts", { mode: "json" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title"),
    startAt: ts("start_at").notNull(),
    endAt: ts("end_at").notNull(),
    color: text("color"),
  },
  (t) => [
    index("time_blocks_user_start_idx").on(t.userId, t.startAt),
    index("time_blocks_user_seq_idx").on(t.userId, t.seq),
    check("time_blocks_time_check", sql`end_at > start_at`),
  ]
);

/* =====================================================
   PHASE 5: SYNC
   ===================================================== */
export const syncState = sqliteTable("sync_state", {
  seq: integer("seq").notNull().default(0),
  minValidSeq: integer("min_valid_seq").notNull().default(0),
  epoch: text("epoch").notNull(),
  minClientVersion: text("min_client_version"),
});

export const processedMutations = sqliteTable(
  "processed_mutations",
  {
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    deviceId: text("device_id"),
    status: text("status").notNull(),
    result: text("result"),
    createdAt: ts("created_at"),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })]
);

export const syncConflicts = sqliteTable(
  "sync_conflicts",
  {
    id: uuid(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    losingValue: text("losing_value"),
    winningValue: text("winning_value"),
    at: ts("at"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    deviceId: text("device_id"),
  },
  (t) => [index("sync_conflicts_user_at_idx").on(t.userId, t.at)]
);