"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { syncNow as runSync } from "@/lib/sync/client";
import { getLastSyncAt } from "@/lib/sync/meta";
import { LOCAL_WRITE_EVENT } from "@/lib/sync/mutate";

const POLL_INTERVAL_MS = 60_000;
const LOCAL_WRITE_DEBOUNCE_MS = 300;

export interface UseSyncReturn {
  syncNow: () => Promise<void>;
  lastSyncAt: number;
  error: Error | null;
}

export function useSync(): UseSyncReturn {
  const [lastSyncAt, setLastSyncAt] = useState(0);
  const [error, setError] = useState<Error | null>(null);
  const didInit = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const trigger = useCallback(async () => {
    try {
      await runSync();
      setLastSyncAt(await getLastSyncAt());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error("Sync failed"));
    }
  }, []);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    void trigger();
  }, [trigger]);

  useEffect(() => {
    const onOnline = () => {
      void trigger();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void trigger();
      }
    };
    const onLocalWrite = () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        void trigger();
      }, LOCAL_WRITE_DEBOUNCE_MS);
    };

    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(LOCAL_WRITE_EVENT, onLocalWrite);
    const interval = setInterval(() => {
      void trigger();
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(LOCAL_WRITE_EVENT, onLocalWrite);
      clearInterval(interval);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [trigger]);

  return { syncNow: trigger, lastSyncAt, error };
}
