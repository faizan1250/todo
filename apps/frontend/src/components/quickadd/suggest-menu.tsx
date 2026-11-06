"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { SuggestItem } from "./smart-parse";

interface SuggestMenuProps {
  items: SuggestItem[];
  activeIndex: number;
  onSelect: (item: SuggestItem) => void;
  onHover: (index: number) => void;
}

/**
 * Combobox dropdown for `#tag` / `@list` / `!priority` triggers. The parent
 * input owns keyboard state (ArrowUp/Down/Enter/Escape); this menu is
 * mouse-only plus `aria-selected` for screen readers.
 */
export function SuggestMenu({ items, activeIndex, onSelect, onHover }: SuggestMenuProps) {
  if (items.length === 0) return null;
  return (
    <ul
      role="listbox"
      data-testid="suggest-menu"
      aria-label="Quick-add suggestions"
      className="max-h-48 overflow-y-auto rounded-xl border border-[#E4E8F2] bg-white p-1 shadow-md dark:border-[#132E74] dark:bg-[#051A4D]"
    >
      {items.map((item, i) => (
        <li key={item.key} role="presentation">
          <button
            type="button"
            role="option"
            aria-selected={i === activeIndex}
            onMouseDown={(e) => {
              // Keep input focus + caret so the splice lands correctly.
              e.preventDefault();
              onSelect(item);
            }}
            onMouseEnter={() => onHover(i)}
            className={cn(
              "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-xs cursor-pointer",
              i === activeIndex
                ? "bg-[#09318D]/10 font-bold text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                : "text-[#5B6478] dark:text-[#9BB0D3]"
            )}
          >
            <span className="truncate">{item.label}</span>
            {item.hint && (
              <span className="shrink-0 text-[10px] opacity-60">{item.hint}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
