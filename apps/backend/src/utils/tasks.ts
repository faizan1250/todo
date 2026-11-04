import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db, sqlite } from "../db";
import * as schema from "../db/schema";

export type TaskRow = typeof schema.tasks.$inferSelect;
export type TaskCompleteHook = (task: TaskRow) => Promise<void> | void;

const completeHooks: TaskCompleteHook[] = [];

/**
 * Registers an onComplete hook invoked whenever a task is marked complete.
 * Returns an unregister function.
 */
export function registerCompleteHook(hook: TaskCompleteHook): () => void {
  completeHooks.push(hook);
  return () => {
    const idx = completeHooks.indexOf(hook);
    if (idx !== -1) {
      completeHooks.splice(idx, 1);
    }
  };
}

/**
 * Executes all registered onComplete hooks sequentially for a completed task.
 */
export async function runCompleteHooks(task: TaskRow): Promise<void> {
  for (const hook of completeHooks) {
    await hook(task);
  }
}

/**
 * Clears all registered onComplete hooks (useful in testing).
 */
export function clearCompleteHooks(): void {
  completeHooks.length = 0;
}

export interface ParentTaskInfo {
  id: string;
  listId: string;
  userId: string;
  depth: number;
}

export interface HierarchyValidationResult {
  valid: boolean;
  error?: string;
  statusCode?: number;
  parent?: ParentTaskInfo;
  descendantIds: string[];
}

/**
 * Retrieves all ancestors of a task by ID.
 * Returns array ordered from the task up to the root ancestor.
 */
export function getTaskAncestors(taskId: string, userId: string): Array<{ id: string; parentId: string | null; listId: string; depth: number }> {
  const query = sqlite.query<
    { id: string; parent_id: string | null; list_id: string; depth: number },
    [string, string]
  >(`
    WITH RECURSIVE ancestor_tree AS (
      SELECT id, parent_id, list_id, 1 AS depth
      FROM tasks
      WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL
      UNION ALL
      SELECT t.id, t.parent_id, t.list_id, a.depth + 1
      FROM tasks t
      JOIN ancestor_tree a ON t.id = a.parent_id
      WHERE t.user_id = ?2 AND t.deleted_at IS NULL
    )
    SELECT id, parent_id, list_id, depth FROM ancestor_tree;
  `);

  const rows = query.all(taskId, userId);
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    listId: r.list_id,
    depth: r.depth,
  }));
}

/**
 * Retrieves all descendants of a task by ID.
 */
export function getTaskDescendants(taskId: string, userId: string): Array<{ id: string; parentId: string; subtreeDepth: number }> {
  const query = sqlite.query<
    { id: string; parent_id: string; subtree_depth: number },
    [string, string]
  >(`
    WITH RECURSIVE descendant_tree AS (
      SELECT id, parent_id, 1 AS subtree_depth
      FROM tasks
      WHERE parent_id = ?1 AND user_id = ?2 AND deleted_at IS NULL
      UNION ALL
      SELECT t.id, t.parent_id, d.subtree_depth + 1
      FROM tasks t
      JOIN descendant_tree d ON t.parent_id = d.id
      WHERE t.user_id = ?2 AND t.deleted_at IS NULL
    )
    SELECT id, parent_id, subtree_depth FROM descendant_tree;
  `);

  const rows = query.all(taskId, userId);
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_id,
    subtreeDepth: r.subtree_depth,
  }));
}

/**
 * Validates subtask hierarchy depth (max 3 levels) and cycle prevention.
 * Level 1: Root task (parentId = null)
 * Level 2: Subtask (parentId = rootTaskId)
 * Level 3: Grandchild subtask (parentId = subtaskId)
 *
 * @param userId - ID of authenticated user
 * @param taskId - ID of task being updated (null if creating a new task)
 * @param newParentId - Destination parent ID (or null if moving to root)
 */
