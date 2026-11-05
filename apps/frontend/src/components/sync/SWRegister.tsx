"use client";

import { useEffect } from "react";

// Registers the hand-written app-shell service worker (/sw.js).
// Mount once near the root (cutover) — safe no-op on unsupported browsers.
export function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    const url = "/sw.js";
    void navigator.serviceWorker.register(url).catch(() => {
      // Offline-first is best-effort; a failed registration must not
      // break the app shell.
    });
  }, []);

  return null;
}
