import { describe, it, expect } from "bun:test";
import {
  buildSmartParse,
  chipToPlainText,
  removeChipFromText,
  resolveHourText,
  detectAmbiguousHour,
  getActiveTrigger,
  filterSuggestions,
  applySuggestion,
  summarizeChips,
  firstTipCopy,
  EMPTY_INBOX_EXAMPLES,
  PLACEHOLDER_EXAMPLES,
  EMPTY_SMART_PARSE,
  type ParsedChip,
} from "../src/components/quickadd/smart-parse";
import {
  isSmartTypingEnabled,
  hasSeenSmartTip,
} from "../src/components/quickadd/smart-keys";
import type { ParsedToken } from "@todo/shared";

function token(
  type: ParsedToken["type"],
  raw: string,
  start: number
): ParsedToken {
  return { type, start, end: start + raw.length, raw };
}

describe("smart quick-add core", () => {
  describe("buildSmartParse", () => {
    it("maps tokens to chips in order with stable keys", () => {
      const text = "Dentist tomorrow #health";
      const res = buildSmartParse(text, [
        token("date", "tomorrow", 8),
        token("tag", "#health", 17),
      ]);
      expect(res.chips).toHaveLength(2);
      expect(res.chips[0].kind).toBe("date");
      expect(res.chips[0].label).toBe("tomorrow");
      expect(res.chips[1].kind).toBe("tag");
      expect(res.chips.map((c) => c.key)).toEqual([
        "date-8-16",
        "tag-17-24",
      ]);
    });

    it("flags a bare-hour date token as ambiguous", () => {
      const text = "dentist 5";
      const res = buildSmartParse(text, [token("date", "5", 8)]);
      expect(res.ambiguousHour?.hour).toBe(5);
      expect(res.ambiguousHour?.chip.raw).toBe("5");
    });

    it("does not flag qualified times as ambiguous", () => {
      for (const raw of ["5pm", "tomorrow", "at 5:30", "17:00"]) {
        const res = buildSmartParse(`x ${raw}`, [token("date", raw, 2)]);
        expect(res.ambiguousHour).toBeNull();
      }
    });

    it("reports an unknown @list query", () => {
      const lists = [{ id: "1", name: "Inbox", isInbox: true }];
      const res = buildSmartParse("buy milk @work", [token("list", "@work", 9)], lists);
      expect(res.unknownListQuery).toBe("work");
    });

    it("stays quiet for known lists and without list data", () => {
      const lists = [{ id: "1", name: "Work" }];
      const known = buildSmartParse("x @work", [token("list", "@work", 2)], lists);
      expect(known.unknownListQuery).toBeNull();
      const noData = buildSmartParse("x @work", [token("list", "@work", 2)], []);
      expect(noData.unknownListQuery).toBeNull();
    });

    it("skips dismissed tokens so chip removal sticks", () => {
      const dismissed = new Set(["tomorrow"]);
      const res = buildSmartParse(
        "dentist tomorrow",
        [token("date", "tomorrow", 8)],
        [],
        dismissed
      );
      expect(res.chips).toHaveLength(0);
    });
  });

  describe("chip removal", () => {
    it("returns tag/list words to the title as plain text", () => {
      const tag: ParsedChip = {
        key: "tag-0-5",
        kind: "tag",
        label: "#work",
        raw: "#work",
        start: 10,
        end: 15,
      };
      expect(chipToPlainText(tag)).toBe("work");
      const list: ParsedChip = { ...tag, kind: "list", raw: '@"my list"' };
      expect(chipToPlainText(list)).toBe("my list");
    });

    it("drops priority markers and strips estimate sigils", () => {
      const prio: ParsedChip = {
        key: "p",
        kind: "priority",
        label: "!high",
        raw: "!high",
        start: 0,
        end: 5,
      };
      expect(chipToPlainText(prio)).toBe("");
      const est: ParsedChip = { ...prio, kind: "estimate", raw: "~30m" };
      expect(chipToPlainText(est)).toBe("30m");
    });

    it("splices plain text back at the token span with the caret after it", () => {
      const chip: ParsedChip = {
        key: "tag-12-17",
        kind: "tag",
        label: "#work",
        raw: "#work",
        start: 12,
        end: 17,
      };
      const edit = removeChipFromText("Call mom #work today", chip);
      expect(edit.text).toBe("Call mom work today");
      expect(edit.caret).toBe(13);
    });

    it("collapses spacing when a marker is dropped", () => {
      const chip: ParsedChip = {
        key: "p",
        kind: "priority",
        label: "!high",
        raw: "!high",
        start: 9,
        end: 14,
      };
      const edit = removeChipFromText("Buy milk !high", chip);
      expect(edit.text).toBe("Buy milk");
    });

    it("falls back to lastIndexOf when spans shifted", () => {
      const chip: ParsedChip = {
        key: "t",
        kind: "tag",
        label: "#a",
        raw: "#a",
        start: 0,
        end: 2,
      };
      const edit = removeChipFromText("xx #a", chip);
      expect(edit.text).toBe("xx a");
    });
  });

  describe("ambiguity resolution", () => {
    it("detects bare hours only", () => {
      expect(detectAmbiguousHour("5")).toBe(5);
      expect(detectAmbiguousHour("at 5")).toBe(5);
      expect(detectAmbiguousHour("12")).toBe(12);
      expect(detectAmbiguousHour("5pm")).toBeNull();
      expect(detectAmbiguousHour("tomorrow")).toBeNull();
      expect(detectAmbiguousHour("13")).toBeNull();
    });

    it("rewrites the token with an explicit am/pm", () => {
      const chip: ParsedChip = {
        key: "d",
        kind: "date",
        label: "5",
        raw: "5",
        start: 8,
        end: 9,
      };
      const edit = resolveHourText("dentist 5", chip, 5, "pm");
      expect(edit.text).toBe("dentist 5pm");
      expect(edit.caret).toBe(11);
    });
  });

  describe("trigger detection", () => {
    it("detects in-progress triggers at the caret", () => {
      expect(getActiveTrigger("buy #wo", 7)).toEqual({
        trigger: "#",
        query: "wo",
        start: 4,
      });
      expect(getActiveTrigger("@", 1)).toEqual({ trigger: "@", query: "", start: 0 });
      expect(getActiveTrigger("x !h", 4)).toEqual({ trigger: "!", query: "h", start: 2 });
    });

    it("rejects mid-word sigils but accepts a lone trigger after space", () => {
      expect(getActiveTrigger("C# major", 2)).toBeNull();
      expect(getActiveTrigger("hi!there", 8)).toBeNull();
      expect(getActiveTrigger("a#b", 3)).toBeNull();
      expect(getActiveTrigger("done #", 6)).toEqual({ trigger: "#", query: "", start: 5 });
    });
  });

  describe("suggestions", () => {
    it("filters tags/lists with startsWith first and caps at 6", () => {
      const tags = ["work", "workout", "home", "worship", "w1", "w2", "w3", "w4"];
      const items = filterSuggestions("#", "w", tags, []);
      expect(items.length).toBeLessThanOrEqual(6);
      expect(items[0].label.startsWith("#w")).toBe(true);
      expect(items[0].insert.endsWith(" ")).toBe(true);
    });

    it("offers priorities for !", () => {
      const items = filterSuggestions("!", "h", [], []);
      expect(items.map((i) => i.key)).toEqual(["high"]);
      expect(filterSuggestions("!", "", [], [])).toHaveLength(4);
    });

    it("splices the insert over the trigger word", () => {
      const edit = applySuggestion("buy #wo", 7, 4, "#work ");
      expect(edit.text).toBe("buy #work ");
      expect(edit.caret).toBe(10);
    });
  });

  describe("tips and examples", () => {
    it("summarizes chips and copies the first tip", () => {
      const chips: ParsedChip[] = [
        { key: "a", kind: "date", label: "tomorrow", raw: "tomorrow", start: 0, end: 8 },
        { key: "b", kind: "tag", label: "#w", raw: "#w", start: 9, end: 11 },
      ];
      expect(summarizeChips(chips)).toBe("tomorrow, #w");
      expect(firstTipCopy("tomorrow")).toContain("Tap ✕");
    });

    it("ships rotating placeholders and 3 inbox examples", () => {
      expect(PLACEHOLDER_EXAMPLES.length).toBeGreaterThanOrEqual(3);
      expect(EMPTY_INBOX_EXAMPLES).toHaveLength(3);
    });

    it("defaults smart typing on and the tip unseen (no DOM)", () => {
      expect(isSmartTypingEnabled()).toBe(true);
      expect(hasSeenSmartTip()).toBe(false);
      expect(EMPTY_SMART_PARSE.chips).toEqual([]);
    });
  });
});
