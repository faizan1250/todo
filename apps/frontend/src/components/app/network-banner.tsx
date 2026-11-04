"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { WifiOff, RefreshCw, X, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE_URL } from "@/lib/auth-client";

export interface NetworkBannerProps {
  className?: string;
  forceOffline?: boolean;
}

export function NetworkBanner({ className, forceOffline }: NetworkBannerProps) {
  const [isOffline, setIsOffline] = useState(forceOffline ?? false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  const checkConnectivity = useCallback(async () => {
    if (forceOffline !== undefined) {
      setIsOffline(forceOffline);
      return;
    }

    // Check browser offline status
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
      return;
    }

    // Ping backend health
    try {
      setIsRetrying(true);
      const res = await fetch(`${API_BASE_URL}/health`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (res.ok) {
        setIsOffline(false);
        setIsDismissed(false); // Reset dismissal when back online
      } else {
        setIsOffline(true);
      }
    } catch {
      setIsOffline(true);
    } finally {
      setIsRetrying(false);
    }
  }, [forceOffline]);

  useEffect(() => {
    if (forceOffline !== undefined) {
      setIsOffline(forceOffline);
      return;
    }

    void checkConnectivity();

    const handleWindowOnline = () => {
      void checkConnectivity();
    };

    const handleWindowOffline = () => {
      setIsOffline(true);
      setIsDismissed(false);
    };

    window.addEventListener("online", handleWindowOnline);
    window.addEventListener("offline", handleWindowOffline);

    const interval = setInterval(() => {
      void checkConnectivity();
    }, 20000);

    return () => {
      window.removeEventListener("online", handleWindowOnline);
      window.removeEventListener("offline", handleWindowOffline);
      clearInterval(interval);
    };
  }, [checkConnectivity, forceOffline]);

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
          onClick={() => void checkConnectivity()}
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
