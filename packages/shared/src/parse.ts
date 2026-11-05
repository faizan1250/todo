import * as chrono from "chrono-node";
import { DateTime } from "luxon";
import { toUtcMidnight } from "./dayBounds";

export interface ParsedToken {
  type: "tag" | "list" | "priority" | "estimate" | "reminder" | "recurrence" | "date";
  start: number;
  end: number;
  raw: string;
  value?: any;
}

export interface ParsedTaskResult {
  title: string;
  dueAt: Date | null;
  allDay: boolean;
  priority: number;
  tags: string[];
  list: { id: string; name: string } | null;
  estimateMin: number | null;
  recurrence: { rrule: string; mode: "fixed" | "after_completion" } | null;
  reminders: Array<{
    kind: "absolute" | "relative";
    relativeTo?: "due" | "start" | "deadline" | null;
    offsetMin?: number | null;
    remindAt?: Date | null;
  }>;
  tokens: ParsedToken[];
}

export interface UserListSummary {
  id: string;
  name: string;
  isInbox?: boolean;
}

/**
 * Removes character ranges from a string and trims whitespace.
 */
function removeRanges(text: string, ranges: Array<{ start: number; end: number }>): string {
  // Sort ranges descending to remove without messing up previous indices
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let result = text;
  for (const r of sorted) {
    result = result.slice(0, r.start) + " " + result.slice(r.end);
  }
  return result.replace(/\s+/g, " ").trim();
}

/**
 * Parses natural language input into structured task components.
 */
