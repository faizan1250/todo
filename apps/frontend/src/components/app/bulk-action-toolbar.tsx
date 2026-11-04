"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import {
  CheckCircle2,
  RotateCcw,
  FolderInput,
  Flag,
  Archive,
  Trash2,
  X,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackendList } from "@/lib/api";

export interface BulkActionToolbarProps {
  selectedCount: number;
  totalCount: number;
  lists: BackendList[];
  onSelectAll: () => void;
  onClearSelection: () => void;
  onComplete: () => void;
  onReopen: () => void;
  onMoveToList: (listId: string) => void;
  onSetPriority: (priority: number) => void;
  onArchive: () => void;
  onDelete: () => void;
  isSubmitting?: boolean;
}

const PRIORITIES = [
  { value: 4, label: "P1 Urgent", colorClass: "text-rose-600 dark:text-rose-400", dotClass: "bg-rose-600" },
  { value: 3, label: "P2 High", colorClass: "text-orange-600 dark:text-orange-400", dotClass: "bg-orange-500" },
  { value: 2, label: "P3 Medium", colorClass: "text-amber-600 dark:text-amber-400", dotClass: "bg-amber-500" },
  { value: 1, label: "P4 Low", colorClass: "text-blue-600 dark:text-blue-400", dotClass: "bg-blue-500" },
  { value: 0, label: "None", colorClass: "text-[#5B6478] dark:text-[#9BB0D3]", dotClass: "bg-[#CAD5E8]" },
];

