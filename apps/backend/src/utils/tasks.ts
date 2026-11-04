import { sqlite } from "../db";

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
