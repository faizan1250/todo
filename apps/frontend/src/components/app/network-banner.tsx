"use client";

import * as React from "react";
import { useState, useEffect, useCallback, useSyncExternalStore } from "react";
import { WifiOff, RefreshCw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE_URL } from "@/lib/auth-client";

export interface NetworkBannerProps {
  className?: string;
  forceOffline?: boolean;
}

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

export function NetworkBanner({ className, forceOffline }: NetworkBannerProps) {
  const isBrowserOnline = useSyncExternalStore(
    subscribeOnline,
    getOnlineSnapshot,
    getServerSnapshot
  );

  const [isServerOffline, setIsServerOffline] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const isOffline =
    forceOffline !== undefined
      ? forceOffline
      : !isBrowserOnline || isServerOffline;

  const pingBackend = useCallback(async () => {
    try {
      setIsRetrying(true);
      const res = await fetch(`${API_BASE_URL}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      setIsServerOffline(!res.ok);
      if (res.ok) {
        setIsDismissed(false);
      }
    } catch {
      setIsServerOffline(true);
    } finally {
      setIsRetrying(false);
    }
  }, []);

  useEffect(() => {
    if (forceOffline !== undefined) return;

    let ignore = false;
    const initialCheck = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/health`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });
        if (!ignore) {
          setIsServerOffline(!res.ok);
        }
      } catch {
        if (!ignore) {
          setIsServerOffline(true);
        }
      }
    };

    void initialCheck();

    const interval = setInterval(() => {
      void pingBackend();
    }, 20000);

    return () => {
      ignore = true;
      clearInterval(interval);
    };
  }, [forceOffline, pingBackend]);

  if (!isOffline || isDismissed) {
    return null;
  }

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        "relative flex items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50/95 px-4 py-2.5 text-xs text-amber-900 backdrop-blur-xs transition-all dark:border-amber-900/40 dark:bg-amber-950/80 dark:text-amber-200 select-none",
        className
      )}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-200/80 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5" />
        </div>

        <div className="truncate">
          <span className="font-semibold">Backend Offline (:3001)</span>
          <span className="hidden sm:inline text-amber-800/90 dark:text-amber-300/80 ml-2">
            Running in local resilient mode. Local changes will sync once backend restores.
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => void pingBackend()}
          disabled={isRetrying}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 shadow-2xs hover:bg-amber-100/60 focus-ring-pink disabled:opacity-50 dark:border-amber-800 dark:bg-amber-900/60 dark:text-amber-100 dark:hover:bg-amber-800/80 cursor-pointer"
        >
          <RefreshCw className={cn("h-3 w-3", isRetrying && "animate-spin")} />
          <span>{isRetrying ? "Checking..." : "Retry"}</span>
        </button>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          aria-label="Dismiss offline banner"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-amber-700 hover:bg-amber-200/60 hover:text-amber-900 dark:text-amber-300 dark:hover:bg-amber-900/60 cursor-pointer focus-ring-pink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
