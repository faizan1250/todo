/** Injectable clock for the notification scheduler. Tests override via setNow. */

let overrideNow: number | null = null;

/** Current time in ms since epoch. Overridable in tests. */
export function now(): number {
  return overrideNow ?? Date.now();
}

/** Current time as a Date. Overridable in tests. */
export function nowDate(): Date {
  return new Date(now());
}

/** Pin the clock (test-only). Pass a ms epoch or Date. */
export function setNow(t: number | Date): void {
  overrideNow = t instanceof Date ? t.getTime() : t;
}

/** Release the pinned clock (test-only). */
export function resetNow(): void {
  overrideNow = null;
}
