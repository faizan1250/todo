"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { ServerIcon, RefreshIcon } from "./icons";

export function BackendStatusBadge() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();

  const pingBackend = useCallback(async () => {
    const startTime = performance.now();
    try {
      const response = await fetch("http://localhost:3001/health", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      await response.json();
      const duration = Math.round(performance.now() - startTime);

      startTransition(() => {
        setLatencyMs(duration);
        setStatus("online");
      });
    } catch {
      startTransition(() => {
        setLatencyMs(null);
        setStatus("offline");
      });
    }
  }, []);

  const handleManualRefresh = () => {
    setStatus("checking");
    void pingBackend();
  };

  useEffect(() => {
    let ignore = false;
    const fetchInitial = async () => {
      const startTime = performance.now();
      try {
        const response = await fetch("http://localhost:3001/health", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        await response.json();
        const duration = Math.round(performance.now() - startTime);

        if (!ignore) {
          setLatencyMs(duration);
          setStatus("online");
        }
      } catch {
        if (!ignore) {
          setLatencyMs(null);
          setStatus("offline");
        }
      }
    };

    void fetchInitial();

    const interval = setInterval(() => {
      void pingBackend();
    }, 15000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [pingBackend]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-2.5 rounded-full border border-zinc-200/80 bg-zinc-50/80 px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-xs backdrop-blur-xs transition-colors dark:border-zinc-800/80 dark:bg-zinc-900/60 dark:text-zinc-300"
    >
      <div className="flex items-center gap-1.5">
        <ServerIcon className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-400" />
        <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
          :3001
        </span>
      </div>

      <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-800" aria-hidden="true" />

      {status === "checking" && (
        <span className="inline-flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
          </span>
          <span>Connecting...</span>
        </span>
      )}

      {status === "online" && (
        <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
          </span>
          <span className="font-medium">Backend Ready</span>
          {latencyMs !== null && (
            <span className="font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              {latencyMs}ms
            </span>
          )}
        </span>
      )}

      {status === "offline" && (
        <span className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
          <span className="h-2 w-2 rounded-full bg-zinc-400 dark:bg-zinc-600" />
          <span>Backend Standby</span>
        </span>
      )}

      <button
        type="button"
        onClick={handleManualRefresh}
        disabled={status === "checking" || isPending}
        className="ml-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-700 focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        title="Refresh backend status"
        aria-label="Refresh backend status"
      >
        <RefreshIcon
          className={`h-3 w-3 ${status === "checking" || isPending ? "animate-spin" : ""}`}
        />
      </button>
    </div>
  );
}
