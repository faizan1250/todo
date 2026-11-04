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

export async function completeTask(
  id: string,
  completeSubtasks?: boolean
): Promise<BackendTask> {
  return apiFetch<BackendTask>(`/api/v1/tasks/${encodeURIComponent(id)}/complete`, {
    method: "POST",
    body: JSON.stringify(completeSubtasks !== undefined ? { completeSubtasks } : {}),
  });
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
