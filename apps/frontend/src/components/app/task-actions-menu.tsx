"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import {
  MoreHorizontal,
  Copy,
  BookmarkPlus,
  Archive,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TaskActionsMenuProps {
  onDuplicate: () => void;
  onSaveAsTemplate: () => void;
  onArchive: () => void;
  onDelete: () => void;
  disabled?: boolean;
}

export function TaskActionsMenu({
  onDuplicate,
  onSaveAsTemplate,
  onArchive,
  onDelete,
  disabled = false,
}: TaskActionsMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside to dismiss
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleAction = (callback: () => void) => {
    setIsOpen(false);
    callback();
  };

  return (
    <div className="relative inline-block" ref={menuRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="More task actions"
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white cursor-pointer",
          isOpen && "bg-[#F2F5FC] text-[#09318D] dark:bg-[#082363] dark:text-white"
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Task actions"
          className="absolute right-0 top-full z-50 mt-1.5 w-48 rounded-xl border border-[#E4E8F2] bg-white p-1 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D] animate-in fade-in zoom-in-95 duration-100"
        >
          {/* Duplicate Task */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleAction(onDuplicate)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#0B1220] hover:bg-[#F2F5FC] transition-colors cursor-pointer dark:text-[#E4E8F2] dark:hover:bg-[#082363]"
          >
            <Copy className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
            <span>Duplicate Task</span>
          </button>

          {/* Save as Template */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleAction(onSaveAsTemplate)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#0B1220] hover:bg-[#F2F5FC] transition-colors cursor-pointer dark:text-[#E4E8F2] dark:hover:bg-[#082363]"
          >
            <BookmarkPlus className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
            <span>Save as Template</span>
          </button>

          {/* Archive Task */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleAction(onArchive)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#0B1220] hover:bg-[#F2F5FC] transition-colors cursor-pointer dark:text-[#E4E8F2] dark:hover:bg-[#082363]"
          >
            <Archive className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
            <span>Archive Task</span>
          </button>

          <hr className="my-1 border-[#E4E8F2] dark:border-[#132E74]" />

          {/* Delete Task */}
          <button
            type="button"
            role="menuitem"
            onClick={() => handleAction(onDelete)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer dark:text-rose-400 dark:hover:bg-rose-950/40"
          >
            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
            <span>Delete Task</span>
          </button>
        </div>
      )}
    </div>
  );
}
