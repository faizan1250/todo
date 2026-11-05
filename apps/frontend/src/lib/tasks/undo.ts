// Undo inverse-stack (Phase 2 premium 1b).
//
// Pure logic: maps a forward mutation to the mutation that undoes it.
// No Dexie dependency — the caller captures the before-image (status,
// parent/list/section/position, tags, …) before applying the forward
// mutation, then pushUndo()es the inverse for the toast action to replay
// via mutate().
//
// Every inverse is MutateInput-compatible, so popUndo() results feed
// straight into mutate(). Domain aliases outside MutateOp ("reopen",
// "archive", "unarchive") are accepted as forward ops and always lower to
// a mutate-compatible op.

import type { MutateInput, MutateOp } from "../data/mutate";

export type UndoableOp = MutateOp | "reopen" | "archive" | "unarchive";

export interface UndoableMutation {
  entity: string;
  op: UndoableOp;
  entityId: string;
  patch?: Record<string, unknown>;
}

/** Before-image captured ahead of the forward mutation. */
export interface BeforeImage {
  /** Full field patch the update overwrote. */
  beforePatch?: Record<string, unknown>;
  beforeStatus?: string;
  beforeCompletedAt?: number | null;
  beforeParent?: string | null;
  beforeList?: string;
  beforeSection?: string | null;
  beforePosition?: string;
  beforeTagIds?: string[];
  beforeArchivedAt?: number | null;
}

/** Return the mutation that undoes `mutation`. Throws when the required
 *  before-image is missing. */
export function inverseOf(
  mutation: UndoableMutation,
  before: BeforeImage = {}
): MutateInput {
  const { entity, op, entityId } = mutation;
  switch (op) {
    case "create":
      return { entity, op: "delete", entityId };
    case "delete":
      // The engine tombstones on delete; re-creating over a tombstone
      // would keep deleted=1, so the true undo is restore (clears the
      // tombstone and revives same-stamp descendants).
      return { entity, op: "restore", entityId, patch: {} };
    case "restore":
      return { entity, op: "delete", entityId };
    case "update": {
      if (before.beforePatch === undefined) {
        throw new Error("inverseOf(update) requires beforePatch");
      }
      return {
        entity,
        op: "update",
        entityId,
        patch: { ...before.beforePatch },
      };
    }
    case "complete":
      return {
        entity,
        op: "update",
        entityId,
        patch: {
          status: before.beforeStatus ?? "todo",
          completedAt: before.beforeCompletedAt ?? null,
        },
      };
    case "reopen":
      return { entity, op: "complete", entityId, patch: {} };
    case "move": {
      if (
        before.beforeParent === undefined ||
        before.beforeList === undefined ||
        before.beforeSection === undefined ||
        before.beforePosition === undefined
      ) {
        throw new Error(
          "inverseOf(move) requires beforeParent/beforeList/beforeSection/beforePosition"
        );
      }
      return {
        entity,
        op: "move",
        entityId,
        patch: {
          parentId: before.beforeParent,
          listId: before.beforeList,
          sectionId: before.beforeSection,
          position: before.beforePosition,
        },
      };
    }
    case "archive":
      return { entity, op: "update", entityId, patch: { archivedAt: null } };
    case "unarchive": {
      if (before.beforeArchivedAt === undefined) {
        throw new Error("inverseOf(unarchive) requires beforeArchivedAt");
      }
      return {
        entity,
        op: "update",
        entityId,
        patch: { archivedAt: before.beforeArchivedAt },
      };
    }
    case "setTags": {
      if (before.beforeTagIds === undefined) {
        throw new Error("inverseOf(setTags) requires beforeTagIds");
      }
      return {
        entity,
        op: "setTags",
        entityId,
        patch: { tagIds: [...before.beforeTagIds] },
      };
    }
    default:
      throw new Error(`Unknown op: ${op}`);
  }
}

const MAX_UNDO = 20;

const stack: MutateInput[] = [];

/** Push an inverse onto the undo stack (drops the oldest past 20). */
export function pushUndo(inverse: MutateInput): void {
  stack.push(inverse);
  while (stack.length > MAX_UNDO) stack.shift();
}

/** Pop the most recent inverse, or undefined when the stack is empty. */
export function popUndo(): MutateInput | undefined {
  return stack.pop();
}

/** Empty the undo stack. */
export function clearUndo(): void {
  stack.length = 0;
}
