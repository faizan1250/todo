import { and, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

export interface PurgeResult {
  tasks: number;
  sections: number;
  lists: number;
  folders: number;
  total: number;
  processedMutations: number;
  syncConflicts: number;
}

/**
 * Purges rows soft-deleted before the thresholdDate in batches of batchSize per transaction.
 * Leaf-to-root order: tasks -> sections -> lists (excluding inbox) -> folders.
 *
 * @param thresholdDate - Cutoff date (defaults to 30 days ago)
 * @param batchSize - Batch size for deletion (defaults to 500)
 */
export async function purgeOldSoftDeleted(
  thresholdDate?: Date,
  batchSize: number = 500
): Promise<PurgeResult> {
  const threshold = thresholdDate ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  let totalTasks = 0;
  while (true) {
    const batch = await db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(and(isNotNull(schema.tasks.deletedAt), lt(schema.tasks.deletedAt, threshold)))
      .limit(batchSize);

    if (batch.length === 0) break;
    const ids = batch.map((r) => r.id);

    await db.transaction(async (tx) => {
      await tx.delete(schema.tasks).where(inArray(schema.tasks.id, ids));
    });

    totalTasks += ids.length;
    if (ids.length < batchSize) break;
  }

  let totalSections = 0;
  while (true) {
    const batch = await db
      .select({ id: schema.sections.id })
      .from(schema.sections)
      .where(and(isNotNull(schema.sections.deletedAt), lt(schema.sections.deletedAt, threshold)))
      .limit(batchSize);

    if (batch.length === 0) break;
    const ids = batch.map((r) => r.id);

    await db.transaction(async (tx) => {
      await tx.delete(schema.sections).where(inArray(schema.sections.id, ids));
    });

    totalSections += ids.length;
    if (ids.length < batchSize) break;
  }

  let totalLists = 0;
  while (true) {
    const batch = await db
      .select({ id: schema.lists.id })
      .from(schema.lists)
      .where(
        and(
          isNotNull(schema.lists.deletedAt),
          lt(schema.lists.deletedAt, threshold),
          eq(schema.lists.isInbox, false)
        )
      )
      .limit(batchSize);

    if (batch.length === 0) break;
    const ids = batch.map((r) => r.id);

    await db.transaction(async (tx) => {
      await tx.delete(schema.lists).where(inArray(schema.lists.id, ids));
    });

    totalLists += ids.length;
    if (ids.length < batchSize) break;
  }

  let totalFolders = 0;
  while (true) {
    const batch = await db
      .select({ id: schema.folders.id })
      .from(schema.folders)
      .where(and(isNotNull(schema.folders.deletedAt), lt(schema.folders.deletedAt, threshold)))
      .limit(batchSize);

    if (batch.length === 0) break;
    const ids = batch.map((r) => r.id);

    await db.transaction(async (tx) => {
      await tx.delete(schema.folders).where(inArray(schema.folders.id, ids));
    });

    totalFolders += ids.length;
    if (ids.length < batchSize) break;
  }

  const total = totalTasks + totalSections + totalLists + totalFolders;

  // Advance min_valid_seq so stale cursors that may have missed hard-deleted
  // rows get a clean 409 resync instead of silently missing deletes.
  if (total > 0) {
    const state = db.select().from(schema.syncState).get();
    if (state) {
      await db
        .update(schema.syncState)
        .set({ minValidSeq: state.seq });
    }
  }

  // Purge old sync bookkeeping rows (35-day retention).
  const syncCutoff = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);

  let processedMutations = 0;
  while (true) {
    const batch = await db
      .select({ userId: schema.processedMutations.userId, id: schema.processedMutations.id })
      .from(schema.processedMutations)
      .where(lt(schema.processedMutations.createdAt, syncCutoff))
      .limit(batchSize);

    if (batch.length === 0) break;

    await db.transaction(async (tx) => {
      for (const row of batch) {
        await tx
          .delete(schema.processedMutations)
          .where(
            and(
              eq(schema.processedMutations.userId, row.userId),
              eq(schema.processedMutations.id, row.id)
            )
          );
      }
    });

    processedMutations += batch.length;
    if (batch.length < batchSize) break;
  }

  let syncConflicts = 0;
  while (true) {
    const batch = await db
      .select({ id: schema.syncConflicts.id })
      .from(schema.syncConflicts)
      .where(lt(schema.syncConflicts.at, syncCutoff))
      .limit(batchSize);

    if (batch.length === 0) break;
    const ids = batch.map((r) => r.id);

    await db.transaction(async (tx) => {
      await tx.delete(schema.syncConflicts).where(inArray(schema.syncConflicts.id, ids));
    });

    syncConflicts += ids.length;
    if (ids.length < batchSize) break;
  }

  console.log(
    `[Purge] Soft-deleted purge before ${threshold.toISOString()}: tasks=${totalTasks}, sections=${totalSections}, lists=${totalLists}, folders=${totalFolders}, total=${total}, processedMutations=${processedMutations}, syncConflicts=${syncConflicts}`
  );

  return {
    tasks: totalTasks,
    sections: totalSections,
    lists: totalLists,
    folders: totalFolders,
    total,
    processedMutations,
    syncConflicts,
  };
}

