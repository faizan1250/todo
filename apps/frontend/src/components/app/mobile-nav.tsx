"use client";

import * as React from "react";
import {
  Calendar,
  Folder,
  Plus,
  Command,
  SunMoon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListId, FolderId } from "./types";

interface MobileNavProps {
  activeList: ListId;
  onSelectList: (list: ListId) => void;
  activeFolder: FolderId | null;
  onCycleFolder: () => void;
  onOpenCommandPalette: () => void;
  onNewTask: () => void;
  onToggleTheme: () => void;
}

export function MobileNav({
  activeList,
  onSelectList,
  activeFolder,
  onCycleFolder,
  onOpenCommandPalette,
  onNewTask,
  onToggleTheme,
}: MobileNavProps) {
  return (
    <nav
      aria-label="Mobile Navigation"
      className="fixed bottom-0 inset-x-0 z-40 sm:hidden border-t border-[#E4E8F2] bg-white/95 backdrop-blur-md dark:border-[#132E74] dark:bg-[#051A4D]/95 select-none"
    >
      <div className="flex h-16 items-center justify-around px-2">
        {/* Today Tasks */}
        <button
          type="button"
          onClick={() => onSelectList("today")}
          className={cn(
            "flex flex-col items-center justify-center gap-1 min-w-[56px] py-1 text-[10px] font-medium transition-colors cursor-pointer",
            activeList === "today"
              ? "text-[#09318D] dark:text-[#FD91CC] font-bold"
              : "text-[#5B6478] dark:text-[#9BB0D3]"
          )}
        >
          <Calendar className="h-4 w-4" />
          <span>Today</span>
        </button>

        {/* Folders Toggle */}
        <button
          type="button"
          onClick={onCycleFolder}
          className={cn(
            "flex flex-col items-center justify-center gap-1 min-w-[56px] py-1 text-[10px] font-medium transition-colors cursor-pointer",
            activeFolder !== null
              ? "text-[#09318D] dark:text-[#FD91CC] font-bold"
              : "text-[#5B6478] dark:text-[#9BB0D3]"
          )}
        >
          <Folder className="h-4 w-4" />
          <span className="capitalize">{activeFolder || "Folders"}</span>
        </button>

        {/* Central Add Task Button */}
        <button
          type="button"
          onClick={onNewTask}
          aria-label="Create new task"
          className="btn-accent-pink -mt-5 flex h-12 w-12 items-center justify-center rounded-full text-[#051A4D] shadow-lg cursor-pointer focus-ring-pink"
        >
          <Plus className="h-6 w-6 stroke-[2.5]" />
        </button>

        {/* Command Palette Trigger */}
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className="flex flex-col items-center justify-center gap-1 min-w-[56px] py-1 text-[10px] font-medium text-[#5B6478] dark:text-[#9BB0D3] transition-colors cursor-pointer"
        >
          <Command className="h-4 w-4" />
          <span>Cmd ⌘</span>
        </button>

        {/* Theme Switcher */}
        <button
          type="button"
          onClick={onToggleTheme}
          aria-label="Toggle light and dark theme"
          className="flex flex-col items-center justify-center gap-1 min-w-[56px] py-1 text-[10px] font-medium text-[#5B6478] dark:text-[#9BB0D3] transition-colors cursor-pointer"
        >
          <SunMoon className="h-4 w-4" />
          <span>Theme</span>
        </button>
      </div>
    </nav>
  );
}
