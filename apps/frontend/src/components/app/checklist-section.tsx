"use client";

import * as React from "react";
import { useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChecklistItemUi } from "./types";

interface ChecklistSectionProps {
  items: ChecklistItemUi[];
  onToggleItem: (id: string, currentDone: boolean) => void;
  onDeleteItem: (id: string) => void;
  onAddItem: (text: string) => void;
  disabled?: boolean;
}

export function ChecklistSection({
  items,
  onToggleItem,
  onDeleteItem,
  onAddItem,
  disabled = false,
}: ChecklistSectionProps) {
  const [newItemText, setNewItemText] = useState("");

  const completedCount = items.filter((i) => i.done).length;
  const totalCount = items.length;
  const percentage = totalCount === 0 ? 0 : Math.round((completedCount / totalCount) * 100);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newItemText.trim();
    if (!trimmed || disabled) return;
    onAddItem(trimmed);
    setNewItemText("");
  };

  return (
    <div className="space-y-2.5">
      {/* Header with Title and Ratio */}
      <div className="flex items-center justify-between">
        <label className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          Checklist
        </label>
        {totalCount > 0 && (
          <span className="text-[11px] font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
            {completedCount}/{totalCount} • {percentage}%
          </span>
        )}
      </div>

      {/* Tactile Animated Progress Bar */}
      {totalCount > 0 && (
        <div
          role="progressbar"
          aria-valuenow={percentage}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Checklist progress"
          className="h-1.5 w-full overflow-hidden rounded-full bg-[#E4E8F2] dark:bg-[#132E74]"
        >
          <div
            className="h-full rounded-full bg-[#FD91CC] transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}

      {/* Checklist Items List */}
      {items.length > 0 && (
        <div className="space-y-1.5 pt-0.5">
          {items.map((item) => (
            <div
              key={item.id}
              className="group flex items-center justify-between gap-2 rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/50 px-2.5 py-1.5 text-xs transition-colors hover:border-[#CAD5E8] dark:border-[#132E74] dark:bg-[#082363]/40 dark:hover:border-[#1F459E]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onToggleItem(item.id, item.done)}
                  aria-label={item.done ? `Mark "${item.text}" incomplete` : `Mark "${item.text}" complete`}
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-all cursor-pointer focus-ring-pink",
                    item.done
                      ? "border-[#FD91CC] bg-[#FD91CC] text-[#051A4D]"
                      : "border-[#CAD5E8] bg-white hover:border-[#09318D] dark:border-[#1F459E] dark:bg-[#051A4D]"
                  )}
                >
                  {item.done && <Check className="h-3 w-3 stroke-[3]" />}
                </button>
                <span
                  className={cn(
                    "truncate transition-all text-[#0B1220] dark:text-white",
                    item.done && "line-through text-[#5B6478]/70 dark:text-[#9BB0D3]/60"
                  )}
                >
                  {item.text}
                </span>
              </div>

              <button
                type="button"
                disabled={disabled}
                onClick={() => onDeleteItem(item.id)}
                aria-label={`Delete checklist item "${item.text}"`}
                className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-[#5B6478] hover:text-rose-500 transition-opacity p-0.5 rounded cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Item Form */}
      <form onSubmit={handleSubmit} className="flex gap-1.5 pt-0.5">
        <input
          type="text"
          value={newItemText}
          onChange={(e) => setNewItemText(e.target.value)}
          placeholder="Add checklist item..."
          disabled={disabled}
          className="flex-1 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1 text-xs placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white dark:placeholder:text-[#9BB0D3]/50"
        />
        <button
          type="submit"
          disabled={!newItemText.trim() || disabled}
          aria-label="Add checklist item"
          className="flex items-center justify-center rounded-lg bg-[#09318D] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#0D41B4] disabled:opacity-40 transition-colors cursor-pointer focus-ring-pink dark:bg-[#0D41B4] dark:hover:bg-[#134EC9]"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
