"use client";

import * as React from "react";
import { useState, useRef, useEffect, useMemo } from "react";
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
  HelpCircle,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Pencil,
  Trash2,
  Archive,
  FolderPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { BackendList, BackendFolder } from "@/lib/api";
import type { ListId, FolderId } from "./types";

interface SidebarProps {
  activeList: ListId;
  onSelectList: (list: ListId) => void;
  activeListId?: string | null;
  onSelectListId?: (listId: string | null) => void;
  activeFolder: FolderId | null;
  onSelectFolder: (folder: FolderId | null) => void;

  // Dynamic backend data
  lists?: BackendList[];
  folders?: BackendFolder[];
  inboxList?: BackendList | null;

  // Counts
  listCounts?: Record<string, number>;
  folderCounts?: Record<string, number>;

  // Sidebar Controls
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenCommandPalette: () => void;
  onOpenShortcuts?: () => void;
  onNewTask: () => void;

  // Container Action Modals & CRUD
  onCreateList?: (folderId?: string | null) => void;
  onEditList?: (list: BackendList) => void;
  onArchiveList?: (list: BackendList) => void;
  onDeleteList?: (list: BackendList) => void;
  onCreateFolder?: () => void;
  onEditFolder?: (folder: BackendFolder) => void;
  onDeleteFolder?: (folder: BackendFolder) => void;

  className?: string;
}

const SMART_VIEWS: { id: "today" | "upcoming" | "completed"; label: string; icon: React.ElementType }[] = [
  { id: "today", label: "Today", icon: Calendar },
  { id: "upcoming", label: "Upcoming", icon: Clock },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
];

