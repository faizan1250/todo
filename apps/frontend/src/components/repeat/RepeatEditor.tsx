"use client";

import * as React from "react";
import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  REPEAT_PRESETS,
  WEEKDAY_OPTIONS,
  buildCustomRRule,
  parseRRuleToCustom,
  presetRrule,
  validateRepeatRule,
  type RepeatCustomConfig,
  type RepeatEnds,
  type RepeatMode,
  type RepeatPresetId,
  type RepeatUnit,
} from "./rrule-presets";
import { RepeatSummary } from "./RepeatSummary";

interface RepeatEditorProps {
  initialRrule: string | null;
  initialMode?: RepeatMode;
  /** Current task dueAt — anchors the live preview. */
  anchorIso?: string | number | null;
  onApply: (rrule: string, mode: RepeatMode) => void;
  onRemove: () => void;
}

const UNIT_OPTIONS: Array<{ id: RepeatUnit; label: string; example: string }> = [
  { id: "day", label: "day(s)", example: "Every 3 days" },
  { id: "week", label: "week(s)", example: "Every 2 weeks on Mon and Wed" },
  { id: "month", label: "month(s)", example: "Every month on the 5th" },
  { id: "year", label: "year(s)", example: "Every year on 16 Mar" },
];

function detectPreset(rrule: string | null): RepeatPresetId {
  if (!rrule) return "none";
  const found = REPEAT_PRESETS.find((p) => p.rrule.toUpperCase() === rrule.toUpperCase());
  return found ? found.id : "custom";
}

const DEFAULT_CUSTOM: RepeatCustomConfig = {
  interval: 1,
  unit: "week",
  weekdays: ["MO"],
  monthDay: null,
  ends: { kind: "never" },
};

