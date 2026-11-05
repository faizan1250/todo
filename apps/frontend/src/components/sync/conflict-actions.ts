// Conflict restore actions (Phase 5 Day 5a).
//
// Thin wrappers over mutate() shared by the conflict toast actions
// (wired at the Day-6 cutover) and HistorySheet. Values from
// GET /api/v1/sync/conflicts are JSON-encoded strings, so parsing is
// defensive: unparseable input falls back to the raw string.

import { mutate } from "@/lib/data/mutate";

export interface RestoreVersionArgs {
  entity: string;
  entityId: string;
  field: string;
  losingValue: string;
}

export function parseConflictValue(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

export function formatConflictValue(raw: string): string {
  const value = parseConflictValue(raw);
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value === "" ? "—" : value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? "—";
  } catch {
    return "—";
  }
}

// Re-applies the losing (overwritten) value as a local update, which the
// push layer then syncs. Throws a plain Error when validation fails.
export async function restoreMyVersion(
  userId: string,
  args: RestoreVersionArgs
): Promise<string> {
  return mutate(userId, {
    entity: args.entity,
    op: "update",
    entityId: args.entityId,
    patch: { [args.field]: parseConflictValue(args.losingValue) },
  });
}

// Revives a locally-tombstoned row (deleted on another device, pulled down
// as a delete). Throws when the local row is not deleted.
export async function restoreFromTrash(
  userId: string,
  entity: string,
  entityId: string
): Promise<string> {
  return mutate(userId, { entity, op: "restore", entityId, patch: {} });
}
