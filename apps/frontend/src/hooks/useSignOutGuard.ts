"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { deleteUserDB } from "@/lib/db/index";
import { getPending as getPendingLegacy } from "@/lib/sync/outbox";
import { getPending as getPendingNew } from "@/lib/sync2/outbox";

export type SignOutResult = "signed-out" | "confirm";

export interface SignOutGuard {
  pendingCount: number;
  isChecking: boolean;
  refresh: () => Promise<number>;
  signOut: (opts?: { force?: boolean }) => Promise<SignOutResult>;
}

async function countPending(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  const [legacy, next] = await Promise.all([
    // Old single-DB engine (pre-cutover writes may still sit here).
    getPendingLegacy()
      .then((rows) => rows.length)
      .catch(() => 0),
    // New per-user engine (Phase 5 local-first outbox).
    getPendingNew(userId)
      .then((rows) => rows.length)
      .catch(() => 0),
  ]);
  return legacy + next;
}

// Guards sign-out against unsynced local edits. Checks BOTH outboxes — the
// legacy single-DB outbox and the new per-user outbox — then either signs
// out (wipe per-user DB + auth signOut) or returns "confirm" so the caller
// can show SignOutDialog.
export function useSignOutGuard(
  userId: string | null | undefined,
): SignOutGuard {
  const { logout } = useAuth();
  const [pendingCount, setPendingCount] = useState(0);
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    countPending(userId).then((n) => {
      if (cancelled) return;
      setPendingCount(n);
      setIsChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    try {
      const n = await countPending(userId);
      setPendingCount(n);
      return n;
    } finally {
      setIsChecking(false);
    }
  }, [userId]);

  const signOut = useCallback(
    async (opts?: { force?: boolean }): Promise<SignOutResult> => {
      const pending = await countPending(userId);
      setPendingCount(pending);
      if (pending > 0 && !opts?.force) return "confirm";
      if (userId) {
        await deleteUserDB(userId);
      }
      await logout();
      return "signed-out";
    },
    [userId, logout],
  );

  return { pendingCount, isChecking, refresh, signOut };
}