export function BulkActionToolbar({
  selectedCount,
  totalCount,
  lists,
  onSelectAll,
  onClearSelection,
  onComplete,
  onReopen,
  onMoveToList,
  onSetPriority,
  onArchive,
  onDelete,
  isSubmitting = false,
}: BulkActionToolbarProps) {
  const [activeMenu, setActiveMenu] = useState<"move" | "priority" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    if (!activeMenu) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [activeMenu]);

  // Global Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeMenu) {
          setActiveMenu(null);
        } else {
          onClearSelection();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMenu, onClearSelection]);

  if (selectedCount <= 0) {
    return null;
  }

  const allSelected = totalCount > 0 && selectedCount >= totalCount;

  return (
    <div
      ref={containerRef}
      role="toolbar"
      aria-label="Bulk actions toolbar"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex max-w-[92vw] items-center gap-1.5 sm:gap-2 rounded-2xl border border-t-white/80 border-x-[#CAD5E8] border-b-[#9BB0D3] bg-white/95 dark:border-t-[#1F459E] dark:border-x-[#132E74] dark:border-b-[#030F2D] dark:bg-[#051A4D]/95 backdrop-blur-md px-3 sm:px-4 py-2 shadow-lift-blue animate-in fade-in-0 slide-in-from-bottom-4 duration-200 select-none"
    >
      {/* Selection pill */}
      <div className="flex items-center gap-1.5 pr-1 border-r border-[#E4E8F2] dark:border-[#132E74]">
        <span className="flex items-center rounded-full bg-[#09318D]/10 dark:bg-[#FD91CC]/20 px-2.5 py-1 text-xs font-mono font-semibold text-[#09318D] dark:text-[#FFA8D7]">
          {selectedCount} selected
        </span>

        <button
          type="button"
          onClick={allSelected ? onClearSelection : onSelectAll}
          disabled={isSubmitting}
          className="text-[11px] font-semibold text-[#5B6478] hover:text-[#09318D] dark:text-[#9BB0D3] dark:hover:text-[#FFA8D7] px-1.5 py-1 rounded transition-colors cursor-pointer"
          title={allSelected ? "Deselect all tasks" : "Select all tasks in view"}
        >
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>

      {/* Primary Actions Group */}
      <div className="flex items-center gap-1">
        {/* Complete */}
        <button
          type="button"
          onClick={onComplete}
          disabled={isSubmitting}
          className="btn-tier2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-[#F2F5FC] hover:text-[#09318D] dark:text-[#F8FAFC] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7] transition-all cursor-pointer disabled:opacity-50"
          title="Complete selected tasks"
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
          <span className="hidden sm:inline">Complete</span>
        </button>

        {/* Reopen */}
        <button
          type="button"
          onClick={onReopen}
          disabled={isSubmitting}
          className="btn-tier2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-[#F2F5FC] hover:text-[#09318D] dark:text-[#F8FAFC] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7] transition-all cursor-pointer disabled:opacity-50"
          title="Reopen selected tasks"
        >
          <RotateCcw className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
          <span className="hidden sm:inline">Reopen</span>
        </button>

        {/* Move to List Popover */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu((prev) => (prev === "move" ? null : "move"))}
            disabled={isSubmitting}
            aria-expanded={activeMenu === "move"}
            aria-haspopup="true"
            className={cn(
              "btn-tier2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50",
              activeMenu === "move"
                ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                : "text-[#0B1220] hover:bg-[#F2F5FC] hover:text-[#09318D] dark:text-[#F8FAFC] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7]"
            )}
            title="Move to list"
          >
            <FolderInput className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Move</span>
            <ChevronUp className="h-3 w-3 opacity-60" />
          </button>

          {activeMenu === "move" && (
            <div
              className="absolute bottom-full mb-2 left-0 z-50 w-48 max-h-56 overflow-y-auto rounded-xl border border-[#E4E8F2] bg-white p-1 text-xs shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] animate-in fade-in-0 zoom-in-95 duration-150"
            >
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                Move to list
              </div>
              {lists.map((list) => (
                <button
                  key={list.id}
                  type="button"
                  onClick={() => {
                    setActiveMenu(null);
                    onMoveToList(list.id);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#0B1220] hover:bg-[#F2F5FC] hover:text-[#09318D] dark:text-[#F8FAFC] dark:hover:bg-[#051A4D] dark:hover:text-white transition-colors cursor-pointer"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: list.color || "#09318D" }}
                  />
                  <span className="truncate flex-1">{list.name}</span>
                </button>
              ))}
              {lists.length === 0 && (
                <div className="px-2 py-2 text-center text-xs text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic">
                  No lists found
                </div>
              )}
            </div>
          )}
        </div>

        {/* Set Priority Popover */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu((prev) => (prev === "priority" ? null : "priority"))}
            disabled={isSubmitting}
            aria-expanded={activeMenu === "priority"}
            aria-haspopup="true"
            className={cn(
              "btn-tier2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50",
              activeMenu === "priority"
                ? "bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                : "text-[#0B1220] hover:bg-[#F2F5FC] hover:text-[#09318D] dark:text-[#F8FAFC] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7]"
            )}
            title="Set priority"
          >
            <Flag className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Priority</span>
            <ChevronUp className="h-3 w-3 opacity-60" />
          </button>

          {activeMenu === "priority" && (
            <div
              className="absolute bottom-full mb-2 left-0 z-50 w-40 overflow-hidden rounded-xl border border-[#E4E8F2] bg-white p-1 text-xs shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] animate-in fade-in-0 zoom-in-95 duration-150"
            >
              <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                Set priority
              </div>
              {PRIORITIES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => {
                    setActiveMenu(null);
                    onSetPriority(p.value);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left hover:bg-[#F2F5FC] dark:hover:bg-[#051A4D] transition-colors cursor-pointer"
                >
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", p.dotClass)} />
                  <span className={cn("font-medium", p.colorClass)}>{p.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Archive */}
        <button
          type="button"
          onClick={onArchive}
          disabled={isSubmitting}
          className="btn-tier2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-[#F2F5FC] hover:text-[#09318D] dark:text-[#F8FAFC] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7] transition-all cursor-pointer disabled:opacity-50"
          title="Archive selected tasks"
        >
          <Archive className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Archive</span>
        </button>

        {/* Delete */}
        <button
          type="button"
          onClick={onDelete}
          disabled={isSubmitting}
          className="btn-tier2 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 transition-all cursor-pointer disabled:opacity-50"
          title="Delete selected tasks"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Delete</span>
        </button>
      </div>

      {/* Clear selection X */}
      <div className="pl-1 border-l border-[#E4E8F2] dark:border-[#132E74]">
        <button
          type="button"
          onClick={onClearSelection}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white transition-colors cursor-pointer"
          title="Clear selection (Esc)"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
