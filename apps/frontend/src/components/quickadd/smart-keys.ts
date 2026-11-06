/**
 * Local-storage flags for smart quick-add.
 *
 * Smart typing is ON by default. All access is SSR-safe and never throws
 * (private-mode Safari, tests, prerender): failures fall back to defaults.
 */

export const SMART_TYPING_KEY = "qa-smart-typing";
export const SMART_TIP_KEY = "qa-smart-tip-seen";

function readFlag(key: string, defaultValue: boolean): boolean {
  try {
    if (typeof window === "undefined" || !window.localStorage) return defaultValue;
    const raw = window.localStorage.getItem(key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return defaultValue;
  } catch {
    return defaultValue;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    if (typeof window === "undefined" || !window.localStorage) return;
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // Storage unavailable (private mode, SSR) — smart defaults still apply.
  }
}

/** Smart typing switch. ON by default; persisted in localStorage only. */
export function isSmartTypingEnabled(): boolean {
  return readFlag(SMART_TYPING_KEY, true);
}

export function setSmartTypingEnabled(on: boolean): void {
  writeFlag(SMART_TYPING_KEY, on);
}

/** One-time "we parsed your words" tip. */
export function hasSeenSmartTip(): boolean {
  return readFlag(SMART_TIP_KEY, false);
}

export function markSmartTipSeen(): void {
  writeFlag(SMART_TIP_KEY, true);
}