export function validateSubtaskHierarchy(
  userId: string,
  taskId: string | null,
  newParentId: string | null | undefined
): HierarchyValidationResult {
  // If moving to root / no parent
  if (!newParentId) {
    const descendants = taskId ? getTaskDescendants(taskId, userId) : [];
    return {
      valid: true,
      descendantIds: descendants.map((d) => d.id),
    };
  }

  // Self-parenting check
  if (taskId && newParentId === taskId) {
    return {
      valid: false,
      error: "A task cannot be its own parent",
      statusCode: 400,
      descendantIds: [],
    };
  }

  // Descendant cycle check
  const descendants = taskId ? getTaskDescendants(taskId, userId) : [];
  const descendantIds = descendants.map((d) => d.id);

  if (taskId && descendantIds.includes(newParentId)) {
    return {
      valid: false,
      error: "A task cannot have one of its descendants as a parent",
      statusCode: 400,
      descendantIds,
    };
  }

  // Retrieve parent's ancestor chain to find parent depth
  const parentAncestors = getTaskAncestors(newParentId, userId);
  if (parentAncestors.length === 0) {
    return {
      valid: false,
      error: "Parent task not found",
      statusCode: 404,
      descendantIds,
    };
  }

  // The parent task's depth from root (root = 1, child = 2, grandchild = 3)
  const parentDepth = parentAncestors.length;

  // Maximum depth of descendants below current task (0 if no descendants)
  const maxDescendantSubtree = descendants.length > 0
    ? Math.max(...descendants.map((d) => d.subtreeDepth))
    : 0;

  // If task is placed under parent, the deepest node in this branch will be:
  // parentDepth + 1 (the task itself) + maxDescendantSubtree
  const resultingMaxDepth = parentDepth + 1 + maxDescendantSubtree;

  if (resultingMaxDepth > 3) {
    return {
      valid: false,
      error: "Subtasks can be nested up to 3 levels maximum",
      statusCode: 400,
      descendantIds,
    };
  }

  const parentRow = parentAncestors[0]; // first row is parent itself
  return {
    valid: true,
    parent: {
      id: parentRow.id,
      listId: parentRow.listId,
      userId,
      depth: parentDepth,
    },
    descendantIds,
  };
}

/**
 * Computes sum of descendant estimates for given task IDs in a single recursive CTE query.
 */
export function computeEstimateTotals(
  taskIds: string[],
  userId: string
): Map<string, number> {
  if (taskIds.length === 0) return new Map();
  const placeholders = taskIds.map(() => "?").join(",");
  const query = sqlite.query<
    { root_id: string; subtask_estimate_sum: number },
    any[]
  >(`
    WITH RECURSIVE sub(id, parent_id, estimate_min, root_id) AS (
      SELECT id, parent_id, estimate_min, parent_id AS root_id
      FROM tasks
      WHERE parent_id IN (${placeholders}) AND user_id = ? AND deleted_at IS NULL
      UNION ALL
      SELECT t.id, t.parent_id, t.estimate_min, sub.root_id
      FROM tasks t
      JOIN sub ON t.parent_id = sub.id
      WHERE t.user_id = ? AND t.deleted_at IS NULL
    )
    SELECT root_id, SUM(estimate_min) AS subtask_estimate_sum
    FROM sub
    WHERE estimate_min IS NOT NULL
    GROUP BY root_id;
  `);

  const rows = query.all(...taskIds, userId, userId);
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.root_id, r.subtask_estimate_sum);
  }
  return map;
}

/**
 * Batch loads subtasks, checklist items, tags, and computes estimateTotal rollup (root estimate + all descendant estimates)
 * in at most 4 batch queries total with zero N+1.
 */
