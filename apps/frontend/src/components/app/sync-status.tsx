"use client";

import * as React from "react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";
import { useSync } from "@/hooks/useSync";
import { getPending } from "@/lib/sync/outbox";
import { LOCAL_WRITE_EVENT } from "@/lib/sync/mutate";
import { SyncUpdateRequired } from "@/lib/sync/client";

const PENDING_POLL_MS = 5_000;

const subscribeOnline = (callback: () => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};

const getOnlineSnapshot = () =>
  typeof navigator !== "undefined" ? navigator.onLine : true;
const getServerSnapshot = () => true;

function formatLastSyncAt(timestamp: number): string | null {
  if (!timestamp) return null;
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  if (sameDay) return `Today, ${time}`;
  return (
    date.toLocaleDateString([], { month: "short", day: "numeric" }) +
    `, ${time}`
  );
}

export interface SyncStatusProps {
  className?: string;
}

export function SyncStatus({ className }: SyncStatusProps) {
  const { lastSyncAt, error } = useSync();
  const isBrowserOnline = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerSnapshot,
  );
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const items = await getPending();
        if (!cancelled) setPending(items.length);
      } catch {
        // Outbox unreadable (e.g. DB not ready) — keep last known count.
      }
    };
    void refresh();
    const interval = setInterval(() => {
      void refresh();
    }, PENDING_POLL_MS);
    window.addEventListener(LOCAL_WRITE_EVENT, refresh);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(LOCAL_WRITE_EVENT, refresh);
    };
  }, []);

  // Re-check the outbox shortly after a sync lands.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const items = await getPending();
        if (!cancelled) setPending(items.length);
      } catch {
        // Keep last known count.
      }
    };
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [lastSyncAt]);

  const needsUpdate =
    error instanceof SyncUpdateRequired ||
    error?.name === "SyncUpdateRequired";

  const online = isBrowserOnline;
  const saving = pending > 0;
  const lastSyncLabel = formatLastSyncAt(lastSyncAt);

  let text: string;
  let dotClass: string;
  if (needsUpdate) {
    text = "Please refresh to get the latest update.";
    dotClass = "bg-danger";
  } else if (!online) {
    text =
      "You're offline. Changes are saved on this device and will sync later.";
    dotClass = "bg-warning";
  } else if (saving) {
    text =
      pending === 1 ? "Saving 1 change…" : `Saving ${pending} changes…`;
    dotClass = "bg-warning";
  } else {
    text =
      lastSyncLabel !== null
        ? `All changes saved · ${lastSyncLabel}`
        : "All changes saved";
    dotClass = "bg-success";
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-fg-muted",
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass)} />
      <span className="truncate">{text}</span>
      {needsUpdate ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="focus-ring-pink shrink-0 cursor-pointer rounded-sm font-semibold text-fg underline underline-offset-2 hover:text-primary"
        >
          Refresh
        </button>
      ) : null}
    </div>
  );
}
