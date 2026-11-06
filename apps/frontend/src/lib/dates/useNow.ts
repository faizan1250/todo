"use client";

import { useEffect, useState } from "react";

/**
 * Current time that re-renders on minute boundaries.
 * Browsers expose no timezone-change event, so each tick also compares
 * getTimezoneOffset() and refreshes immediately when the device zone
 * shifts (travel, DST flip, manual change). Also refreshes on
 * visibilitychange/focus so a backgrounded tab never shows stale labels.
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastOffset = new Date().getTimezoneOffset();

    const tick = (): void => {
      lastOffset = new Date().getTimezoneOffset();
      setNow(new Date());
      schedule();
    };

    const schedule = (): void => {
      const current = new Date();
      const msToNextMinute =
        60_000 - (current.getSeconds() * 1000 + current.getMilliseconds());
      timer = setTimeout(tick, Math.max(msToNextMinute, 1000));
    };

    const refresh = (): void => {
      const offset = new Date().getTimezoneOffset();
      if (offset !== lastOffset) {
        // Zone shifted: restart alignment from the new wall clock.
        lastOffset = offset;
        if (timer) clearTimeout(timer);
        setNow(new Date());
        schedule();
      } else {
        setNow(new Date());
      }
    };

    schedule();
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return now;
}
