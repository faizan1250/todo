"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { updateCurrentProfile } from "@/lib/api";
import { copy } from "@/lib/copy";

const SEEN_PREFIX = "tz-banner-seen:";

function seenKey(accountTz: string, deviceTz: string): string {
  return `${SEEN_PREFIX}${accountTz}>>${deviceTz}`;
}

/** Pure visibility rule: mismatch, and this exact change not yet acknowledged. */
export function shouldShowTimeZoneBanner(
  accountTz: string | null | undefined,
  deviceTz: string,
  seen: (key: string) => boolean
): boolean {
  if (!accountTz || accountTz === deviceTz) return false;
  return !seen(seenKey(accountTz, deviceTz));
}

export function TimeZoneBanner() {
  const { profile, setProfile } = useAuth();
  const [deviceTz, setDeviceTz] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        setDeviceTz(Intl.DateTimeFormat().resolvedOptions().timeZone);
      } catch {
        setDeviceTz(null);
      }
    });
  }, []);

  const accountTz = profile?.timezone ?? null;
  if (!deviceTz || dismissed) return null;
  if (!shouldShowTimeZoneBanner(accountTz, deviceTz, (k) => {
    try {
      return window.localStorage.getItem(k) === "1";
    } catch {
      return true;
    }
  })) {
    return null;
  }

  const acknowledge = (key: string) => {
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      // Private mode: banner simply reappears next visit.
    }
    setDismissed(true);
  };

  const handleUseDevice = async () => {
    setIsSaving(true);
    try {
      const updated = await updateCurrentProfile({ timezone: deviceTz });
      setProfile(updated);
    } catch {
      // Keep the banner up so the user can retry.
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    acknowledge(seenKey(accountTz as string, deviceTz));
  };

  const handleKeepAccount = () => {
    acknowledge(seenKey(accountTz as string, deviceTz));
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="border-b border-[#E4E8F2] bg-amber-50 px-4 py-2.5 dark:border-[#132E74] dark:bg-amber-950/40"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-amber-900 dark:text-amber-200">
        <p className="min-w-0 flex-1">{copy.scheduling.timezone.mismatch(deviceTz, accountTz as string)}</p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={handleUseDevice}
            disabled={isSaving}
            className="rounded-lg bg-[#09318D] px-2.5 py-1 font-semibold text-white transition-colors hover:bg-[#0B3EA8] disabled:opacity-50 dark:bg-[#FD91CC] dark:text-[#051A4D] cursor-pointer"
          >
            {isSaving ? "Saving…" : copy.scheduling.timezone.useDevice}
          </button>
          <button
            type="button"
            onClick={handleKeepAccount}
            disabled={isSaving}
            className="rounded-lg border border-amber-300 px-2.5 py-1 font-semibold transition-colors hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:hover:bg-amber-900/40 cursor-pointer"
          >
            {copy.scheduling.timezone.keepAccount}
          </button>
        </div>
      </div>
    </div>
  );
}