export function parseNaturalLanguage(
  input: string,
  userLists: UserListSummary[] = [],
  userTimezone = "UTC",
  now = new Date()
): ParsedTaskResult {
  if (!input || !input.trim()) {
    throw new Error("EMPTY_TITLE");
  }

  const tokens: ParsedToken[] = [];
  const removedRanges: Array<{ start: number; end: number }> = [];

  // Helper to record a token
  function addToken(
    type: ParsedToken["type"],
    start: number,
    end: number,
    raw: string,
    value?: any
  ) {
    tokens.push({ type, start, end, raw, value });
    removedRanges.push({ start, end });
  }

  // 1. Tags: #"two words" or #tag
  const tagRegex = /#"([^"]+)"|#([\p{L}\p{N}_-]+)/gu;
  let match: RegExpExecArray | null;
  const tags: string[] = [];

  while ((match = tagRegex.exec(input)) !== null) {
    const tagName = (match[1] || match[2]).trim();
    if (tagName) {
      tags.push(tagName);
      addToken("tag", match.index, match.index + match[0].length, match[0], tagName);
    }
  }

  // 2. Priority: !1 to !4, !low, !med, !medium, !high, !urgent
  const priorityRegex = /\B!(urgent|high|med|medium|low|none|[0-4])\b/gi;
  let priority = 0;

  while ((match = priorityRegex.exec(input)) !== null) {
    const pStr = match[1].toLowerCase();
    let pVal = 0;
    if (pStr === "urgent" || pStr === "4") pVal = 4;
    else if (pStr === "high" || pStr === "3") pVal = 3;
    else if (pStr === "med" || pStr === "medium" || pStr === "2") pVal = 2;
    else if (pStr === "low" || pStr === "1") pVal = 1;
    else pVal = 0;

    priority = pVal;
    addToken("priority", match.index, match.index + match[0].length, match[0], pVal);
  }

  // 3. Estimate: ~30m, ~1h30m, ~2h, ~1.5h, ~90m
  const estimateRegex = /\B~((?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?)\b/gi;
  let estimateMin: number | null = null;

  while ((match = estimateRegex.exec(input)) !== null) {
    const hours = match[2] ? parseFloat(match[2]) : 0;
    const mins = match[3] ? parseInt(match[3], 10) : 0;
    const total = Math.round(hours * 60 + mins);
    if (total > 0 && total <= 1440) {
      estimateMin = total;
      addToken("estimate", match.index, match.index + match[0].length, match[0], total);
    }
  }

  // 4. List: @"two words" or @listname
  const listRegex = /@"([^"]+)"|@([\p{L}\p{N}_-]+)/gu;
  let targetList: { id: string; name: string } | null = null;

  while ((match = listRegex.exec(input)) !== null) {
    const listQuery = (match[1] || match[2]).trim().toLowerCase();
    // Fuzzy match against user's lists
    let found = userLists.find((l) => l.name.toLowerCase() === listQuery);
    if (!found) {
      found = userLists.find((l) => l.name.toLowerCase().includes(listQuery));
    }
    if (!found) {
      // Fallback to inbox if available
      found = userLists.find((l) => l.isInbox) || userLists[0];
    }
    if (found) {
      targetList = { id: found.id, name: found.name };
    }
    addToken("list", match.index, match.index + match[0].length, match[0], targetList);
  }

  // If no @list token was found, default to Inbox
  if (!targetList && userLists.length > 0) {
    const inbox = userLists.find((l) => l.isInbox) || userLists[0];
    if (inbox) {
      targetList = { id: inbox.id, name: inbox.name };
    }
  }

  // 5. Reminders:
  // e.g. "remind 1h before", "remind me 30m before", "remind me at 8am", "remind at 5pm"
  const reminderObjList: ParsedTaskResult["reminders"] = [];

  const relativeReminderRegex =
    /\bremind(?:\s+me)?\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours|d|days?)\s*before\b/gi;
  while ((match = relativeReminderRegex.exec(input)) !== null) {
    const amount = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    let offsetMin = 0;
    if (unit.startsWith("m")) offsetMin = -amount;
    else if (unit.startsWith("h")) offsetMin = -amount * 60;
    else if (unit.startsWith("d")) offsetMin = -amount * 1440;

    const reminder = {
      kind: "relative" as const,
      relativeTo: "due" as const,
      offsetMin,
    };
    reminderObjList.push(reminder);
    addToken("reminder", match.index, match.index + match[0].length, match[0], reminder);
  }

  const absoluteReminderRegex =
    /\bremind(?:\s+me)?\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/gi;
  while ((match = absoluteReminderRegex.exec(input)) !== null) {
    const timeStr = match[1];
    const parsedChrono = chrono.en.casual.parseDate(
      `today at ${timeStr}`,
      { instant: now },
      { forwardDate: true }
    );
    const reminder = {
      kind: "absolute" as const,
      remindAt: parsedChrono || new Date(now.getTime() + 60 * 60 * 1000),
    };
    reminderObjList.push(reminder);
    addToken("reminder", match.index, match.index + match[0].length, match[0], reminder);
  }

  // 6. Recurrence Phrases (custom matcher before chrono)
  let recurrence: { rrule: string; mode: "fixed" | "after_completion" } | null = null;

  // Patterns for recurrence:
  // - "every weekday"
  // - "every day" / "daily"
  // - "every other (day|week|month|friday|monday...)"
  // - "every mon,wed,fri" / "every mon,wed"
  // - "every 2 weeks" / "every 3 days after done"
  // - "every month on the 15th"
  // - "daily after done" / "after completion"
  const recurrencePatterns: Array<{
    regex: RegExp;
    handler: (m: RegExpExecArray) => { rrule: string; mode: "fixed" | "after_completion" };
  }> = [
    {
      // "every weekday"
      regex: /\bevery\s+weekday\b/i,
      handler: () => ({
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        mode: "fixed",
      }),
    },
    {
      // "every other (day|week|month|monday...)"
      regex:
        /\bevery\s+other\s+(day|week|month|(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))\b/i,
      handler: (m) => {
        const target = m[1].toLowerCase();
        if (target === "day") return { rrule: "FREQ=DAILY;INTERVAL=2", mode: "fixed" };
        if (target === "week") return { rrule: "FREQ=WEEKLY;INTERVAL=2", mode: "fixed" };
        if (target === "month") return { rrule: "FREQ=MONTHLY;INTERVAL=2", mode: "fixed" };
        const dayCode = target.slice(0, 2).toUpperCase();
        return { rrule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`, mode: "fixed" };
      },
    },
    {
      // "every month on the 15th" or "every month on the 1st"
      regex: /\bevery\s+month\s+on\s+the\s+(\d+)(?:st|nd|rd|th)?\b/i,
      handler: (m) => ({
        rrule: `FREQ=MONTHLY;BYMONTHDAY=${parseInt(m[1], 10)}`,
        mode: "fixed",
      }),
    },
    {
      // "every mon,wed,fri" or "every monday, wednesday"
      regex:
        /\bevery\s+((?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)(?:\s*,\s*(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?))*)\b/i,
      handler: (m) => {
        const daysPart = m[1];
        const dayCodes = daysPart
          .split(",")
          .map((d) => d.trim().slice(0, 2).toUpperCase())
          .filter(Boolean);
        return {
          rrule: `FREQ=WEEKLY;BYDAY=${dayCodes.join(",")}`,
          mode: "fixed",
        };
      },
    },
    {
      // "every N (days|weeks|months|years) [after done / after completion]"
      regex:
        /\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)(?:\s+(?:after\s+(?:completion|done)|after\s+done))?\b/i,
      handler: (m) => {
        const interval = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        const isAfter = m[0].toLowerCase().includes("after");
        let freq = "DAILY";
        if (unit.startsWith("week")) freq = "WEEKLY";
        else if (unit.startsWith("month")) freq = "MONTHLY";
        else if (unit.startsWith("year")) freq = "YEARLY";
        return {
          rrule: `FREQ=${freq};INTERVAL=${interval}`,
          mode: isAfter ? "after_completion" : "fixed",
        };
      },
    },
    {
      // "daily after done" / "daily after completion"
      regex: /\bdaily\s+after\s+(?:done|completion)\b/i,
      handler: () => ({
        rrule: "FREQ=DAILY;INTERVAL=1",
        mode: "after_completion",
      }),
    },
    {
      // "every day" or "daily"
      regex: /\b(every\s+day|daily)\b/i,
      handler: () => ({
        rrule: "FREQ=DAILY;INTERVAL=1",
        mode: "fixed",
      }),
    },
    {
      // "after completion" / "after done"
      regex: /\bafter\s+(?:completion|done)\b/i,
      handler: () => ({
        rrule: "FREQ=DAILY;INTERVAL=1",
        mode: "after_completion",
      }),
    },
  ];

  for (const p of recurrencePatterns) {
    const recMatch = p.regex.exec(input);
    if (recMatch) {
      recurrence = p.handler(recMatch);
      addToken(
        "recurrence",
        recMatch.index,
        recMatch.index + recMatch[0].length,
        recMatch[0],
        recurrence
      );
      break;
    }
  }

  // 7. Dates with chrono-node
  // We run chrono on the text with non-date tokens blanked out or replaced with spaces,
  // so indices match the original input string.
  let textForDate = input;
  for (const r of removedRanges) {
    const spaces = " ".repeat(r.end - r.start);
    textForDate = textForDate.slice(0, r.start) + spaces + textForDate.slice(r.end);
  }

  let dueAt: Date | null = null;
  let allDay = false;

  const chronoResults = chrono.en.casual.parse(
    textForDate,
    { instant: now },
    { forwardDate: true }
  );

  let dateHandled = false;

  if (chronoResults.length > 0) {
    const firstResult = chronoResults[0];
    const matchTextLower = firstResult.text.toLowerCase().trim();
    const bareCasualWords = ["night", "morning", "afternoon", "evening"];

    let isFalsePositiveNoun = false;
    if (bareCasualWords.includes(matchTextLower)) {
      const prefix = input.slice(0, firstResult.index).trimEnd();
      const isPrecededByTimeWord =
        /\b(at|in\s+the|this|tomorrow|yesterday|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i.test(
          prefix
        );
      if (!isPrecededByTimeWord) {
        isFalsePositiveNoun = true;
      }
    }

    if (!isFalsePositiveNoun) {
      const isCertainTime =
        firstResult.start.isCertain("hour") || firstResult.start.isCertain("minute");

      if (isCertainTime) {
        allDay = false;
        dueAt = firstResult.date();
      } else {
        allDay = true;
        dueAt = toUtcMidnight(firstResult.date());
      }

      addToken(
        "date",
        firstResult.index,
        firstResult.index + firstResult.text.length,
        firstResult.text,
        { dueAt, allDay }
      );
      dateHandled = true;
    }
  }

  if (!dateHandled) {
    // Custom refiner: bare "5" or "at 5" resolves to next upcoming 5 (am or pm)
    const bareHourRegex = /\b(?:at\s+)?([1-9]|1[0-2])\b/i;
    const bareMatch = bareHourRegex.exec(textForDate);

    if (bareMatch) {
      const hour = parseInt(bareMatch[1], 10);
      const nowInTz = DateTime.fromJSDate(now).setZone(userTimezone);

      // Candidates: today AM, today PM, tomorrow AM, tomorrow PM
      const candidates = [
        nowInTz.set({ hour, minute: 0, second: 0, millisecond: 0 }),
        nowInTz.set({ hour: hour + 12, minute: 0, second: 0, millisecond: 0 }),
        nowInTz.plus({ days: 1 }).set({ hour, minute: 0, second: 0, millisecond: 0 }),
        nowInTz.plus({ days: 1 }).set({ hour: hour + 12, minute: 0, second: 0, millisecond: 0 }),
      ]
        .filter((c) => c.toMillis() > nowInTz.toMillis())
        .sort((a, b) => a.toMillis() - b.toMillis());

      if (candidates.length > 0) {
        dueAt = candidates[0].toJSDate();
        allDay = false;
        addToken(
          "date",
          bareMatch.index,
          bareMatch.index + bareMatch[0].length,
          bareMatch[0],
          { dueAt, allDay }
        );
      }
    }
  }

  // 8. Remaining text is title
  const title = removeRanges(input, removedRanges);

  if (!title || !title.trim()) {
    throw new Error("EMPTY_TITLE");
  }

  return {
    title,
    dueAt,
    allDay,
    priority,
    tags,
    list: targetList,
    estimateMin,
    recurrence,
    reminders: reminderObjList,
    tokens,
  };
}
