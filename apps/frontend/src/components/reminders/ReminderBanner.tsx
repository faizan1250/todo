"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

const SEEN_KEY = "todo.reminders-interim-banner-seen";

/**
 * Interim banner shown once — the first time a task carries a reminder.
 * There is no notification infra yet, so this only sets the expectation:
 * reminders will arrive by notification soon. No alerting is attempted.
 * (Follows the InstallGuide pattern: hidden until a client effect reveals it,
 * so server and first-client renders agree.)
 */
export function ReminderBanner({ reminderCount }: { reminderCount: number }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (reminderCount <= 0) return;
    let cancelled = false;
    try {
      if (window.localStorage.getItem(SEEN_KEY)) return;
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Storage unavailable — still show this once, never break.
    }
    const t = window.setTimeout(() => {
      if (!cancelled) setOpen(true);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [reminderCount]);

  if (!open) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border border-[#09318D]/20 bg-[#09318D]/5 px-3 py-2 text-xs text-[#09318D] dark:border-[#FD91CC]/25 dark:bg-[#FD91CC]/10 dark:text-[#FFA8D7]"
    >
      <Bell className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden="true" />
      <p className="flex-1">
        Reminder saved. Reminders will arrive by notification soon.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss reminder notice"
        className="shrink-0 font-medium hover:underline cursor-pointer"
      >
        Got it
      </button>
    </div>
  );
}
