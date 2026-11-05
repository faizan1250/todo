import { and, eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

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

function applyMutation(tx: any, userId: string, m: Mutation): MutationResult {
  return { id: m.id, status: 'rejected', reason: 'not_implemented' };
}

export function processMutations(
  userId: string,
  deviceId: string | null,
  mutations: Mutation[]
): MutationResult[] {
  const results: MutationResult[] = [];
  for (const mutation of mutations) {
    const stored = db
      .select()
      .from(schema.processedMutations)
      .where(
        and(
          eq(schema.processedMutations.userId, userId),
          eq(schema.processedMutations.id, mutation.id)
        )
      )
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
      results.push({ id: mutation.id, status: 'duplicate', version, seq });
      continue;
    }

    const result = db.transaction((tx) => {
      const r = applyMutation(tx, userId, mutation);
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