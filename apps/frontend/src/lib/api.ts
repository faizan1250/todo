import { API_BASE_URL } from "./auth-client";

export interface InviteValidationResponse {
  valid: boolean;
  remainingUses: number;
  expiresAt?: string;
  reason?: string;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  twoFactorEnabled: boolean;
  role: string;
  timezone: string;
  locale: string;
  weekStartsOn: number;
  preferences: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileInput {
  name?: string;
  timezone?: string;
  locale?: string;
  weekStartsOn?: number;
  preferences?: Record<string, unknown>;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// -------------------------------------------------------------
// Backend Models & DTOs
// -------------------------------------------------------------

export interface BackendChecklistItem {
  id: string;
  userId: string;
  taskId: string;
  text: string;
  done: boolean;
  position: string;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendTag {
  id: string;
  userId: string;
  name: string;
  color?: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendReminder {
  id: string;
  userId: string;
  taskId: string;
  kind: "absolute" | "relative";
  relativeTo?: "due" | "start" | "deadline" | null;
  offsetMin?: number | null;
  remindAt: string | number;
  firedAt?: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendPlace {
  id: string;
  userId: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendRecurrence {
  id: string;
  userId: string;
  rrule: string;
  mode: "fixed" | "after_completion";
  timezone: string;
  dtstart: string | number;
  until?: string | number | null;
  maxCount?: number | null;
  completedCount: number;
  active: boolean;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface ParsedToken {
  type: "tag" | "list" | "priority" | "estimate" | "reminder" | "recurrence" | "date";
  start: number;
  end: number;
  raw: string;
  value?: unknown;
}

export interface ParsedTaskResult {
  title: string;
  dueAt: string | Date | null;
  allDay: boolean;
  priority: number;
  tags: string[];
  list: { id: string; name: string } | null;
  estimateMin: number | null;
  recurrence: { rrule: string; mode: "fixed" | "after_completion" } | null;
  reminders: Array<{
    kind: "absolute" | "relative";
    relativeTo?: "due" | "start" | "deadline" | null;
    offsetMin?: number | null;
    remindAt?: string | Date | null;
  }>;
  tokens: ParsedToken[];
}

export interface BackendTask {
  id: string;
  userId: string;
  listId: string;
  sectionId?: string | null;
  parentId?: string | null;
  title: string;
  notes?: string | null;
  status: "todo" | "in_progress" | "done" | "cancelled";
  priority: number; // 0 none, 1 low, 2 med, 3 high, 4 urgent
  position: string;
  startAt?: string | number | null;
  dueAt?: string | number | null;
  deadlineAt?: string | number | null;
  allDay?: boolean;
  estimateMin?: number | null;
  estimateTotal?: number | null;
  recurrenceId?: string | null;
  recurrenceRule?: { rrule: string; mode: "fixed" | "after_completion" } | null;
  recurrence?: BackendRecurrence | null;
  placeId?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number | null;
  locationTrigger?: "arrive" | "leave" | null;
  completedAt?: string | number | null;
  archivedAt?: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
  subtasks?: BackendTask[];
  checklist?: BackendChecklistItem[];
  tags?: BackendTag[];
  reminders?: BackendReminder[];
  nextTask?: BackendTask | null;
}

export interface BackendFolder {
  id: string;
  userId: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  position: string;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendList {
  id: string;
  userId: string;
  folderId?: string | null;
  name: string;
  color?: string | null;
  icon?: string | null;
  viewType: "list" | "board" | "calendar";
  isInbox: boolean;
  position: string;
  archivedAt?: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendSection {
  id: string;
  userId: string;
  listId: string;
  name: string;
  position: string;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendTemplate {
  id: string;
  userId: string;
  name: string;
  payload: unknown;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

// -------------------------------------------------------------
// Phase 4: Views, Filters, Search, Calendar, Board, Planner DTOs
// -------------------------------------------------------------

export interface BackendView {
  key: string;
  name: string;
  icon: string;
}

export interface BackendViewsResponse {
  builtIns: BackendView[];
  savedFilters: BackendSavedFilter[];
}

export interface BackendViewCounts {
  overdue: number;
  today: number;
  upcoming: number;
  priority: number;
  "no-date": number;
  completed: number;
  all: number;
}

export interface BackendViewCountsResponse {
  counts: BackendViewCounts;
  filters?: Record<string, number>;
}

export interface BackendViewTask {
  id: string;
  userId: string;
  listId: string;
  sectionId?: string | null;
  parentId?: string | null;
  title: string;
  notes?: string | null;
  status: "todo" | "in_progress" | "done" | "cancelled";
  priority: number;
  position: string;
  startAt?: string | number | null;
  dueAt?: string | number | null;
  deadlineAt?: string | number | null;
  allDay?: boolean;
  estimateMin?: number | null;
  recurrenceId?: string | null;
  placeId?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number | null;
  locationTrigger?: "arrive" | "leave" | null;
  completedAt?: string | number | null;
  archivedAt?: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
  listName?: string | null;
  listColor?: string | null;
  parentTitle?: string | null;
  subtaskDone?: number;
  subtaskTotal?: number;
}

export interface BackendViewItemsResponse {
  key: string;
  items: BackendViewTask[];
  groups?: Array<{ date: string; tasks: BackendViewTask[] }>;
  nextCursor: string | null;
  hasMore: boolean;
}

export interface BackendSavedFilter {
  id: string;
  userId: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  query: unknown;
  sort?: Array<{ by: string; order: "asc" | "desc" }> | null;
  groupBy?: string | null;
  position: string;
  pinned: boolean;
  createdAt: string | number;
  updatedAt: string | number;
  version: number;
  deletedAt?: string | number | null;
}

export interface BackendFilterSchema {
  fields: unknown;
  operators: unknown;
  relativeDates: unknown;
}

export interface BackendFilteredTasksResponse {
  items: BackendViewTask[];
  nextCursor: string | null;
  hasMore: boolean;
  filter?: BackendSavedFilter;
}

export interface BackendSearchTaskResult extends BackendViewTask {
  titleHl: string;
  notesHl: string;
  rank: number;
}

export interface BackendSearchResponse {
  tasks: BackendSearchTaskResult[];
  total?: number;
  lists?: Array<{ id: string; name: string; color?: string | null; isInbox: boolean; position: string }>;
  tags?: Array<{ id: string; name: string; color?: string | null }>;
  filters?: Array<{ id: string; name: string; icon?: string | null; color?: string | null; position: string; pinned: boolean }>;
}

export interface BackendCalendarItem {
  id: string;
  type: "task" | "block" | "virtual";
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  status: string | null;
  priority: number;
  listId: string | null;
  color: string | null;
  virtual?: boolean;
  taskId?: string | null;
  recurrenceId?: string | null;
}

export interface BackendCalendarResponse {
  from: string;
  to: string;
  items: BackendCalendarItem[];
  total: number;
}

export interface BackendBoardColumn {
  key: string;
  title: string;
  sectionId?: string | null;
  count: number;
  tasks: BackendViewTask[];
  nextCursor?: string | null;
}

export interface BackendBoardResponse {
  listId: string;
  groupBy: string;
  columns: BackendBoardColumn[];
}

export interface BackendBoardMoveResponse {
  task: BackendTask;
  nextTask?: BackendTask | null;
}

export interface BackendTimeBlock {
  id: string;
  userId: string;
  taskId?: string | null;
  title?: string | null;
  startAt: string | number;
  endAt: string | number;
  color?: string | null;
  createdAt: string | number;
  updatedAt: string | number;
  version?: number;
  deletedAt?: string | number | null;
  task?: {
    id: string;
    title: string;
    status: string;
    priority: number;
    estimateMin: number | null;
    listId: string;
  } | null;
}

export interface BackendPlannerUnscheduledTask {
  id: string;
  title: string;
  status: string;
  priority: number;
  dueAt: string | null;
  startAt: string | null;
  allDay: boolean;
  estimateMin: number | null;
  listName: string | null;
  listColor: string | null;
  subtaskDone: number;
  subtaskTotal: number;
}

export interface BackendPlannerCapacity {
  workMin: number;
  scheduledMin: number;
  estimatedMin: number;
}

export interface BackendPlannerResponse {
  date: string;
  workHours: string;
  blocks: BackendTimeBlock[];
  unscheduled: BackendPlannerUnscheduledTask[];
  capacity: BackendPlannerCapacity;
  conflicts: Array<[string, string]>;
}

export interface PaginatedTasksResponse {
  items: BackendTask[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface TrashGroupedResponse {
  tasks: BackendTask[];
  lists: BackendList[];
  folders: BackendFolder[];
  sections: BackendSection[];
}

export interface CreateTaskInput {
  title: string;
  listId?: string;
  sectionId?: string | null;
  parentId?: string | null;
  notes?: string | null;
  priority?: number;
  status?: "todo" | "in_progress" | "done" | "cancelled";
  position?: string;
  afterId?: string | null;
  beforeId?: string | null;
  startAt?: string | number | null;
  dueAt?: string | number | null;
  deadlineAt?: string | number | null;
  allDay?: boolean;
  estimateMin?: number | null;
  placeId?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number | null;
  locationTrigger?: "arrive" | "leave" | null;
  tagIds?: string[];
  recurrenceRule?: { rrule: string; mode?: "fixed" | "after_completion" };
  reminders?: Array<{
    kind: "absolute" | "relative";
    relativeTo?: "due" | "start" | "deadline" | null;
    offsetMin?: number | null;
    remindAt?: string | number | null;
  }>;
}

export interface UpdateTaskInput {
  title?: string;
  notes?: string | null;
  listId?: string;
  sectionId?: string | null;
  parentId?: string | null;
  priority?: number;
  status?: "todo" | "in_progress" | "done" | "cancelled";
  position?: string;
  startAt?: string | number | null;
  dueAt?: string | number | null;
  deadlineAt?: string | number | null;
  allDay?: boolean;
  estimateMin?: number | null;
  placeId?: string | null;
  locationName?: string | null;
  lat?: number | null;
  lng?: number | null;
  radiusM?: number | null;
  locationTrigger?: "arrive" | "leave" | null;
  completedAt?: string | number | null;
  archivedAt?: string | number | null;
  version?: number;
  tagIds?: string[];
}

export interface MoveTaskInput {
  listId?: string;
  sectionId?: string | null;
  parentId?: string | null;
  afterId?: string | null;
  beforeId?: string | null;
}

// -------------------------------------------------------------
// Core Fetch Helper
// -------------------------------------------------------------

async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }

  const res = await fetch(url, {
    ...options,
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    let errorMessage = `API request failed: ${res.statusText} (${res.status})`;
    let errorData: unknown;
    try {
      errorData = await res.json();
      if (typeof errorData === "object" && errorData !== null) {
        const obj = errorData as Record<string, unknown>;
        if (typeof obj.error === "string") {
          errorMessage = obj.error;
        } else if (typeof obj.message === "string") {
          errorMessage = obj.message;
        }
      }
    } catch {
      // Ignore JSON parse errors for non-JSON responses
    }
    throw new ApiError(errorMessage, res.status, errorData);
  }

  if (res.status === 204) {
    return {} as T;
  }

  return (await res.json()) as T;
}

// -------------------------------------------------------------
// Auth & Invite & Profile APIs
// -------------------------------------------------------------

export async function validateInviteCode(
  code: string
): Promise<InviteValidationResponse> {
  const trimmed = code.trim();
  if (!trimmed) {
    return {
      valid: false,
      reason: "Invite code is required",
      remainingUses: 0,
    };
  }

  try {
    const res = await fetch(`${API_BASE_URL}/api/invite/validate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ code: trimmed }),
    });

    const data = (await res.json()) as InviteValidationResponse;
    return data;
  } catch (err) {
    return {
      valid: false,
      reason:
        err instanceof Error ? err.message : "Failed to validate invite code",
      remainingUses: 0,
    };
  }
}

export async function getCurrentProfile(): Promise<UserProfile | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/me`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    if (res.status === 401 || res.status === 403) {
      return null;
    }

    if (!res.ok) {
      const errorText = await res.text();
      throw new ApiError(
        `Failed to fetch profile: ${res.statusText}`,
        res.status,
        errorText
      );
    }

    const data = (await res.json()) as UserProfile;
    return data;
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      return null;
    }
    throw err;
  }
}

export async function updateCurrentProfile(
  data: UpdateProfileInput
): Promise<UserProfile> {
  return apiFetch<UserProfile>("/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

// -------------------------------------------------------------
// Tasks API (/api/v1/tasks)
// -------------------------------------------------------------

export async function getTasks(params?: {
  listId?: string;
  sectionId?: string;
  parentId?: string;
  status?: string;
  priority?: number;
  tag?: string;
  search?: string;
  include?: string;
  cursor?: string;
  limit?: number;
  archived?: boolean;
}): Promise<PaginatedTasksResponse> {
  const query = new URLSearchParams();
  if (params?.listId) query.set("listId", params.listId);
  if (params?.sectionId) query.set("sectionId", params.sectionId);
  if (params?.parentId) query.set("parentId", params.parentId);
  if (params?.status) query.set("status", params.status);
  if (params?.priority !== undefined) query.set("priority", String(params.priority));
  if (params?.tag) query.set("tag", params.tag);
  if (params?.search) query.set("search", params.search);
  if (params?.include) query.set("include", params.include);
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.archived !== undefined) query.set("archived", String(params.archived));

  const qs = query.toString();
  return apiFetch<PaginatedTasksResponse>(`/api/v1/tasks${qs ? `?${qs}` : ""}`);
}

export async function getTask(
  id: string,
  include?: string
): Promise<BackendTask> {
  const qs = include ? `?include=${encodeURIComponent(include)}` : "";
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}${qs}`);
}

export async function createTask(
  data: CreateTaskInput
): Promise<BackendTask> {
  return apiFetch<BackendTask>("/api/v1/tasks", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTask(
  id: string,
  data: UpdateTaskInput
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteTask(
  id: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/tasks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function moveTask(
  id: string,
  data: MoveTaskInput
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export interface CreateReminderInput {
  kind: "absolute" | "relative";
  relativeTo?: "due" | "start" | "deadline" | null;
  offsetMin?: number | null;
  remindAt?: string | number | null;
}

export interface UpdateReminderInput {
  kind?: "absolute" | "relative";
  relativeTo?: "due" | "start" | "deadline" | null;
  offsetMin?: number | null;
  remindAt?: string | number | null;
}

export interface SetRecurrenceInput {
  rrule: string;
  mode?: "fixed" | "after_completion";
  timezone?: string;
  dtstart?: string;
  until?: string;
  maxCount?: number;
}

export interface TaskCompletionResult extends BackendTask {
  task?: BackendTask;
  nextTask?: BackendTask | null;
}

export interface SkipTaskResponse extends BackendTask {
  task: BackendTask;
  nextTask: BackendTask | null;
}

export async function completeTask(
  id: string,
  completeSubtasks?: boolean
): Promise<TaskCompletionResult> {
  const res = await apiFetch<TaskCompletionResult>(`/api/v1/tasks/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    body: JSON.stringify(completeSubtasks !== undefined ? { completeSubtasks } : {}),
  });
  return {
    ...res,
    task: res.task || res,
    nextTask: res.nextTask ?? null,
  };
}

export async function skipTask(id: string): Promise<SkipTaskResponse> {
  const res = await apiFetch<SkipTaskResponse>(`/api/v1/tasks/${encodeURIComponent(id)}/skip`, {
    method: "POST",
  });
  const task = res.task || res;
  const nextTask = res.nextTask ?? null;
  return {
    ...res,
    task,
    nextTask,
  };
}

// -------------------------------------------------------------
// Recurrence API (/api/v1/tasks/:id/recurrence)
// -------------------------------------------------------------

export async function setTaskRecurrence(
  taskId: string,
  rule: SetRecurrenceInput
): Promise<{ task: BackendTask; recurrence: BackendRecurrence }> {
  return apiFetch<{ task: BackendTask; recurrence: BackendRecurrence }>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/recurrence`,
    {
      method: "PUT",
      body: JSON.stringify(rule),
    }
  );
}

export async function deleteTaskRecurrence(
  taskId: string
): Promise<{ success: boolean; task?: BackendTask }> {
  return apiFetch<{ success: boolean; task?: BackendTask }>(
    `/api/v1/tasks/${encodeURIComponent(taskId)}/recurrence`,
    {
      method: "DELETE",
    }
  );
}

// -------------------------------------------------------------
// Reminders API (/api/v1/tasks/:id/reminders & /api/v1/reminders/:id)
// -------------------------------------------------------------

export async function getTaskReminders(taskId: string): Promise<BackendReminder[]> {
  return apiFetch<BackendReminder[]>(`/api/v1/tasks/${encodeURIComponent(taskId)}/reminders`);
}

export async function createTaskReminder(
  taskId: string,
  data: CreateReminderInput
): Promise<BackendReminder> {
  return apiFetch<BackendReminder>(`/api/v1/tasks/${encodeURIComponent(taskId)}/reminders`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteTaskReminder(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/reminders/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function snoozeReminder(
  id: string,
  presetOrDate: string | number
): Promise<BackendReminder> {
  return apiFetch<BackendReminder>(`/api/v1/reminders/${encodeURIComponent(id)}/snooze`, {
    method: "POST",
    body: JSON.stringify({
      preset: typeof presetOrDate === "string" ? presetOrDate : undefined,
      time: presetOrDate,
    }),
  });
}

export async function dismissReminder(id: string): Promise<BackendReminder> {
  return apiFetch<BackendReminder>(`/api/v1/reminders/${encodeURIComponent(id)}/dismiss`, {
    method: "POST",
  });
}

// -------------------------------------------------------------
// NLP & Quick Add API (/api/v1/parse & /api/v1/tasks/quick)
// -------------------------------------------------------------

export async function parseNaturalLanguageText(
  text: string,
  timezone?: string
): Promise<ParsedTaskResult> {
  return apiFetch<ParsedTaskResult>("/api/v1/parse", {
    method: "POST",
    body: JSON.stringify({
      text,
      timezone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
}

export async function quickAddTask(data: {
  text: string;
  timezone?: string;
  listId?: string;
}): Promise<BackendTask> {
  return apiFetch<BackendTask>("/api/v1/tasks/quick", {
    method: "POST",
    body: JSON.stringify({
      ...data,
      timezone: data.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
}

// -------------------------------------------------------------
// Places & Geofences API (/api/v1/places & /api/v1/geofences)
// -------------------------------------------------------------

export async function getPlaces(): Promise<BackendPlace[]> {
  return apiFetch<BackendPlace[]>("/api/v1/places");
}

export async function createPlace(data: {
  name: string;
  lat: number;
  lng: number;
  radiusM?: number;
}): Promise<BackendPlace> {
  return apiFetch<BackendPlace>("/api/v1/places", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deletePlace(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/places/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function getGeofences(): Promise<BackendTask[]> {
  return apiFetch<BackendTask[]>("/api/v1/geofences");
}

export async function reopenTask(
  id: string
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}/reopen`, {
    method: "POST",
  });
}

export async function archiveTask(
  id: string
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });
}

export async function unarchiveTask(
  id: string
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}/unarchive`, {
    method: "POST",
  });
}

export async function duplicateTask(
  id: string
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}/duplicate`, {
    method: "POST",
  });
}

export async function saveTaskAsTemplate(
  id: string,
  name: string
): Promise<BackendTemplate> {
  return apiFetch<BackendTemplate>(`/api/v1/tasks/${encodeURIComponent(id)}/save-as-template`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function bulkTasks(
  ids: string[],
  action: string,
  payload?: unknown
): Promise<unknown> {
  return apiFetch<unknown>("/api/v1/tasks/bulk", {
    method: "POST",
    body: JSON.stringify({ ids, action, payload }),
  });
}

// -------------------------------------------------------------
// Containers API: Folders (/api/v1/folders)
// -------------------------------------------------------------

export async function getFolders(): Promise<BackendFolder[]> {
  return apiFetch<BackendFolder[]>("/api/v1/folders");
}

export async function createFolder(data: {
  name: string;
  color?: string;
  icon?: string;
}): Promise<BackendFolder> {
  return apiFetch<BackendFolder>("/api/v1/folders", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateFolder(
  id: string,
  data: Partial<{ name: string; color?: string; icon?: string }>
): Promise<BackendFolder> {
  return apiFetch<BackendFolder>(`/api/v1/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteFolder(
  id: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/folders/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// -------------------------------------------------------------
// Containers API: Lists (/api/v1/lists)
// -------------------------------------------------------------

export async function getLists(params?: {
  archived?: boolean;
  folderId?: string;
}): Promise<BackendList[]> {
  const query = new URLSearchParams();
  if (params?.archived !== undefined) query.set("archived", String(params.archived));
  if (params?.folderId) query.set("folderId", params.folderId);
  const qs = query.toString();
  return apiFetch<BackendList[]>(`/api/v1/lists${qs ? `?${qs}` : ""}`);
}

export async function createList(data: {
  name: string;
  folderId?: string;
  color?: string;
  icon?: string;
  viewType?: string;
}): Promise<BackendList> {
  return apiFetch<BackendList>("/api/v1/lists", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateList(
  id: string,
  data: Partial<{
    name: string;
    folderId?: string | null;
    color?: string | null;
    icon?: string | null;
    viewType?: string;
  }>
): Promise<BackendList> {
  return apiFetch<BackendList>(`/api/v1/lists/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteList(
  id: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/lists/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function archiveList(
  id: string
): Promise<BackendList> {
  return apiFetch<BackendList>(`/api/v1/lists/${encodeURIComponent(id)}/archive`, {
    method: "POST",
  });
}

export async function unarchiveList(
  id: string
): Promise<BackendList> {
  return apiFetch<BackendList>(`/api/v1/lists/${encodeURIComponent(id)}/unarchive`, {
    method: "POST",
  });
}

// -------------------------------------------------------------
// Containers API: Sections
// -------------------------------------------------------------

export async function getSections(
  listId: string
): Promise<BackendSection[]> {
  return apiFetch<BackendSection[]>(`/api/v1/lists/${encodeURIComponent(listId)}/sections`);
}

export async function createSection(
  listId: string,
  name: string
): Promise<BackendSection> {
  return apiFetch<BackendSection>(`/api/v1/lists/${encodeURIComponent(listId)}/sections`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function updateSection(
  id: string,
  name: string
): Promise<BackendSection> {
  return apiFetch<BackendSection>(`/api/v1/sections/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

export async function deleteSection(
  id: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/sections/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// -------------------------------------------------------------
// Checklist API
// -------------------------------------------------------------

export async function getChecklist(
  taskId: string
): Promise<BackendChecklistItem[]> {
  return apiFetch<BackendChecklistItem[]>(`/api/v1/tasks/${encodeURIComponent(taskId)}/checklist`);
}

export async function createChecklistItem(
  taskId: string,
  text: string
): Promise<BackendChecklistItem> {
  return apiFetch<BackendChecklistItem>(`/api/v1/tasks/${encodeURIComponent(taskId)}/checklist`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

export async function updateChecklistItem(
  itemId: string,
  data: { text?: string; done?: boolean }
): Promise<BackendChecklistItem> {
  return apiFetch<BackendChecklistItem>(`/api/v1/checklist/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteChecklistItem(
  itemId: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/checklist/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
  });
}

// -------------------------------------------------------------
// Tags API (/api/v1/tags)
// -------------------------------------------------------------

export async function getTags(): Promise<BackendTag[]> {
  return apiFetch<BackendTag[]>("/api/v1/tags");
}

export async function createTag(data: {
  name: string;
  color?: string;
}): Promise<BackendTag> {
  return apiFetch<BackendTag>("/api/v1/tags", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTag(
  id: string,
  data: Partial<{ name: string; color?: string }>
): Promise<BackendTag> {
  return apiFetch<BackendTag>(`/api/v1/tags/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteTag(
  id: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/tags/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function replaceTaskTags(
  taskId: string,
  tagIds: string[]
): Promise<BackendTask | { success: boolean }> {
  return apiFetch<BackendTask | { success: boolean }>(`/api/v1/tasks/${encodeURIComponent(taskId)}/tags`, {
    method: "PUT",
    body: JSON.stringify({ tagIds }),
  });
}

// -------------------------------------------------------------
// Trash API (/api/v1/trash)
// -------------------------------------------------------------

export async function getTrash(
  type?: "task" | "list" | "folder" | "section" | string
): Promise<TrashGroupedResponse | BackendTask[] | BackendList[] | BackendFolder[] | BackendSection[]> {
  const qs = type ? `?type=${encodeURIComponent(type)}` : "";
  return apiFetch(`/api/v1/trash${qs}`);
}

export async function restoreTrash(
  type: "task" | "list" | "folder" | "section" | string,
  id: string
): Promise<{ success: boolean; restored: unknown }> {
  return apiFetch<{ success: boolean; restored: unknown }>(
    `/api/v1/trash/${encodeURIComponent(type)}/${encodeURIComponent(id)}/restore`,
    {
      method: "POST",
    }
  );
}

export async function hardDeleteTrash(
  type: "task" | "list" | "folder" | "section" | string,
  id: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(
    `/api/v1/trash/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    }
  );
}

export async function emptyTrash(): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>("/api/v1/trash", {
    method: "DELETE",
  });
}

// -------------------------------------------------------------
// Templates API (/api/v1/templates)
// -------------------------------------------------------------

export async function getTemplates(): Promise<BackendTemplate[]> {
  return apiFetch<BackendTemplate[]>("/api/v1/templates");
}

export async function createTemplate(data: {
  name: string;
  payload: unknown;
}): Promise<BackendTemplate> {
  return apiFetch<BackendTemplate>("/api/v1/templates", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function instantiateTemplate(
  templateId: string,
  data: {
    listId: string;
    sectionId?: string;
    parentId?: string;
  }
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/templates/${encodeURIComponent(templateId)}/instantiate`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteTemplate(
  templateId: string
): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/templates/${encodeURIComponent(templateId)}`, {
    method: "DELETE",
  });
}

// -------------------------------------------------------------
// Views API (/api/v1/views)
// -------------------------------------------------------------

export async function getViews(): Promise<BackendViewsResponse> {
  return apiFetch<BackendViewsResponse>("/api/v1/views");
}

export async function getViewsCounts(params?: {
  tz?: string;
  days?: number;
  completed_days?: number;
  filters?: boolean;
}): Promise<BackendViewCountsResponse> {
  const query = new URLSearchParams();
  if (params?.tz) query.set("tz", params.tz);
  if (params?.days !== undefined) query.set("days", String(params.days));
  if (params?.completed_days !== undefined) query.set("completed_days", String(params.completed_days));
  if (params?.filters) query.set("filters", "true");
  const qs = query.toString();
  return apiFetch<BackendViewCountsResponse>(`/api/v1/views/counts${qs ? `?${qs}` : ""}`);
}

export async function getViewItems(
  key: string,
  params?: { cursor?: string; limit?: number; tz?: string; days?: number }
): Promise<BackendViewItemsResponse> {
  const query = new URLSearchParams();
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.tz) query.set("tz", params.tz);
  if (params?.days !== undefined) query.set("days", String(params.days));
  const qs = query.toString();
  return apiFetch<BackendViewItemsResponse>(`/api/v1/views/${encodeURIComponent(key)}${qs ? `?${qs}` : ""}`);
}

// -------------------------------------------------------------
// Saved Filters API (/api/v1/filters)
// -------------------------------------------------------------

export async function getFilters(): Promise<BackendSavedFilter[]> {
  return apiFetch<BackendSavedFilter[]>("/api/v1/filters");
}

export async function getFilterSchema(): Promise<BackendFilterSchema> {
  return apiFetch<BackendFilterSchema>("/api/v1/filters/schema");
}

export async function createFilter(data: {
  name: string;
  icon?: string;
  color?: string;
  query: unknown;
  sort?: Array<{ by: string; order: "asc" | "desc" }>;
  groupBy?: string;
  pinned?: boolean;
}): Promise<BackendSavedFilter> {
  return apiFetch<BackendSavedFilter>("/api/v1/filters", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateFilter(
  id: string,
  data: {
    name?: string;
    icon?: string | null;
    color?: string | null;
    query?: unknown;
    sort?: Array<{ by: string; order: "asc" | "desc" }> | null;
    groupBy?: string | null;
    pinned?: boolean;
  }
): Promise<BackendSavedFilter> {
  return apiFetch<BackendSavedFilter>(`/api/v1/filters/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteFilter(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/filters/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function moveFilter(
  id: string,
  data: { afterId?: string; beforeId?: string }
): Promise<BackendSavedFilter> {
  return apiFetch<BackendSavedFilter>(`/api/v1/filters/${encodeURIComponent(id)}/move`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function getFilterTasks(
  id: string,
  params?: { cursor?: string; limit?: number; tz?: string }
): Promise<BackendFilteredTasksResponse> {
  const query = new URLSearchParams();
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.tz) query.set("tz", params.tz);
  const qs = query.toString();
  return apiFetch<BackendFilteredTasksResponse>(`/api/v1/filters/${encodeURIComponent(id)}/tasks${qs ? `?${qs}` : ""}`);
}

export async function previewFilter(data: {
  query: unknown;
  sort?: Array<{ by: string; order: "asc" | "desc" }>;
}, params?: { cursor?: string; limit?: number; tz?: string }): Promise<BackendFilteredTasksResponse> {
  const query = new URLSearchParams();
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.tz) query.set("tz", params.tz);
  const qs = query.toString();
  return apiFetch<BackendFilteredTasksResponse>(`/api/v1/filters/preview${qs ? `?${qs}` : ""}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// -------------------------------------------------------------
// Search API (/api/v1/search)
// -------------------------------------------------------------

export async function search(params: {
  q?: string;
  types?: string;
  list_id?: string;
  status?: string;
  tag?: string;
  archived?: boolean;
  scope?: string;
  limit?: number;
}): Promise<BackendSearchResponse> {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.types) query.set("types", params.types);
  if (params?.list_id) query.set("list_id", params.list_id);
  if (params?.status) query.set("status", params.status);
  if (params?.tag) query.set("tag", params.tag);
  if (params?.archived !== undefined) query.set("archived", String(params.archived));
  if (params?.scope) query.set("scope", params.scope);
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  const qs = query.toString();
  return apiFetch<BackendSearchResponse>(`/api/v1/search${qs ? `?${qs}` : ""}`);
}

export async function rebuildSearchIndex(): Promise<{ success: boolean; message: string; timestamp: string }> {
  return apiFetch<{ success: boolean; message: string; timestamp: string }>("/api/v1/search/rebuild", {
    method: "POST",
  });
}

// -------------------------------------------------------------
// Calendar API (/api/v1/calendar)
// -------------------------------------------------------------

export async function getCalendar(params: {
  from: string;
  to: string;
  list_id?: string;
  include_done?: boolean;
  tz?: string;
}): Promise<BackendCalendarResponse> {
  const query = new URLSearchParams();
  query.set("from", params.from);
  query.set("to", params.to);
  if (params.list_id) query.set("list_id", params.list_id);
  if (params.include_done !== undefined) query.set("include_done", String(params.include_done));
  if (params.tz) query.set("tz", params.tz);
  const qs = query.toString();
  return apiFetch<BackendCalendarResponse>(`/api/v1/calendar?${qs}`);
}

// -------------------------------------------------------------
// Board API (/api/v1/board)
// -------------------------------------------------------------

export async function getBoard(params?: {
  list_id?: string;
  group_by?: string;
}): Promise<BackendBoardResponse> {
  const query = new URLSearchParams();
  if (params?.list_id) query.set("list_id", params.list_id);
  if (params?.group_by) query.set("group_by", params.group_by);
  const qs = query.toString();
  return apiFetch<BackendBoardResponse>(`/api/v1/board${qs ? `?${qs}` : ""}`);
}

export async function moveBoardTask(data: {
  taskId: string;
  column: string;
  afterId?: string;
  beforeId?: string;
}): Promise<BackendBoardMoveResponse> {
  return apiFetch<BackendBoardMoveResponse>("/api/v1/board/move", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// -------------------------------------------------------------
// Planner & Time Blocks API (/api/v1/planner, /api/v1/time-blocks)
// -------------------------------------------------------------

export async function getPlanner(params?: {
  date?: string;
  tz?: string;
}): Promise<BackendPlannerResponse> {
  const query = new URLSearchParams();
  if (params?.date) query.set("date", params.date);
  if (params?.tz) query.set("tz", params.tz);
  const qs = query.toString();
  return apiFetch<BackendPlannerResponse>(`/api/v1/planner${qs ? `?${qs}` : ""}`);
}

export async function createTimeBlock(data: {
  taskId?: string;
  title?: string;
  startAt: string;
  endAt: string;
  color?: string;
}, params?: { tz?: string }): Promise<BackendTimeBlock> {
  const query = new URLSearchParams();
  if (params?.tz) query.set("tz", params.tz);
  const qs = query.toString();
  return apiFetch<BackendTimeBlock>(`/api/v1/time-blocks${qs ? `?${qs}` : ""}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateTimeBlock(
  id: string,
  data: {
    taskId?: string | null;
    title?: string | null;
    startAt?: string;
    endAt?: string;
    color?: string | null;
  },
  params?: { tz?: string }
): Promise<BackendTimeBlock> {
  const query = new URLSearchParams();
  if (params?.tz) query.set("tz", params.tz);
  const qs = query.toString();
  return apiFetch<BackendTimeBlock>(`/api/v1/time-blocks/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteTimeBlock(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/v1/time-blocks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function scheduleTask(data: {
  taskId: string;
  start: string;
}, params?: { tz?: string }): Promise<BackendTimeBlock> {
  const query = new URLSearchParams();
  if (params?.tz) query.set("tz", params.tz);
  const qs = query.toString();
  return apiFetch<BackendTimeBlock>(`/api/v1/planner/schedule${qs ? `?${qs}` : ""}`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// -------------------------------------------------------------
// Sync conflicts API (/api/v1/sync/conflicts)
// -------------------------------------------------------------

export interface SyncConflict {
  id: string;
  entity: string;
  entityId: string;
  field: string;
  losingValue: string;
  winningValue: string;
  at: number;
  taskTitle: string | null;
}

export interface SyncConflictsResponse {
  conflicts: SyncConflict[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function getSyncConflicts(params?: {
  limit?: number;
  cursor?: string;
}): Promise<SyncConflictsResponse> {
  const query = new URLSearchParams();
  if (params?.limit !== undefined) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  const qs = query.toString();
  return apiFetch<SyncConflictsResponse>(
    `/api/v1/sync/conflicts${qs ? `?${qs}` : ""}`
  );
}