export async function getTasksWithIncludes<T extends { id: string; userId: string; estimateMin?: number | null }>(
  taskList: T[],
  includeParam?: string | string[] | null,
  userId?: string
): Promise<Array<T & { subtasks?: any[]; checklist?: any[]; tags?: any[]; estimateTotal: number | null }>> {
  if (taskList.length === 0) {
    return [];
  }

  const effectiveUserId = userId ?? taskList[0].userId;
  const taskIds = taskList.map((t) => t.id);

  // Compute descendant estimate sums for all tasks in taskList
  const descendantEstimateMap = computeEstimateTotals(taskIds, effectiveUserId);

  const includeParts = (
    Array.isArray(includeParam)
      ? includeParam.join(",")
      : (includeParam ?? "")
  )
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const shouldIncludeSubtasks = includeParts.includes("subtasks");
  const shouldIncludeChecklist = includeParts.includes("checklist");
  const shouldIncludeTags = includeParts.includes("tags");

  const [subtasksRows, checklistRows, tagRows] = await Promise.all([
    shouldIncludeSubtasks
      ? db
          .select()
          .from(schema.tasks)
          .where(
            and(
              inArray(schema.tasks.parentId, taskIds),
              eq(schema.tasks.userId, effectiveUserId),
              isNull(schema.tasks.deletedAt)
            )
          )
          .orderBy(asc(schema.tasks.position), asc(schema.tasks.id))
      : Promise.resolve([]),

    shouldIncludeChecklist
      ? db
          .select()
          .from(schema.checklistItems)
          .where(
            and(
              inArray(schema.checklistItems.taskId, taskIds),
              eq(schema.checklistItems.userId, effectiveUserId),
              isNull(schema.checklistItems.deletedAt)
            )
          )
          .orderBy(asc(schema.checklistItems.position))
      : Promise.resolve([]),

    shouldIncludeTags
      ? db
          .select({
            taskId: schema.taskTags.taskId,
            tag: schema.tags,
          })
          .from(schema.taskTags)
          .innerJoin(schema.tags, eq(schema.taskTags.tagId, schema.tags.id))
          .where(
            and(
              inArray(schema.taskTags.taskId, taskIds),
              eq(schema.tags.userId, effectiveUserId),
              isNull(schema.tags.deletedAt)
            )
          )
          .orderBy(asc(schema.tags.name))
      : Promise.resolve([]),
  ]);

  // If subtasks are included, compute estimateTotals for direct subtasks as well
  let subtaskEstimateMap = new Map<string, number>();
  if (shouldIncludeSubtasks && subtasksRows.length > 0) {
    const subtaskIds = subtasksRows.map((s) => s.id);
    subtaskEstimateMap = computeEstimateTotals(subtaskIds, effectiveUserId);
  }

  // Group subtasks by parent task ID
  const subtasksByParent = new Map<string, any[]>();
  for (const st of subtasksRows) {
    if (st.parentId) {
      if (!subtasksByParent.has(st.parentId)) {
        subtasksByParent.set(st.parentId, []);
      }
      const stSubSum = subtaskEstimateMap.get(st.id);
      const stEstimate = st.estimateMin ?? null;
      let stEstimateTotal: number | null = null;
      if (stEstimate !== null || stSubSum !== undefined) {
        stEstimateTotal = (stEstimate ?? 0) + (stSubSum ?? 0);
      }
      subtasksByParent.get(st.parentId)!.push({
        ...st,
        estimateTotal: stEstimateTotal,
      });
    }
  }

  // Group checklist items by task ID
  const checklistByTask = new Map<string, any[]>();
  for (const item of checklistRows) {
    if (!checklistByTask.has(item.taskId)) {
      checklistByTask.set(item.taskId, []);
    }
    checklistByTask.get(item.taskId)!.push(item);
  }

  // Group tags by task ID
  const tagsByTask = new Map<string, any[]>();
  for (const row of tagRows) {
    if (!tagsByTask.has(row.taskId)) {
      tagsByTask.set(row.taskId, []);
    }
    tagsByTask.get(row.taskId)!.push(row.tag);
  }

  return taskList.map((task) => {
    const subSum = descendantEstimateMap.get(task.id);
    const ownEstimate = task.estimateMin ?? null;
    let estimateTotal: number | null = null;
    if (ownEstimate !== null || subSum !== undefined) {
      estimateTotal = (ownEstimate ?? 0) + (subSum ?? 0);
    }

    return {
      ...task,
      estimateTotal,
      ...(shouldIncludeSubtasks ? { subtasks: subtasksByParent.get(task.id) ?? [] } : {}),
      ...(shouldIncludeChecklist ? { checklist: checklistByTask.get(task.id) ?? [] } : {}),
      ...(shouldIncludeTags ? { tags: tagsByTask.get(task.id) ?? [] } : {}),
    };
  });
}
