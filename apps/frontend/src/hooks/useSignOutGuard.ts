"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { deleteUserDB } from "@/lib/db/index";
import { getPending as getPendingNew } from "@/lib/sync2/outbox";
import { flushOutbox } from "@/lib/sync2/engine";

export type SignOutResult = "signed-out" | "confirm";

export interface SignOutGuard {
  pendingCount: number;
  isChecking: boolean;
  refresh: () => Promise<number>;
  signOut: (opts?: { force?: boolean }) => Promise<SignOutResult>;
  flushAndSignOut: () => Promise<SignOutResult>;
}

async function countPending(userId: string | null | undefined): Promise<number> {
  if (!userId) return 0;
  // New per-user engine only (Phase 5 local-first outbox). The legacy
  // pre-cutover outbox (old lib/sync engine) is no longer checked: its
  // localMutate entry point had zero call sites, so it was always empty.
  return getPendingNew(userId)
    .then((rows) => rows.length)
    .catch(() => 0);
}

// Guards sign-out against unsynced local edits. Checks the new per-user
// outbox, then either signs out (wipe per-user DB + auth signOut) or
// returns "confirm" so the caller can show SignOutDialog.
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

  // "Save and sign out" path: push the new-engine outbox until empty, then
  // recount. Zero remaining -> proceed with sign-out,
  // otherwise stay on "confirm" so the dialog stays open. Flush failures
  // just surface as a nonzero recount; this never throws for sync reasons.
  const flushAndSignOut = useCallback(async (): Promise<SignOutResult> => {
    if (userId) {
      try {
        await flushOutbox(userId);
      } catch {
        // Recount below decides the outcome.
      }
    }
    const pending = await countPending(userId);
    setPendingCount(pending);
    if (pending > 0) return "confirm";
    if (userId) {
      await deleteUserDB(userId);
    }
    await logout();
    return "signed-out";
  }, [userId, logout]);

  return { pendingCount, isChecking, refresh, signOut, flushAndSignOut };
}