export function Sidebar({
  activeList,
  onSelectList,
  activeListId,
  onSelectListId,
  activeFolder,
  onSelectFolder,
  lists = [],
  folders = [],
  inboxList = null,
  listCounts = {},
  folderCounts = {},
  isCollapsed,
  onToggleCollapse,
  onOpenCommandPalette,
  onOpenShortcuts,
  onNewTask,
  onCreateList,
  onEditList,
  onArchiveList,
  onDeleteList,
  onCreateFolder,
  onEditFolder,
  onDeleteFolder,
  className,
}: SidebarProps) {
  // Folder expanded state
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());

  // Context Menu State
  const [menuState, setMenuState] = useState<{
    type: "folder" | "list";
    id: string;
  } | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!menuState) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuState(null);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuState(null);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuState]);

  // Toggle folder expansion
  const toggleFolderExpand = (folderId: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // Find effective inbox list
  const resolvedInboxList = useMemo(() => {
    return inboxList || lists.find((l) => l.isInbox) || null;
  }, [inboxList, lists]);

  // Group lists: root vs in folders
  const rootLists = useMemo(() => {
    return lists.filter((l) => !l.folderId && !l.isInbox);
  }, [lists]);

  const folderListsMap = useMemo(() => {
    const map = new Map<string, BackendList[]>();
    for (const folder of folders) {
      map.set(
        folder.id,
        lists.filter((l) => l.folderId === folder.id && !l.isInbox)
      );
    }
    return map;
  }, [folders, lists]);

  // Is inbox active?
  const isInboxActive =
    (resolvedInboxList && activeListId === resolvedInboxList.id) ||
    activeList === "backlog" ||
    activeList === "inbox";

  // Inbox count
  const inboxCount = resolvedInboxList
    ? listCounts[resolvedInboxList.id] ?? listCounts["backlog"] ?? 0
    : listCounts["backlog"] ?? 0;

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
        {/* Pinned System Views Section */}
        <div>
          {!isCollapsed && (
            <div className="px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]/80">
              System Views
            </div>
          )}

          <nav className="space-y-1" aria-label="System Views">
            {/* 1. Default Inbox (Pinned at Top) */}
            <button
              type="button"
              onClick={() => {
                if (resolvedInboxList) {
                  onSelectListId?.(resolvedInboxList.id);
                  onSelectList(resolvedInboxList.id);
                } else {
                  onSelectListId?.(null);
                  onSelectList("backlog");
                }
                onSelectFolder(null);
              }}
              title={isCollapsed ? `Inbox (${inboxCount})` : undefined}
              className={cn(
                "group relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150 cursor-pointer focus-ring-pink",
                isInboxActive
                  ? "bg-[#09318D] text-white shadow-xs dark:bg-[#0D41B4] dark:text-white"
                  : "text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white",
                isCollapsed && "justify-center px-0"
              )}
            >
              <Inbox
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isInboxActive
                    ? "text-white"
                    : "text-[#09318D] dark:text-[#FFA8D7]"
                )}
              />

              {!isCollapsed && (
                <>
                  <span className="flex-1 text-left font-semibold truncate">Inbox</span>
                  {/* Bubblegum Pink badge count */}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-mono font-bold transition-colors",
                      isInboxActive
                        ? "bg-white/20 text-white"
                        : "bg-[#FD91CC]/20 text-[#09318D] dark:text-[#FFA8D7]"
                    )}
                  >
                    {inboxCount}
                  </span>
                </>
              )}
            </button>

            {/* 2. Smart Views (Today, Upcoming, Completed) */}
            {SMART_VIEWS.map((item) => {
              const Icon = item.icon;
              const isActive = activeList === item.id && !activeListId && activeFolder === null;
              const count = listCounts[item.id] ?? 0;

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onSelectListId?.(null);
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

        {/* Folders Section with Collapsible Trees */}
        <div>
          {!isCollapsed && (
            <div className="flex items-center justify-between px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]/80">
              <span>Folders</span>
              {onCreateFolder && (
                <button
                  type="button"
                  onClick={onCreateFolder}
                  className="flex h-5 w-5 items-center justify-center rounded text-[#5B6478] hover:bg-[#E4E8F2] hover:text-[#09318D] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7] cursor-pointer"
                  title="Create New Folder"
                  aria-label="Create New Folder"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          <nav className="space-y-1" aria-label="Folders">
            {folders.map((folder) => {
              const isFolderActive = activeFolder === folder.id;
              const isExpanded = expandedFolderIds.has(folder.id);
              const folderLists = folderListsMap.get(folder.id) || [];
              const count = folderCounts[folder.id] ?? 0;
              const folderDotColor = folder.color || "#09318D";

              return (
                <div key={folder.id} className="relative">
                  {/* Folder Row */}
                  <div
                    className={cn(
                      "group flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer focus-ring-pink",
                      isFolderActive
                        ? "bg-[#09318D]/10 text-[#09318D] border border-[#09318D]/20 dark:bg-[#FD91CC]/15 dark:text-[#FFA8D7] dark:border-[#FD91CC]/30 font-semibold"
                        : "text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white"
                    )}
                  >
                    {/* Expand/Collapse Chevron */}
                    {!isCollapsed && (
                      <button
                        type="button"
                        onClick={(e) => toggleFolderExpand(folder.id, e)}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[#5B6478] hover:bg-[#E4E8F2]/60 hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] cursor-pointer"
                        aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}

                    {/* Folder Click Body */}
                    <div
                      className="flex-1 flex items-center gap-2 min-w-0"
                      onClick={() => {
                        onSelectFolder(isFolderActive ? null : folder.id);
                        if (!isExpanded) {
                          toggleFolderExpand(folder.id);
                        }
                      }}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: folderDotColor }}
                      />
                      {!isCollapsed && (
                        <span className="flex-1 text-left truncate">{folder.name}</span>
                      )}
                    </div>

                    {!isCollapsed && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-mono font-medium text-[#5B6478] dark:text-[#9BB0D3]">
                          {count}
                        </span>

                        {/* Folder Context Menu Trigger */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(
                              menuState?.id === folder.id ? null : { type: "folder", id: folder.id }
                            );
                          }}
                          className="opacity-0 group-hover:opacity-100 flex h-6 w-6 items-center justify-center rounded hover:bg-[#E4E8F2] hover:text-[#0B1220] dark:hover:bg-[#051A4D] transition-opacity cursor-pointer"
                          aria-label={`Folder options for ${folder.name}`}
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Folder Context Dropdown Menu */}
                  {menuState?.type === "folder" && menuState.id === folder.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-2 top-8 z-50 w-44 overflow-hidden rounded-xl border border-[#E4E8F2] bg-white p-1 text-xs shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] animate-in fade-in-50 zoom-in-95 duration-100"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuState(null);
                          onCreateList?.(folder.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer"
                      >
                        <FolderPlus className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
                        <span>Add List to Folder</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuState(null);
                          onEditFolder?.(folder);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edit Folder</span>
                      </button>
                      <div className="my-1 border-t border-[#E4E8F2] dark:border-[#132E74]" />
                      <button
                        type="button"
                        onClick={() => {
                          setMenuState(null);
                          if (
                            window.confirm(
                              `Delete folder "${folder.name}"? Lists inside will move to root.`
                            )
                          ) {
                            onDeleteFolder?.(folder);
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete Folder</span>
                      </button>
                    </div>
                  )}

                  {/* Nested Lists under Folder */}
                  {!isCollapsed && isExpanded && (
                    <div className="ml-4 pl-3 border-l-2 border-[#E4E8F2] dark:border-[#132E74] my-1 space-y-0.5">
                      {folderLists.map((list) => {
                        const isListActive = activeListId === list.id;
                        const listCount = listCounts[list.id] ?? 0;
                        const listDotColor = list.color || folderDotColor;

                        return (
                          <div key={list.id} className="relative group/list">
                            <div
                              onClick={() => {
                                onSelectListId?.(list.id);
                                onSelectList(list.id);
                                onSelectFolder(null);
                              }}
                              className={cn(
                                "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-150 cursor-pointer focus-ring-pink",
                                isListActive
                                  ? "bg-[#09318D] text-white shadow-xs dark:bg-[#0D41B4] dark:text-white"
                                  : "text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white"
                              )}
                            >
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                                style={{ backgroundColor: listDotColor }}
                              />
                              <span className="flex-1 text-left truncate">{list.name}</span>
                              <span
                                className={cn(
                                  "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                                  isListActive
                                    ? "bg-white/20 text-white font-semibold"
                                    : "text-[#5B6478] dark:text-[#9BB0D3]"
                                )}
                              >
                                {listCount}
                              </span>

                              {/* List Context Menu Trigger */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setMenuState(
                                    menuState?.id === list.id ? null : { type: "list", id: list.id }
                                  );
                                }}
                                className="opacity-0 group-hover/list:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 transition-opacity cursor-pointer"
                                aria-label={`Options for ${list.name}`}
                              >
                                <MoreHorizontal className="h-3 w-3" />
                              </button>
                            </div>

                            {/* Nested List Context Menu */}
                            {menuState?.type === "list" && menuState.id === list.id && (
                              <div
                                ref={menuRef}
                                className="absolute right-0 top-7 z-50 w-40 overflow-hidden rounded-xl border border-[#E4E8F2] bg-white p-1 text-xs shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] animate-in fade-in-50 zoom-in-95 duration-100"
                              >
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuState(null);
                                    onEditList?.(list);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                  <span>Edit List</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuState(null);
                                    onArchiveList?.(list);
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer"
                                >
                                  <Archive className="h-3.5 w-3.5" />
                                  <span>Archive List</span>
                                </button>
                                <div className="my-1 border-t border-[#E4E8F2] dark:border-[#132E74]" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    setMenuState(null);
                                    if (window.confirm(`Delete list "${list.name}"?`)) {
                                      onDeleteList?.(list);
                                    }
                                  }}
                                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  <span>Delete List</span>
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {folderLists.length === 0 && (
                        <div className="py-1 px-2 text-[11px] text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic">
                          No lists in this folder
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {folders.length === 0 && !isCollapsed && (
              <div className="px-2 py-1 text-[11px] text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic">
                No folders yet
              </div>
            )}
          </nav>
        </div>

        {/* Root Lists Section */}
        <div>
          {!isCollapsed && (
            <div className="flex items-center justify-between px-2 pb-2 text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]/80">
              <span>Lists</span>
              {onCreateList && (
                <button
                  type="button"
                  onClick={() => onCreateList(null)}
                  className="flex h-5 w-5 items-center justify-center rounded text-[#5B6478] hover:bg-[#E4E8F2] hover:text-[#09318D] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7] cursor-pointer"
                  title="Create New List"
                  aria-label="Create New List"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          <nav className="space-y-1" aria-label="Root Lists">
            {rootLists.map((list) => {
              const isListActive = activeListId === list.id;
              const count = listCounts[list.id] ?? 0;
              const listDotColor = list.color || "#09318D";

              return (
                <div key={list.id} className="relative group/root">
                  <button
                    type="button"
                    onClick={() => {
                      onSelectListId?.(list.id);
                      onSelectList(list.id);
                      onSelectFolder(null);
                    }}
                    title={isCollapsed ? `${list.name} (${count})` : undefined}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs font-medium transition-all duration-150 cursor-pointer focus-ring-pink",
                      isListActive
                        ? "bg-[#09318D] text-white shadow-xs dark:bg-[#0D41B4] dark:text-white"
                        : "text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white",
                      isCollapsed && "justify-center px-0"
                    )}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: listDotColor }}
                    />

                    {!isCollapsed && (
                      <>
                        <span className="flex-1 text-left truncate">{list.name}</span>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-mono font-semibold",
                            isListActive
                              ? "bg-white/20 text-white"
                              : "bg-[#F2F5FC] text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]"
                          )}
                        >
                          {count}
                        </span>

                        {/* List Context Menu Trigger */}
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuState(
                              menuState?.id === list.id ? null : { type: "list", id: list.id }
                            );
                          }}
                          className="opacity-0 group-hover/root:opacity-100 flex h-5 w-5 items-center justify-center rounded hover:bg-black/10 dark:hover:bg-white/10 transition-opacity cursor-pointer"
                          aria-label={`Options for ${list.name}`}
                        >
                          <MoreHorizontal className="h-3 w-3" />
                        </span>
                      </>
                    )}
                  </button>

                  {/* Root List Context Dropdown */}
                  {menuState?.type === "list" && menuState.id === list.id && (
                    <div
                      ref={menuRef}
                      className="absolute right-2 top-8 z-50 w-40 overflow-hidden rounded-xl border border-[#E4E8F2] bg-white p-1 text-xs shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] animate-in fade-in-50 zoom-in-95 duration-100"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setMenuState(null);
                          onEditList?.(list);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span>Edit List</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuState(null);
                          onArchiveList?.(list);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer"
                      >
                        <Archive className="h-3.5 w-3.5" />
                        <span>Archive List</span>
                      </button>
                      <div className="my-1 border-t border-[#E4E8F2] dark:border-[#132E74]" />
                      <button
                        type="button"
                        onClick={() => {
                          setMenuState(null);
                          if (window.confirm(`Delete list "${list.name}"?`)) {
                            onDeleteList?.(list);
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete List</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {rootLists.length === 0 && !isCollapsed && (
              <div className="px-2 py-1 text-[11px] text-[#5B6478]/70 dark:text-[#9BB0D3]/60 italic">
                No root lists
              </div>
            )}
          </nav>
        </div>
      </div>

      {/* Sidebar Footer Keyboard Trigger & Help */}
      <div className="border-t border-[#E4E8F2] p-3 dark:border-[#132E74] flex items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenCommandPalette}
          className={cn(
            "flex-1 flex items-center justify-between rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/80 px-2.5 py-2 text-xs text-[#5B6478] transition-colors hover:border-[#CBD5E1] hover:text-[#0B1220] dark:border-[#132E74] dark:bg-[#082363]/60 dark:text-[#9BB0D3] dark:hover:text-white focus-ring-pink cursor-pointer",
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

        {onOpenShortcuts && (
          <button
            type="button"
            onClick={onOpenShortcuts}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/80 text-[#5B6478] transition-colors hover:border-[#CBD5E1] hover:text-[#09318D] dark:border-[#132E74] dark:bg-[#082363]/60 dark:text-[#9BB0D3] dark:hover:text-[#FFA8D7] focus-ring-pink cursor-pointer"
            title="Keyboard shortcuts (?)"
            aria-label="Keyboard shortcuts"
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        )}
      </div>
    </aside>
  );
}
