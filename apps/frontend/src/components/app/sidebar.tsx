"use client";

import * as React from "react";
import {
  Calendar,
  Clock,
  Inbox,
  CheckCircle2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Command,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListId, FolderId } from "./types";

interface SidebarProps {
  activeList: ListId;
  onSelectList: (list: ListId) => void;
  activeFolder: FolderId | null;
  onSelectFolder: (folder: FolderId | null) => void;
  listCounts: Record<ListId, number>;
  folderCounts: Record<FolderId, number>;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenCommandPalette: () => void;
  onNewTask: () => void;
  className?: string;
}

const LIST_ITEMS: { id: ListId; label: string; icon: React.ElementType }[] = [
  { id: "today", label: "Today", icon: Calendar },
  { id: "upcoming", label: "Upcoming", icon: Clock },
  { id: "backlog", label: "Backlog", icon: Inbox },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
];

const FOLDER_ITEMS: { id: FolderId; label: string; colorClass: string; dotHex: string }[] = [
  { id: "engineering", label: "Engineering", colorClass: "text-[#09318D] dark:text-[#9BB0D3]", dotHex: "#09318D" },
  { id: "design", label: "Design", colorClass: "text-[#FD91CC]", dotHex: "#FD91CC" },
  { id: "personal", label: "Personal", colorClass: "text-amber-500", dotHex: "#F59E0B" },
];

export function Sidebar({
  activeList,
  onSelectList,
  activeFolder,
  onSelectFolder,
  listCounts,
  folderCounts,
  isCollapsed,
  onToggleCollapse,
  onOpenCommandPalette,
  onNewTask,
  className,
}: SidebarProps) {
  return (
    <aside
      aria-label="Application Navigation"
      className={cn(
        "relative flex flex-col border-r border-[#E4E8F2] bg-white transition-all duration-200 select-none dark:border-[#132E74] dark:bg-[#051A4D]",
        isCollapsed ? "w-16" : "w-64 sm:w-72",
        className
      )}
    >
      {/* Sidebar Header */}
      <div className="flex h-16 items-center justify-between border-b border-[#E4E8F2] px-3.5 dark:border-[#132E74]">
        {!isCollapsed && (
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#09318D] text-white shadow-sm dark:bg-[#0D41B4]">
              <Sparkles className="h-4 w-4 text-[#FD91CC]" />
            </div>
            <div className="truncate">
              <span className="text-sm font-bold tracking-tight text-[#0B1220] dark:text-white">
                Todo Studio
              </span>
              <span className="block text-[10px] font-mono text-[#5B6478] dark:text-[#9BB0D3]">
                v0.1.0 • ElysiaJS
              </span>
            </div>
          </div>
        )}

        {isCollapsed && (
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-lg bg-[#09318D] text-white shadow-sm dark:bg-[#0D41B4]">
            <Sparkles className="h-4 w-4 text-[#FD91CC]" />
          </div>
        )}

        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex h-8 w-8 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white cursor-pointer"
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Quick Action Button */}
      <div className="p-3">
        <button
          type="button"
          onClick={onNewTask}
          className={cn(
            "btn-primary-depth flex w-full items-center justify-center gap-2 rounded-lg py-2 text-xs font-semibold text-white shadow-xs focus-ring-pink cursor-pointer",
            isCollapsed ? "h-10 px-0" : "px-3"
          )}
          title="Create New Task (N)"
        >
          <Plus className="h-4 w-4 stroke-[2.5]" />
          {!isCollapsed && <span>New Task</span>}
        </button>
      </div>

      {/* Main Navigation Lists */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-6">
        <div>
          {!isCollapsed && (
            <div className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]/80">
              Views
            </div>
          )}

          <nav className="space-y-1" aria-label="Views">
            {LIST_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeList === item.id && activeFolder === null;
              const count = listCounts[item.id] ?? 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectList(item.id);
                    onSelectFolder(null);
                  }}
                  title={isCollapsed ? `${item.label} (${count})` : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150 cursor-pointer focus-ring-pink",
                    isActive
                      ? "bg-[#09318D] text-white shadow-xs dark:bg-[#0D41B4] dark:text-white"
                      : "text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white",
                    isCollapsed && "justify-center px-0"
                  )}
                >
                  <Icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive
                        ? "text-white"
                        : "text-[#5B6478] dark:text-[#9BB0D3]"
                    )}
                  />

                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold",
                          isActive
                            ? "bg-white/20 text-white"
                            : "bg-[#F2F5FC] text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]"
                        )}
                      >
                        {count}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Folders / Projects Section */}
        <div>
          {!isCollapsed && (
            <div className="flex items-center justify-between px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]/80">
              <span>Folders</span>
            </div>
          )}

          <nav className="space-y-1" aria-label="Folders">
            {FOLDER_ITEMS.map((item) => {
              const isFolderActive = activeFolder === item.id;
              const count = folderCounts[item.id] ?? 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectFolder(isFolderActive ? null : item.id)}
                  title={isCollapsed ? `${item.label} (${count})` : undefined}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150 cursor-pointer focus-ring-pink",
                    isFolderActive
                      ? "bg-[#09318D]/10 text-[#09318D] border border-[#09318D]/20 dark:bg-[#FD91CC]/15 dark:text-[#FFA8D7] dark:border-[#FD91CC]/30 font-semibold"
                      : "text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white",
                    isCollapsed && "justify-center px-0"
                  )}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.dotHex }}
                  />

                  {!isCollapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      <span className="text-[10px] font-mono font-medium text-[#5B6478] dark:text-[#9BB0D3]">
                        {count}
                      </span>
                    </>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Sidebar Footer Keyboard Trigger */}
      <div className="border-t border-[#E4E8F2] p-3 dark:border-[#132E74]">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/80 px-2.5 py-2 text-xs text-[#5B6478] transition-colors hover:border-[#CBD5E1] hover:text-[#0B1220] dark:border-[#132E74] dark:bg-[#082363]/60 dark:text-[#9BB0D3] dark:hover:text-white focus-ring-pink cursor-pointer",
            isCollapsed && "justify-center px-0"
          )}
          title="Open Command Palette (Cmd+K)"
        >
          <div className="flex items-center gap-2">
            <Command className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
            {!isCollapsed && <span className="font-medium">Command</span>}
          </div>
          {!isCollapsed && (
            <kbd className="rounded border border-[#E4E8F2] bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#5B6478] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3]">
              ⌘K
            </kbd>
          )}
        </button>
      </div>
    </aside>
  );
}
