import { and, asc, eq, isNull, ne, sql, type SQL } from "drizzle-orm";
import type { SQLiteTable, SQLiteColumn } from "drizzle-orm/sqlite-core";
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { db } from "../db";

export { generateKeyBetween, generateNKeysBetween };

export interface ScopeQuery {
  table: SQLiteTable & {
    id: SQLiteColumn;
    position: SQLiteColumn;
    deletedAt?: SQLiteColumn;
    version?: SQLiteColumn;
    updatedAt?: SQLiteColumn;
  };
  where?: SQL;
  excludeId?: string;
}

/**
 * Calculates a fractional index position between afterId and beforeId within a scope.
 * 
 * - If neither afterId nor beforeId is given, places the item at the end: generateKeyBetween(lastPosition, null).
 * - If afterId and/or beforeId are given, finds their positions and generates a key between them.
 * - If a collision occurs or generateKeyBetween throws, rebalances the entire scope in a single transaction
 *   and recalculates.
 */
export async function positionBetween(
  scope: ScopeQuery,
  afterId?: string | null,
  beforeId?: string | null
): Promise<string> {
  const conditions: SQL[] = [];
  if (scope.table.deletedAt) {
    conditions.push(isNull(scope.table.deletedAt));
  }
  if (scope.where) {
    conditions.push(scope.where);
  }
  if (scope.excludeId) {
    conditions.push(ne(scope.table.id, scope.excludeId));
  }

  const items = await db
    .select({
      id: scope.table.id,
      position: scope.table.position,
    })
    .from(scope.table)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(scope.table.position));

  // Case 1: Place at the end
  if (!afterId && !beforeId) {
    const lastPos = items.length > 0 ? (items[items.length - 1].position as string) : null;
    return generateKeyBetween(lastPos, null);
  }

  // Case 2: Resolve a and b from IDs
  let a: string | null = null;
  let b: string | null = null;

  const afterIndex = afterId ? items.findIndex((it) => it.id === afterId) : -1;
  const beforeIndex = beforeId ? items.findIndex((it) => it.id === beforeId) : -1;

  if (afterId && afterIndex !== -1) {
    a = items[afterIndex].position as string;
  }
  if (beforeId && beforeIndex !== -1) {
    b = items[beforeIndex].position as string;
  }

  if (afterId && !beforeId) {
    b = afterIndex !== -1 && afterIndex + 1 < items.length ? (items[afterIndex + 1].position as string) : null;
  }
  if (beforeId && !afterId) {
    a = beforeIndex !== -1 && beforeIndex > 0 ? (items[beforeIndex - 1].position as string) : null;
  }

  // Check if initial generation succeeds without collision
  let key: string | null = null;
  let needsRebalance = false;

  try {
    key = generateKeyBetween(a, b);
    if (key === a || key === b || items.some((it) => it.position === key)) {
      needsRebalance = true;
    }
  } catch {
    needsRebalance = true;
  }

  if (!needsRebalance && key !== null) {
    return key;
  }

  // Rebalance scope in a transaction and recalculate
  return await db.transaction(async (tx) => {
    const newPositions = generateNKeysBetween(null, null, items.length);

    for (let i = 0; i < items.length; i++) {
      const updateData: Record<string, unknown> = {
        position: newPositions[i],
        updatedAt: new Date(),
      };
      if (scope.table.version) {
        updateData.version = sql`version + 1`;
      }
      await tx
        .update(scope.table)
        .set(updateData)
        .where(eq(scope.table.id, items[i].id));
    }

    let rebalancedA: string | null = null;
    let rebalancedB: string | null = null;

    if (afterIndex !== -1) {
      rebalancedA = newPositions[afterIndex];
    }
    if (beforeIndex !== -1) {
      rebalancedB = newPositions[beforeIndex];
    }

    if (afterId && beforeId && afterIndex !== -1 && beforeIndex !== -1 && afterIndex >= beforeIndex) {
      // Inverted boundaries fixup: place right after afterId
      rebalancedB = afterIndex + 1 < newPositions.length ? newPositions[afterIndex + 1] : null;
    } else if (afterId && !beforeId) {
      rebalancedB = afterIndex !== -1 && afterIndex + 1 < newPositions.length ? newPositions[afterIndex + 1] : null;
    } else if (beforeId && !afterId) {
      rebalancedA = beforeIndex !== -1 && beforeIndex > 0 ? newPositions[beforeIndex - 1] : null;
    }

    return generateKeyBetween(rebalancedA, rebalancedB);
  });
}
