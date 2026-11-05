"use client";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import {
  Trash2,
  RotateCcw,
  Search,
  X,
  CheckSquare,
  List,
  Folder,
  Layers,
  AlertTriangle,
  Loader2,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getTrash,
  restoreTrash,
  hardDeleteTrash,
  emptyTrash,  type TrashGroupedResponse,
  type BackendTask,
  type BackendList,
  type BackendFolder,
  type BackendSection,
} from "@/lib/api";
import { restoreFromTrash } from "../sync/conflict-actions";

export interface TrashModalProps {
  isOpen: boolean;
  onClose: () => void;
  onItemRestored?: (type: "task" | "list" | "folder" | "section", id: string) => void;
  userId?: string | null;
}

type TrashTab = "all" | "task" | "list" | "folder" | "section";

interface UnifiedTrashItem {
  id: string;
  type: "task" | "list" | "folder" | "section";
  title: string;
  deletedAt: string | number | null;
}

function formatRelativeTime(dateInput: string | number | null | undefined): string {
  if (!dateInput) return "Unknown date";
  const date = typeof dateInput === "number" ? new Date(dateInput) : new Date(dateInput);
  if (isNaN(date.getTime())) return "Unknown date";

  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

export function TrashModal({ isOpen, onClose, onItemRestored, userId = null }: TrashModalProps) {
  const [activeTab, setActiveTab] = useState<TrashTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isActionPending, setIsActionPending] = useState(false);
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Grouped items state
  const [trashData, setTrashData] = useState<{
    tasks: BackendTask[];
    lists: BackendList[];
    folders: BackendFolder[];
    sections: BackendSection[];
  }>({
    tasks: [],
    lists: [],
    folders: [],
    sections: [],
  });

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;

    getTrash()
      .then((response) => {
        if (!isMounted) return;
        if (
          response &&
          typeof response === "object" &&
          (
            "tasks" in response ||
            "lists" in response ||
            "folders" in response ||
            "sections" in response
          )
        ) {
          const grouped = response as TrashGroupedResponse;
          setTrashData({
            tasks: grouped.tasks || [],
            lists: grouped.lists || [],
            folders: grouped.folders || [],
            sections: grouped.sections || [],
          });
        } else {
          setTrashData({ tasks: [], lists: [], folders: [], sections: [] });
        }
        setIsLoading(false);
      })
      .catch((err) => {
        if (!isMounted) return;
        console.error("Failed to load trash:", err);
        setErrorMessage(
          err instanceof Error ? err.message : "Failed to load trash items"
        );
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Combine items into unified list
  const allItems: UnifiedTrashItem[] = useMemo(() => {
    const list: UnifiedTrashItem[] = [];

    trashData.tasks.forEach((t) => {
      list.push({
        id: t.id,
        type: "task",
        title: t.title || "Untitled Task",
        deletedAt: t.deletedAt ?? null,
      });
    });

    trashData.lists.forEach((l) => {
      list.push({
        id: l.id,
        type: "list",
        title: l.name || "Untitled List",
        deletedAt: l.deletedAt ?? null,
      });
    });

    trashData.folders.forEach((f) => {
      list.push({
        id: f.id,
        type: "folder",
        title: f.name || "Untitled Folder",
        deletedAt: f.deletedAt ?? null,
      });
    });

    trashData.sections.forEach((s) => {
      list.push({
        id: s.id,
        type: "section",
        title: s.name || "Untitled Section",
        deletedAt: s.deletedAt ?? null,
      });
    });

    // Sort by deletedAt desc
    return list.sort((a, b) => {
      const timeA = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
      const timeB = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
      return timeB - timeA;
    });
  }, [trashData]);

  // Filtered by tab and search query
  const filteredItems = useMemo(() => {
    return allItems.filter((item) => {
      if (activeTab !== "all" && item.type !== activeTab) {
        return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        return item.title.toLowerCase().includes(query);
      }
      return true;
    });
  }, [allItems, activeTab, searchQuery]);

  // Counts
  const counts = useMemo(
    () => ({
      all: allItems.length,
      task: trashData.tasks.length,
      list: trashData.lists.length,
      folder: trashData.folders.length,
      section: trashData.sections.length,
    }),
    [allItems.length, trashData]
  );

  // Restore action
  const handleRestore = async (item: UnifiedTrashItem) => {
    setPendingItemId(item.id);
    try {
      // Phase 5 follow-up: offline-first restore for tasks via the shared
      // helper (mutate restore op), REST fallback when there is no userId
      // or Dexie throws. Other entity types stay on REST.
      if (item.type === "task" && userId) {
        await restoreFromTrash(userId, "tasks", item.id).catch(() =>
          restoreTrash(item.type, item.id)
        );
      } else {
        await restoreTrash(item.type, item.id);
      }
      // Remove restored item from local state
      setTrashData((prev) => {
        if (item.type === "task") {
          return { ...prev, tasks: prev.tasks.filter((t) => t.id !== item.id) };
        }
        if (item.type === "list") {
          return { ...prev, lists: prev.lists.filter((l) => l.id !== item.id) };
        }
        if (item.type === "folder") {
          return { ...prev, folders: prev.folders.filter((f) => f.id !== item.id) };
        }
        if (item.type === "section") {
          return { ...prev, sections: prev.sections.filter((s) => s.id !== item.id) };
        }
        return prev;
      });
      onItemRestored?.(item.type, item.id);
    } catch (err) {
      console.error("Failed to restore item:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to restore item");
    } finally {
      setPendingItemId(null);
    }
  };

  // Hard delete action
  const handleHardDelete = async (item: UnifiedTrashItem) => {
    if (
      !window.confirm(
        `Permanently delete "${item.title}"? This cannot be undone.`
      )
    ) {
      return;
    }

    setPendingItemId(item.id);
    try {
      await hardDeleteTrash(item.type, item.id);
      setTrashData((prev) => {
        if (item.type === "task") {
          return { ...prev, tasks: prev.tasks.filter((t) => t.id !== item.id) };
        }
        if (item.type === "list") {
          return { ...prev, lists: prev.lists.filter((l) => l.id !== item.id) };
        }
        if (item.type === "folder") {
          return { ...prev, folders: prev.folders.filter((f) => f.id !== item.id) };
        }
        if (item.type === "section") {
          return { ...prev, sections: prev.sections.filter((s) => s.id !== item.id) };
        }
        return prev;
      });
    } catch (err) {
      console.error("Failed to hard delete item:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to permanently delete item");
    } finally {
      setPendingItemId(null);
    }
  };

  // Empty trash action
  const handleEmptyTrash = async () => {
    if (allItems.length === 0) return;

    if (
      !window.confirm(
        `Empty Trash? All ${allItems.length} soft-deleted items will be permanently erased. This action cannot be reversed.`
      )
    ) {
      return;
    }

    setIsActionPending(true);
    setErrorMessage(null);
    try {
      await emptyTrash();
      setTrashData({ tasks: [], lists: [], folders: [], sections: [] });
    } catch (err) {
      console.error("Failed to empty trash:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to empty trash");
    } finally {
      setIsActionPending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trash"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-150"
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl border border-[#CAD5E8] dark:border-[#16367F] bg-white dark:bg-[#051A4D] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E4E8F2] dark:border-[#132E74] px-5 py-4 bg-white/95 dark:bg-[#051A4D]/95">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-400">
              <Trash2 className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#0B1220] dark:text-white">Trash</h2>
                <span className="rounded-full bg-[#F2F5FC] dark:bg-[#082363] px-2 py-0.5 text-xs font-mono font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
                  {allItems.length}
                </span>
              </div>
              <p className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                Soft-deleted items are safely recoverable here.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {allItems.length > 0 && (
              <button
                type="button"
                onClick={handleEmptyTrash}
                disabled={isActionPending || isLoading}
                className="btn-tier2 inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/60 transition-all cursor-pointer disabled:opacity-50"
              >
                {isActionPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                <span>Empty Trash</span>
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white transition-colors cursor-pointer"
              title="Close (Esc)"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Filter Tabs and Search Bar */}
        <div className="flex flex-col gap-2.5 border-b border-[#E4E8F2] dark:border-[#132E74] bg-[#F2F5FC]/60 dark:bg-[#082363]/40 px-5 py-3">
          {/* Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {(
              [
                { id: "all", label: "All", count: counts.all },
                { id: "task", label: "Tasks", count: counts.task },
                { id: "list", label: "Lists", count: counts.list },
                { id: "folder", label: "Folders", count: counts.folder },
                { id: "section", label: "Sections", count: counts.section },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer select-none",
                  activeTab === tab.id
                    ? "bg-[#09318D] text-white shadow-xs dark:bg-[#FD91CC] dark:text-[#051A4D]"
                    : "text-[#5B6478] hover:bg-white hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white"
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.2 text-[10px] font-mono",
                    activeTab === tab.id
                      ? "bg-white/20 text-white dark:bg-[#051A4D]/20 dark:text-[#051A4D]"
                      : "bg-[#E4E8F2] text-[#5B6478] dark:bg-[#132E74] dark:text-[#9BB0D3]"
                  )}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search deleted items..."
              className="w-full rounded-xl border border-[#CAD5E8] bg-white pl-9 pr-3 py-1.5 text-xs text-[#0B1220] placeholder:text-[#5B6478]/60 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#09318D] dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white dark:focus:border-[#FD91CC] dark:focus:ring-[#FD91CC]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-5 py-2 text-xs text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#5B6478] dark:text-[#9BB0D3]">
              <Loader2 className="h-6 w-6 animate-spin text-[#09318D] dark:text-[#FD91CC] mb-2" />
              <p className="text-xs">Loading deleted items...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-[#5B6478] dark:text-[#9BB0D3]">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#F2F5FC] dark:bg-[#082363] text-[#5B6478] dark:text-[#9BB0D3] mb-3">
                <Trash2 className="h-6 w-6" />
              </div>
              <h3 className="text-sm font-bold text-[#0B1220] dark:text-white mb-1">
                {searchQuery ? "No matching items found" : "Trash is empty"}
              </h3>
              <p className="text-xs max-w-xs">
                {searchQuery
                  ? `No deleted items match "${searchQuery}".`
                  : "Items deleted from your workspace will appear here."}
              </p>
            </div>
          ) : (
            filteredItems.map((item) => {
              const isItemPending = pendingItemId === item.id;

              const typeBadge = {
                task: {
                  label: "Task",
                  icon: CheckSquare,
                  class:
                    "bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900/40",
                },
                list: {
                  label: "List",
                  icon: List,
                  class:
                    "bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900/40",
                },
                folder: {
                  label: "Folder",
                  icon: Folder,
                  class:
                    "bg-amber-50 text-amber-700 border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-900/40",
                },
                section: {
                  label: "Section",
                  icon: Layers,
                  class:
                    "bg-purple-50 text-purple-700 border-purple-200/80 dark:bg-purple-950/40 dark:text-purple-400 dark:border-purple-900/40",
                },
              }[item.type];

              const TypeIcon = typeBadge.icon;

              return (
                <div
                  key={`${item.type}-${item.id}`}
                  className="group flex items-center justify-between gap-3 rounded-xl border border-[#E4E8F2] bg-white p-3 shadow-2xs hover:border-[#CAD5E8] dark:border-[#132E74] dark:bg-[#082363]/50 dark:hover:border-[#1E4396] transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Type Badge */}
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider shrink-0",
                        typeBadge.class
                      )}
                    >
                      <TypeIcon className="h-3 w-3" />
                      <span>{typeBadge.label}</span>
                    </span>

                    {/* Title & Timestamp */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs sm:text-sm font-semibold text-[#0B1220] dark:text-white">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-1 text-[11px] font-mono text-[#5B6478] dark:text-[#9BB0D3]">
                        <Clock className="h-3 w-3" />
                        <span>Deleted {formatRelativeTime(item.deletedAt)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Restore Button */}
                    <button
                      type="button"
                      onClick={() => handleRestore(item)}
                      disabled={isItemPending}
                      className="btn-tier2 inline-flex items-center gap-1 rounded-lg border border-[#CAD5E8] bg-white px-2.5 py-1.5 text-xs font-semibold text-[#09318D] hover:bg-[#F2F5FC] hover:border-[#09318D] dark:border-[#16367F] dark:bg-[#051A4D] dark:text-[#FD91CC] dark:hover:bg-[#082363] dark:hover:border-[#FD91CC] transition-all cursor-pointer disabled:opacity-50"
                      title="Restore item"
                    >
                      {isItemPending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      <span className="hidden sm:inline">Restore</span>
                    </button>

                    {/* Hard Delete Button */}
                    <button
                      type="button"
                      onClick={() => handleHardDelete(item)}
                      disabled={isItemPending}
                      className="btn-tier2 inline-flex items-center gap-1 rounded-lg border border-transparent p-1.5 text-xs font-semibold text-rose-600 hover:border-rose-200 hover:bg-rose-50 dark:text-rose-400 dark:hover:border-rose-900/60 dark:hover:bg-rose-950/40 transition-all cursor-pointer disabled:opacity-50"
                      title="Delete permanently"
                      aria-label={`Permanently delete ${item.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-[#E4E8F2] dark:border-[#132E74] bg-[#F2F5FC]/60 dark:bg-[#082363]/40 px-5 py-3">
          <p className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
            {filteredItems.length} {filteredItems.length === 1 ? "item" : "items"} displayed
          </p>

          <button
            type="button"
            onClick={onClose}
            className="btn-tier2 rounded-lg border border-[#CAD5E8] bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-[#F2F5FC] dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white dark:hover:bg-[#082363] transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
