/**
 * Pure smart-quick-add helpers: token → chip mapping, chip removal,
 * trigger detection, suggestion filtering, AM/PM resolution.
 *
 * Token shapes mirror `@todo/shared` `ParsedToken` (type-only import, so
 * this module stays dependency-free and unit-testable). The actual parse
 * runs through a lazily-loaded `@todo/shared` chunk — see `loadSharedParse`.
 */

import type { ParsedToken } from "@todo/shared";

export type ChipKind =
  | "date"
  | "recurrence"
  | "reminder"
  | "tag"
  | "list"
  | "priority"
  | "estimate";

export interface ParsedChip {
  key: string;
  kind: ChipKind;
  /** Human label shown inside the chip (the matched words). */
  label: string;
  /** Exact matched substring in the input. */
  raw: string;
  start: number;
  end: number;
}

export interface ListSummary {
  id: string;
  name: string;
  isInbox?: boolean;
}

export interface AmbiguousHour {
  chip: ParsedChip;
  hour: number;
}

export interface SmartParseResult {
  chips: ParsedChip[];
  /** Bare-hour date token ("dentist 5") needing an AM/PM choice. */
  ambiguousHour: AmbiguousHour | null;
  /** `@list` query matching no known list — falls back to Inbox. */
  unknownListQuery: string | null;
}

export const EMPTY_SMART_PARSE: SmartParseResult = {
  chips: [],
  ambiguousHour: null,
  unknownListQuery: null,
};

export type TriggerChar = "#" | "@" | "!";

export interface TriggerInfo {
  trigger: TriggerChar;
  query: string;
  /** Index of the trigger character in the input. */
  start: number;
}

export interface SuggestItem {
  key: string;
  label: string;
  /** Text spliced into the input (trailing space included). */
  insert: string;
  hint?: string;
}

/** Rotating input placeholders (cycled while the input is empty). */
export const PLACEHOLDER_EXAMPLES: readonly string[] = [
  "Pay rent every month on the 1st",
  "Dentist tomorrow at 5pm #health",
  "Review launch plan !high ~30m",
  "Call mom every Sunday @family",
];

/** Tappable fills shown with an empty inbox. */
export const EMPTY_INBOX_EXAMPLES: readonly string[] = [
  "Plan sprint tomorrow at 9am",
  "Pay rent every month on the 1st",
  "Read 20 pages ~30m #growth",
];

export function firstTipCopy(summary: string): string {
  return `We set ${summary} from your words. Tap ✕ on a chip to undo.`;
}

export function summarizeChips(chips: ParsedChip[]): string {
  return chips
    .slice(0, 3)
    .map((c) => c.label)
    .join(", ");
}

const MAX_LABEL = 28;

function toLabel(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.length > MAX_LABEL ? `${trimmed.slice(0, MAX_LABEL - 1)}…` : trimmed;
}

