"use client";

import * as React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Archive,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Flag,
  Folder,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { priorityUiToBackend } from "@/lib/adapters";
import type { BackendSection } from "@/lib/api";
import type { Priority, TaskItem } from "./types";
import { TagPickerPopover } from "./tag-picker-popover";

export interface TaskContextMenuProps {
  task: TaskItem;
  anchor: { x: number; y: number };
  sections: BackendSection[];
  userId?: string | null;
  onClose: () => void;
  onOpen: (task: TaskItem) => void;
  onDuplicate?: (id: string) => void;
  onArchive?: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdateTask?: (task: TaskItem) => void;
  onMoveToSection?: (taskId: string, sectionId: string | null) => void;
}

const ITEM_CLASS =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#0B1220] hover:bg-[#F2F5FC] transition-colors cursor-pointer dark:text-[#E4E8F2] dark:hover:bg-[#082363] text-left";

export function TaskContextMenu({
  task,
  anchor,
  sections,
  userId = null,
  onClose,
  onOpen,
  onDuplicate,
  onArchive,
  onDelete,
  onUpdateTask,
  onMoveToSection,
}: TaskContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState(anchor);
  const [openSub, setOpenSub] = useState<"move" | "priority" | null>(null);

  // Clamp into the viewport once measured.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos({
      x: Math.max(8, Math.min(anchor.x, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(anchor.y, window.innerHeight - rect.height - 8)),
    });
  }, [anchor.x, anchor.y]);

  // Focus the first item for keyboard users; dismiss on outside/scroll/Escape.
  useEffect(() => {
    firstItemRef.current?.focus();
    const handlePointer = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const setPriority = (priority: Priority) => {
    if (!onUpdateTask) return;
    onUpdateTask({
      ...task,
      priority,
      numericPriority: priorityUiToBackend(priority),
      updatedAt: "Just now",
    });
    onClose();
  };

  const showMove = Boolean(onMoveToSection && sections.length > 0);
  const showTags = Boolean(onUpdateTask);
  const showPriority = Boolean(onUpdateTask);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${task.title}`}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      className="fixed z-[70] w-56 rounded-xl border border-[#E4E8F2] bg-white p-1 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: pos.x, top: pos.y }}
    >
      <button
        ref={firstItemRef}
        type="button"
        role="menuitem"
        onClick={act(() => onOpen(task))}
        className={ITEM_CLASS}
      >
        <ExternalLink className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
        <span>Open</span>
      </button>

      {onDuplicate && (
        <button
          type="button"
          role="menuitem"
          onClick={act(() => onDuplicate(task.id))}
          className={ITEM_CLASS}
        >
          <Copy className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
          <span>Duplicate</span>
        </button>
      )}

      {showMove && (
        <div>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openSub === "move"}
            onClick={() => setOpenSub(openSub === "move" ? null : "move")}
            className={cn(ITEM_CLASS, "justify-between")}
          >
            <span className="flex items-center gap-2">
              <Folder className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
              <span>Move to…</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 opacity-60" />
          </button>
          {openSub === "move" && (
            <div role="menu" aria-label="Move to section" className="ml-4 border-l border-[#E4E8F2] pl-1 dark:border-[#132E74]">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={!task.sectionId}
                onClick={act(() => onMoveToSection?.(task.id, null))}
                className={cn(ITEM_CLASS, !task.sectionId && "font-bold")}
              >
                {!task.sectionId && <Check className="h-3.5 w-3.5" />}
                <span className={cn(!task.sectionId && "ml-0", task.sectionId && "ml-[22px]")}>
                  Unsectioned
                </span>
              </button>
              {sections.map((s) => {
                const isCurrent = task.sectionId === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isCurrent}
                    onClick={act(() => onMoveToSection?.(task.id, s.id))}
                    className={cn(ITEM_CLASS, isCurrent && "font-bold")}
                  >
                    {isCurrent && <Check className="h-3.5 w-3.5" />}
                    <span className={cn("truncate", !isCurrent && "ml-[22px]")}>{s.name}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showTags && (
        <TagPickerPopover
          taskId={task.id}
          activeTags={task.tags}
          activeTagIds={task.tagIds ?? []}
          userId={userId}
          label="Add tag"
          triggerClassName={cn(ITEM_CLASS, "[&_span]:flex-1")}
          onTagsUpdated={(names, ids) => {
            onUpdateTask?.({ ...task, tags: names, tagIds: ids, updatedAt: "Just now" });
          }}
        />
      )}

      {showPriority && (
        <div>
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={openSub === "priority"}
            onClick={() => setOpenSub(openSub === "priority" ? null : "priority")}
            className={cn(ITEM_CLASS, "justify-between")}
          >
            <span className="flex items-center gap-2">
              <Flag className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
              <span>Priority</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 opacity-60" />
          </button>
          {openSub === "priority" && (
            <div role="menu" aria-label="Set priority" className="ml-4 border-l border-[#E4E8F2] pl-1 dark:border-[#132E74]">
              {(
                [
                  { id: "high" as const, label: "High", dot: "bg-rose-500" },
                  { id: "med" as const, label: "Medium", dot: "bg-amber-500" },
                  { id: "low" as const, label: "Low", dot: "bg-blue-500" },
                ]
              ).map((p) => {
                const isCurrent = task.priority === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isCurrent}
                    onClick={() => setPriority(p.id)}
                    className={cn(ITEM_CLASS, isCurrent && "font-bold")}
                  >
                    <span className={cn("h-2 w-2 rounded-full shrink-0", p.dot)} />
                    <span className="flex-1">{p.label}</span>
                    {isCurrent && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {onArchive && (
        <button
          type="button"
          role="menuitem"
          onClick={act(() => onArchive(task.id))}
          className={ITEM_CLASS}
        >
          <Archive className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
          <span>Archive</span>
        </button>
      )}

      <hr className="my-1 border-[#E4E8F2] dark:border-[#132E74]" />

      <button
        type="button"
        role="menuitem"
        onClick={act(() => onDelete(task.id))}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer dark:text-rose-400 dark:hover:bg-rose-950/40 text-left"
      >
        <Trash2 className="h-3.5 w-3.5 text-rose-500" />
        <span>Delete</span>
      </button>
    </div>
  );
}
