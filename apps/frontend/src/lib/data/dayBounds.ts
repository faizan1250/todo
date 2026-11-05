// Minimal port of backend dayBounds (apps/backend/src/utils/dates.ts) for
// local Dexie view queries. No luxon dependency: uses Intl for tz math.
//
// Returns UTC-ms bounds for a local day plus the floating (all-day) bounds,
// which are UTC midnights of the local calendar date.

export interface DayBoundsMs {
  /** Start of the local day, UTC ms (handles DST: day may be 23/25h). */
  start: number;
  /** Start of the next local day, UTC ms. */
  end: number;
  /** UTC midnight of the local calendar date (all-day range start). */
  floatStart: number;
  /** UTC midnight of the next local calendar date (all-day range end). */
  floatEnd: number;
  /** Local calendar date YYYY-MM-DD. */
  localDate: string;
}

const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function resolveTz(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

const YMD_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();
const FULL_FMT_CACHE = new Map<string, Intl.DateTimeFormat>();

function ymdFmt(zone: string): Intl.DateTimeFormat {
  let f = YMD_FMT_CACHE.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    YMD_FMT_CACHE.set(zone, f);
  }
  return f;
}

function fullFmt(zone: string): Intl.DateTimeFormat {
  let f = FULL_FMT_CACHE.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    FULL_FMT_CACHE.set(zone, f);
  }
  return f;
}

function numPart(parts: Intl.DateTimeFormatPart[], type: string): number {
  for (const p of parts) {
    if (p.type === type) return Number(p.value);
  }
  return 0;
}

/** Offset (local-as-UTC minus utc) in ms for an instant in `zone`. */
function offsetAt(utcMs: number, zone: string): number {
  const parts = fullFmt(zone).formatToParts(new Date(utcMs));
  const asUtc = Date.UTC(
    numPart(parts, "year"),
    numPart(parts, "month") - 1,
    numPart(parts, "day"),
    numPart(parts, "hour"),
    numPart(parts, "minute"),
    numPart(parts, "second")
  );
  return asUtc - utcMs;
}

/** UTC ms of local midnight for a calendar date in `zone` (2-pass DST fix). */
function localMidnightMs(y: number, m: number, d: number, zone: string): number {
  let off = offsetAt(Date.UTC(y, m - 1, d, 12, 0, 0), zone);
  let ms = Date.UTC(y, m - 1, d, 0, 0, 0) - off;
  off = offsetAt(ms, zone);
  ms = Date.UTC(y, m - 1, d, 0, 0, 0) - off;
  return ms;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayBounds(
  date: Date | number | string,
  tz = "UTC"
): DayBoundsMs {
  const zone = resolveTz(tz);

  let y = 0;
  let m = 0;
  let d = 0;
  if (typeof date === "string") {
    const trimmed = date.trim();
    const only = DATE_ONLY_RE.exec(trimmed);
    if (only) {
      y = Number(only[1]);
      m = Number(only[2]);
      d = Number(only[3]);
    } else {
      const parsed = new Date(trimmed).getTime();
      const ms = Number.isNaN(parsed) ? Date.now() : parsed;
      const parts = ymdFmt(zone).formatToParts(new Date(ms));
      y = numPart(parts, "year");
      m = numPart(parts, "month");
      d = numPart(parts, "day");
    }
  } else {
    const ms = date instanceof Date ? date.getTime() : date;
    const safe = typeof ms === "number" && Number.isFinite(ms) ? ms : Date.now();
    const parts = ymdFmt(zone).formatToParts(new Date(safe));
    y = numPart(parts, "year");
    m = numPart(parts, "month");
    d = numPart(parts, "day");
  }

  const start = localMidnightMs(y, m, d, zone);
  const nextUtc = new Date(Date.UTC(y, m - 1, d) + 24 * 60 * 60 * 1000);
  const ny = nextUtc.getUTCFullYear();
  const nm = nextUtc.getUTCMonth() + 1;
  const nd = nextUtc.getUTCDate();
  const end = localMidnightMs(ny, nm, nd, zone);

  return {
    start,
    end,
    floatStart: Date.UTC(y, m - 1, d),
    floatEnd: Date.UTC(ny, nm - 1, nd),
    localDate: `${y}-${pad(m)}-${pad(d)}`,
  };
}