function stripSigil(raw: string, sigil: "#" | "@"): string {
  return raw
    .replace(new RegExp(`^${sigil}"?`), "")
    .replace(/"$/, "")
    .trim();
}

/**
 * Plain-text words a chip returns to the title when removed. Markers that
 * would instantly re-parse (the `#`/`@` sigils) are stripped so removal
 * sticks for this editing session (see `dismissed` in buildSmartParse).
 * Priority is a pure marker — removing it drops it entirely.
 */
export function chipToPlainText(chip: ParsedChip): string {
  switch (chip.kind) {
    case "tag":
      return stripSigil(chip.raw, "#");
    case "list":
      return stripSigil(chip.raw, "@");
    case "priority":
      return "";
    case "estimate":
      return chip.raw.replace(/^~/, "").trim();
    case "date":
    case "recurrence":
    case "reminder":
      return chip.raw.trim();
  }
}

function locateSpan(
  text: string,
  chip: ParsedChip
): { start: number; end: number } | null {
  if (text.slice(chip.start, chip.end) === chip.raw) {
    return { start: chip.start, end: chip.end };
  }
  const idx = text.lastIndexOf(chip.raw);
  if (idx < 0) return null;
  return { start: idx, end: idx + chip.raw.length };
}

export interface TextEdit {
  text: string;
  caret: number;
}

/** Remove a chip: token span becomes its plain-text words. */
export function removeChipFromText(text: string, chip: ParsedChip): TextEdit {
  const span = locateSpan(text, chip);
  if (!span) return { text, caret: text.length };
  const plain = chipToPlainText(chip);
  const before = text.slice(0, span.start);
  const after = text.slice(span.end);
  if (plain) {
    const next = before + plain + after;
    return { text: next, caret: before.length + plain.length };
  }
  let next = (before + after).replace(/[ \t]{2,}/g, " ");
  if (!after.trim()) next = next.trimEnd();
  if (!before.trim()) next = next.trimStart();
  if (next.startsWith(" ") && !text.startsWith(" ")) next = next.trimStart();
  return { text: next, caret: Math.min(before.length, next.length) };
}

const BARE_HOUR_RE = /^\s*(?:at\s+)?([1-9]|1[0-2])\s*$/i;

/** Bare-hour date token ("5", "at 5") with no am/pm or minutes. */
export function detectAmbiguousHour(raw: string): number | null {
  const m = BARE_HOUR_RE.exec(raw);
  if (!m) return null;
  return parseInt(m[1], 10);
}

/** Rewrite a bare-hour token with an explicit am/pm ("dentist 5" → "dentist 5pm"). */
export function resolveHourText(
  text: string,
  chip: ParsedChip,
  hour: number,
  ampm: "am" | "pm"
): TextEdit {
  const span = locateSpan(text, chip);
  if (!span) return { text, caret: text.length };
  const replacement = `${hour}${ampm}`;
  const next = text.slice(0, span.start) + replacement + text.slice(span.end);
  return { text: next, caret: span.start + replacement.length };
}

function unknownListQueryFor(raw: string, lists: ListSummary[]): string | null {
  if (lists.length === 0) return null;
  const query = stripSigil(raw, "@");
  if (!query) return null;
  const q = query.toLowerCase();
  const known = lists.some(
    (l) => l.name.toLowerCase() === q || l.name.toLowerCase().includes(q)
  );
  return known ? null : query;
}

/**
 * Map shared-parser tokens to chips. Tokens whose raw text was dismissed
 * (chip ✕ / Backspace) this editing session are skipped so removal sticks
 * even when the plain words would re-parse (e.g. "tomorrow").
 */
export function buildSmartParse(
  text: string,
  tokens: ParsedToken[],
  lists: ListSummary[] = [],
  dismissed: ReadonlySet<string> = new Set()
): SmartParseResult {
  void text;
  const chips: ParsedChip[] = [];
  let ambiguousHour: AmbiguousHour | null = null;
  let unknownListQuery: string | null = null;

  const ordered = [...tokens].sort((a, b) => a.start - b.start);
  for (const token of ordered) {
    const rawKey = token.raw.trim().toLowerCase();
    if (dismissed.has(rawKey)) continue;
    const chip: ParsedChip = {
      key: `${token.type}-${token.start}-${token.end}`,
      kind: token.type,
      label: toLabel(token.raw),
      raw: token.raw,
      start: token.start,
      end: token.end,
    };
    chips.push(chip);

    if (!ambiguousHour && token.type === "date") {
      const hour = detectAmbiguousHour(token.raw);
      if (hour !== null) ambiguousHour = { chip, hour };
    }
    if (unknownListQuery === null && token.type === "list") {
      unknownListQuery = unknownListQueryFor(token.raw, lists);
    }
  }

  return { chips, ambiguousHour, unknownListQuery };
}

/**
 * Detect an in-progress `#tag` / `@list` / `!priority` token ending at the
 * caret. The trigger must start the line or follow whitespace so `C#` or
 * `hi!there` never open the menu.
 */
export function getActiveTrigger(text: string, caret: number): TriggerInfo | null {
  if (caret < 0 || caret > text.length) return null;
  let i = caret - 1;
  let word = "";
  while (i >= 0 && word.length < 32) {
    const ch = text[i];
    if (ch === " " || ch === "\t" || ch === "\n") break;
    word = ch + word;
    i--;
  }
  if (!word) return null;
  const first = word[0];
  if (first !== "#" && first !== "@" && first !== "!") return null;
  const start = caret - word.length;
  if (start > 0) {
    const prev = text[start - 1];
    if (prev !== " " && prev !== "\t" && prev !== "\n" && prev !== "(") return null;
  }
  const rest = word.slice(1);
  if (rest === "" || /^[\p{L}\p{N}_-]+$/u.test(rest)) {
    return { trigger: first, query: rest, start };
  }
  return null;
}

const PRIORITY_SUGGESTIONS: SuggestItem[] = [
  { key: "urgent", label: "Urgent", insert: "!urgent ", hint: "P1 · !urgent" },
  { key: "high", label: "High", insert: "!high ", hint: "P2 · !high" },
  { key: "med", label: "Medium", insert: "!med ", hint: "P3 · !med" },
  { key: "low", label: "Low", insert: "!low ", hint: "P4 · !low" },
];

export function filterSuggestions(
  trigger: TriggerChar,
  query: string,
  tagNames: string[],
  listNames: string[]
): SuggestItem[] {
  const q = query.toLowerCase();
  if (trigger === "!") {
    return PRIORITY_SUGGESTIONS.filter(
      (p) => p.key.includes(q) || p.label.toLowerCase().includes(q)
    ).slice(0, 4);
  }
  const names = trigger === "#" ? tagNames : listNames;
  const seen = new Set<string>();
  const starts: string[] = [];
  const contains: string[] = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (q && !lower.includes(q)) continue;
    if (!q || lower.startsWith(q)) starts.push(name);
    else contains.push(name);
  }
  const sigil = trigger;
  return [...starts, ...contains].slice(0, 6).map((name) => ({
    key: name,
    label: `${sigil}${name}`,
    insert: `${sigil}${name} `,
  }));
}

/** Splice a suggestion into the input, replacing the trigger word. */
export function applySuggestion(
  text: string,
  caret: number,
  triggerStart: number,
  insert: string
): TextEdit {
  const before = text.slice(0, triggerStart);
  let after = text.slice(caret);
  let finalInsert = insert;
  if (after && !after.startsWith(" ") && !finalInsert.endsWith(" ")) {
    finalInsert += " ";
  }
  const next = before + finalInsert + after;
  return { text: next, caret: before.length + finalInsert.length };
}

export function safeTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

let sharedPromise: Promise<typeof import("@todo/shared")> | null = null;

/** Lazy-load `@todo/shared` (chrono/luxon stay out of the initial bundle). */
export function loadSharedParse(): Promise<typeof import("@todo/shared")> {
  if (!sharedPromise) sharedPromise = import("@todo/shared");
  return sharedPromise;
}