export function RepeatEditor({
  initialRrule,
  initialMode = "fixed",
  anchorIso = null,
  onApply,
  onRemove,
}: RepeatEditorProps) {
  const [preset, setPreset] = useState<RepeatPresetId>(() => detectPreset(initialRrule));
  const [custom, setCustom] = useState<RepeatCustomConfig>(
    () => parseRRuleToCustom(initialRrule ?? "") ?? DEFAULT_CUSTOM
  );
  const [mode, setMode] = useState<RepeatMode>(initialMode);
  const [error, setError] = useState<string | null>(null);

  const draftRrule = useMemo(() => {
    if (preset === "none") return null;
    if (preset === "custom") {
      const built = buildCustomRRule(custom);
      return built.ok ? built.rrule ?? null : null;
    }
    return presetRrule(preset);
  }, [preset, custom]);

  const draftInvalidReason = useMemo(() => {
    if (preset !== "custom") return null;
    const built = buildCustomRRule(custom);
    return built.ok ? null : (built.error ?? "Invalid repeat.");
  }, [preset, custom]);

  const patchCustom = (patch: Partial<RepeatCustomConfig>) => {
    setCustom((c) => ({ ...c, ...patch }));
    setError(null);
  };

  const patchEnds = (patch: Partial<RepeatEnds>) => {
    setCustom((c) => ({ ...c, ends: { ...c.ends, ...patch } }));
    setError(null);
  };

  const toggleWeekday = (code: string) => {
    setCustom((c) => ({
      ...c,
      weekdays: c.weekdays.includes(code)
        ? c.weekdays.filter((w) => w !== code)
        : [...c.weekdays, code],
    }));
    setError(null);
  };

  const handleApply = () => {
    if (preset === "none") {
      onRemove();
      return;
    }
    if (!draftRrule) {
      setError(draftInvalidReason ?? "Pick a valid repeat first.");
      return;
    }
    const check = validateRepeatRule(draftRrule, mode);
    if (!check.valid) {
      setError(check.error ?? "Invalid repeat.");
      return;
    }
    onApply(draftRrule, mode);
  };

  return (
    <div className="space-y-3">
      {/* Live plain-words preview of the current draft */}
      {draftRrule && (
        <div className="rounded-lg bg-[#F2F5FC] px-2.5 py-2 dark:bg-[#082363]">
          <RepeatSummary rrule={draftRrule} mode={mode} anchorIso={anchorIso} />
        </div>
      )}

      {/* Presets */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          Repeat
        </p>
        <div className="mt-1 space-y-0.5" role="radiogroup" aria-label="Repeat preset">
          <PresetRow
            label="Does not repeat"
            selected={preset === "none"}
            onSelect={() => {
              setPreset("none");
              setError(null);
            }}
          />
          {REPEAT_PRESETS.map((p) => (
            <PresetRow
              key={p.id}
              label={p.label}
              hint={p.example}
              selected={preset === p.id}
              onSelect={() => {
                setPreset(p.id);
                setError(null);
              }}
            />
          ))}
          <PresetRow
            label="Custom"
            hint="Every N days/weeks, pick weekdays…"
            selected={preset === "custom"}
            onSelect={() => {
              setPreset("custom");
              setError(null);
            }}
          />
        </div>
      </div>

      {/* Custom builder */}
      {preset === "custom" && (
        <div className="space-y-2.5 rounded-lg border border-[#E4E8F2] p-2.5 dark:border-[#132E74]">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">Every</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={custom.interval}
              onChange={(e) => patchCustom({ interval: Number(e.target.value) })}
              aria-label="Repeat interval"
              className="w-16 rounded border border-[#E4E8F2] bg-white px-1.5 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
            />
            <select
              value={custom.unit}
              onChange={(e) => patchCustom({ unit: e.target.value as RepeatUnit })}
              aria-label="Repeat unit"
              className="rounded border border-[#E4E8F2] bg-white px-1.5 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
            >
              {UNIT_OPTIONS.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.label}
                </option>
              ))}
            </select>
          </div>

          {custom.unit === "week" && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                On days
              </p>
              <div className="mt-1 flex flex-wrap gap-1" role="group" aria-label="Weekdays">
                {WEEKDAY_OPTIONS.map((d) => {
                  const on = custom.weekdays.includes(d.code);
                  return (
                    <button
                      key={d.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleWeekday(d.code)}
                      className={cn(
                        "rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                        on
                          ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                          : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                      )}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {custom.unit === "month" && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">On day</span>
              <input
                type="number"
                min={1}
                max={31}
                placeholder="e.g. 5"
                value={custom.monthDay ?? ""}
                onChange={(e) =>
                  patchCustom({
                    monthDay: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                aria-label="Day of month"
                className="w-20 rounded border border-[#E4E8F2] bg-white px-1.5 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
              />
              <span className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                of the month (blank = same date)
              </span>
            </div>
          )}

          {/* Ends */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
              Ends
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {(
                [
                  { id: "never", label: "Never" },
                  { id: "on_date", label: "On date" },
                  { id: "after_n", label: "After N times" },
                ] as const
              ).map((o) => (
                <button
                  key={o.id}
                  type="button"
                  aria-pressed={custom.ends.kind === o.id}
                  onClick={() => patchEnds({ kind: o.id })}
                  className={cn(
                    "rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer",
                    custom.ends.kind === o.id
                      ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                      : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            {custom.ends.kind === "on_date" && (
              <input
                type="date"
                value={custom.ends.untilDate ?? ""}
                onChange={(e) => patchEnds({ untilDate: e.target.value })}
                aria-label="End date"
                className="mt-1.5 rounded border border-[#E4E8F2] bg-white px-1.5 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
              />
            )}
            {custom.ends.kind === "after_n" && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">After</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={custom.ends.count ?? ""}
                  onChange={(e) => patchEnds({ count: Number(e.target.value) })}
                  aria-label="Number of occurrences"
                  className="w-20 rounded border border-[#E4E8F2] bg-white px-1.5 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                />
                <span className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">times</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Repeat from: fixed vs after_completion */}
      <div className="border-t border-[#E4E8F2] pt-2 dark:border-[#132E74]">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          Repeat from
        </p>
        <div className="mt-1 grid grid-cols-2 gap-1" role="radiogroup" aria-label="Repeat from">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "fixed"}
            onClick={() => {
              setMode("fixed");
              setError(null);
            }}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-left transition-colors cursor-pointer",
              mode === "fixed"
                ? "border-[#09318D] bg-[#09318D]/5 dark:border-[#FD91CC] dark:bg-[#FD91CC]/10"
                : "border-[#E4E8F2] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:hover:bg-[#082363]"
            )}
          >
            <span className="block text-[11px] font-bold text-[#0B1220] dark:text-white">
              Due date
            </span>
            <span className="block text-[10px] text-[#5B6478] dark:text-[#9BB0D3]">
              e.g. due Mon → again Tue
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "after_completion"}
            onClick={() => {
              setMode("after_completion");
              setError(null);
            }}
            className={cn(
              "rounded-lg border px-2 py-1.5 text-left transition-colors cursor-pointer",
              mode === "after_completion"
                ? "border-[#09318D] bg-[#09318D]/5 dark:border-[#FD91CC] dark:bg-[#FD91CC]/10"
                : "border-[#E4E8F2] hover:bg-[#F2F5FC] dark:border-[#132E74] dark:hover:bg-[#082363]"
            )}
          >
            <span className="block text-[11px] font-bold text-[#0B1220] dark:text-white">
              When I finish
            </span>
            <span className="block text-[10px] text-[#5B6478] dark:text-[#9BB0D3]">
              e.g. done Fri → next Sat
            </span>
          </button>
        </div>
      </div>

      {/* Plain-words editing rules */}
      <p className="text-[11px] leading-snug text-[#5B6478] dark:text-[#9BB0D3]">
        Changing repeat changes all future tasks. Moving the due date only changes this one.
      </p>

      {error && (
        <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleApply}
        className="w-full rounded-lg bg-[#09318D] px-2 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#0B3EA8] active:translate-y-[0.5px] cursor-pointer dark:bg-[#FD91CC] dark:text-[#051A4D] dark:hover:bg-[#FFA8D7]"
      >
        {preset === "none" ? "Stop repeating" : "Save repeat"}
      </button>
    </div>
  );
}

function PresetRow({
  label,
  hint,
  selected,
  onSelect,
}: {
  label: string;
  hint?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded px-2.5 py-1.5 text-xs text-left cursor-pointer transition-colors",
        selected
          ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
          : "text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
      )}
    >
      <span>
        {label}
        {hint && (
          <span className="block text-[10px] font-normal opacity-70">{hint}</span>
        )}
      </span>
      {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
    </button>
  );
}