export interface NotificationRetentionResult {
  notifications: number;
  deliveries: number;
  digestLogs: number;
}

/**
 * Phase 6 notification retention (Day 6).
 *
 * Batched hard-deletes, oldest first:
 *   notifications >90d (FK cascade removes their deliveries),
 *   deliveries >30d (by createdAt),
 *   digest_log >1yr (by sentAt).
 */
export async function purgeNotificationRetention(
  nowDate: Date = new Date(),
  batchSize: number = 500
): Promise<NotificationRetentionResult> {
  const notifCutoff = new Date(nowDate.getTime() - 90 * 24 * 60 * 60 * 1000);
  const deliveryCutoff = new Date(nowDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  const digestCutoff = new Date(nowDate.getTime() - 365 * 24 * 60 * 60 * 1000);

  let notifications = 0;
  while (true) {
    const batch = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(lt(schema.notifications.createdAt, notifCutoff))
      .limit(batchSize);
    if (batch.length === 0) break;
    const ids = batch.map((r) => r.id);
    await db.transaction(async (tx) => {
      await tx.delete(schema.notifications).where(inArray(schema.notifications.id, ids));
    });
    notifications += ids.length;
    if (ids.length < batchSize) break;
  }

  let deliveries = 0;
  while (true) {
    const batch = await db
      .select({ id: schema.notificationDeliveries.id })
      .from(schema.notificationDeliveries)
      .where(lt(schema.notificationDeliveries.createdAt, deliveryCutoff))
      .limit(batchSize);
    if (batch.length === 0) break;
    const ids = batch.map((r) => r.id);
    await db.transaction(async (tx) => {
      await tx.delete(schema.notificationDeliveries).where(inArray(schema.notificationDeliveries.id, ids));
    });
    deliveries += ids.length;
    if (ids.length < batchSize) break;
  }

  let digestLogs = 0;
  while (true) {
    const batch = await db
      .select({
        userId: schema.digestLog.userId,
        kind: schema.digestLog.kind,
        localDate: schema.digestLog.localDate,
      })
      .from(schema.digestLog)
      .where(lt(schema.digestLog.sentAt, digestCutoff))
      .limit(batchSize);
    if (batch.length === 0) break;
    await db.transaction(async (tx) => {
      for (const row of batch) {
        await tx
          .delete(schema.digestLog)
          .where(
            and(
              eq(schema.digestLog.userId, row.userId),
              eq(schema.digestLog.kind, row.kind),
              eq(schema.digestLog.localDate, row.localDate)
            )
          );
      }
    });
    digestLogs += batch.length;
    if (batch.length < batchSize) break;
  }

  console.log(
    `[Purge] Notification retention: notifications=${notifications}, deliveries=${deliveries}, digestLogs=${digestLogs}`
  );

  return { notifications, deliveries, digestLogs };
}
