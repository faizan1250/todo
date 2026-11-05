"use client";

import * as React from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import {
  Calendar,
  Clock,
  Inbox,
  CheckCircle2,
  Folder,
  Plus,
  SunMoon,
  PanelLeft,
  User,
  ArrowRight,
  Command,
  Keyboard,
  Bookmark,
  Trash2,
  Loader2,
  Tag,
  List as ListIcon,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ListId, FolderId } from "./types";
import { search } from "@/lib/api";
import type {
  BackendSearchResponse,
  BackendSearchTaskResult,
} from "@/lib/api";

export interface CommandAction {
  id: string;
  title: string;
  subtitle?: string;
  category: "Navigation" | "Folders" | "Actions";
  icon: React.ElementType;
  shortcut?: string;
  perform: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectList: (list: ListId) => void;
  onSelectFolder: (folder: FolderId | null) => void;
  onNewTask: () => void;
  onToggleTheme: () => void;
  onToggleSidebar: () => void;
  onOpenAuth?: () => void;
  onOpenShortcuts?: () => void;
  onOpenTrash?: () => void;
  onOpenTemplates?: () => void;
  onOpenTask?: (taskId: string) => void;
}

// Markers used by backend FTS snippet: char(1) / char(2)
const MARK_START = "\u0001";
const MARK_END = "\u0002";

function parseHighlight(input: string): Array<{ text: string; mark: boolean }> {
  const out: Array<{ text: string; mark: boolean }> = [];
  let buf = "";
  let inMark = false;
  for (const ch of input) {
    if (ch === MARK_START) {
      if (buf) out.push({ text: buf, mark: inMark });
      buf = "";
      inMark = true;
    } else if (ch === MARK_END) {
      if (buf) out.push({ text: buf, mark: inMark });
      buf = "";
      inMark = false;
    } else {
      buf += ch;
    }
  }
  if (buf) out.push({ text: buf, mark: inMark });
  return out;
}

function Highlighted({ text }: { text: string }) {
  const segments = parseHighlight(text || "");
  return (
    <>
      {segments.map((seg, i) =>
        seg.mark ? <mark key={i} className="bg-yellow-200/70 text-inherit dark:bg-yellow-500/30 rounded px-0.5">{seg.text}</mark> : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        )
      )}
    </>
  );
}

export function CommandPalette({
  isOpen,
  onClose,
  onSelectList,
  onSelectFolder,
  onNewTask,
  onToggleTheme,
  onToggleSidebar,
  onOpenAuth,
  onOpenShortcuts,
  onOpenTrash,
  onOpenTemplates,
  onOpenTask,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const [results, setResults] = useState<BackendSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Global Cmd+K / Ctrl+K keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const handleClose = () => {
    setQuery("");
    setSelectedIndex(0);
    setResults(null);
    setError(null);
    setLoading(false);
    onClose();
  };

  // Debounced search
  useEffect(() => {
    if (!isOpen) return;
    const q = query.trim();
    if (!q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      search({ q, types: "tasks,lists,tags,filters", limit: 20 })
        .then((res) => {
          setResults(res);
          setLoading(false);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Search failed");
          setLoading(false);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [query, isOpen]);

  const actions: CommandAction[] = useMemo(
    () => [
      {
        id: "nav-today",
        title: "Go to Today's Tasks",
        subtitle: "View immediate daily commitments",
        category: "Navigation",
        icon: Calendar,
        shortcut: "G T",
        perform: () => {
          onSelectList("today");
          onSelectFolder(null);
          onClose();
        },
      },
      {
        id: "nav-upcoming",
        title: "Go to Upcoming Sprints",
        subtitle: "View scheduled future milestones",
        category: "Navigation",
        icon: Clock,
        shortcut: "G U",
        perform: () => {
          onSelectList("upcoming");
          onSelectFolder(null);
          onClose();
        },
      },
      {
        id: "nav-backlog",
        title: "Go to Backlog",
        subtitle: "View unprioritized engineering pool",
        category: "Navigation",
        icon: Inbox,
        shortcut: "G B",
        perform: () => {
          onSelectList("backlog");
          onSelectFolder(null);
          onClose();
        },
      },
      {
        id: "nav-completed",
        title: "Go to Completed Archive",
        subtitle: "View finished sprint milestones",
        category: "Navigation",
        icon: CheckCircle2,
        shortcut: "G C",
        perform: () => {
          onSelectList("completed");
          onSelectFolder(null);
          onClose();
        },
      },
      {
        id: "nav-templates",
        title: "Go to Templates",
        subtitle: "Manage and instantiate reusable task templates",
        category: "Navigation",
        icon: Bookmark,
        shortcut: "G M",
        perform: () => {
          onClose();
          onOpenTemplates?.();
        },
      },
      {
        id: "nav-trash",
        title: "Go to Trash",
        subtitle: "View, restore, or permanently delete items",
        category: "Navigation",
        icon: Trash2,
        shortcut: "G X",
        perform: () => {
          onClose();
          onOpenTrash?.();
        },
      },
      {
        id: "folder-engineering",
        title: "Filter: Engineering Folder",
        subtitle: "Architecture, backend, frontend tasks",
        category: "Folders",
        icon: Folder,
        perform: () => {
          onSelectFolder("engineering");
          onClose();
        },
      },
      {
        id: "folder-design",
        title: "Filter: Design Folder",
        subtitle: "UI/UX tokens, mockups, design review",
        category: "Folders",
        icon: Folder,
        perform: () => {
          onSelectFolder("design");
          onClose();
        },
      },
      {
        id: "folder-personal",
        title: "Filter: Personal Folder",
        subtitle: "Solo learning and hobby experiments",
        category: "Folders",
        icon: Folder,
        perform: () => {
          onSelectFolder("personal");
          onClose();
        },
      },
      {
        id: "act-new-task",
        title: "Create New Task",
        subtitle: "Open quick task composer",
        category: "Actions",
        icon: Plus,
        shortcut: "N",
        perform: () => {
          onNewTask();
          onClose();
        },
      },
      {
        id: "act-toggle-theme",
        title: "Toggle Theme (Light / Dark)",
        subtitle: "Switch between day and deep blue dark mode",
        category: "Actions",
        icon: SunMoon,
        perform: () => {
          onToggleTheme();
          onClose();
        },
      },
      {
        id: "act-toggle-sidebar",
        title: "Toggle Sidebar Navigation",
        subtitle: "Collapse or expand left sidebar",
        category: "Actions",
        icon: PanelLeft,
        shortcut: "\u2318\\",
        perform: () => {
          onToggleSidebar();
          onClose();
        },
      },
      ...(onOpenShortcuts
        ? [
            {
              id: "act-keyboard-shortcuts",
              title: "View Keyboard Shortcuts",
              subtitle: "Open full cheat sheet of navigation and action shortcuts",
              category: "Actions" as const,
              icon: Keyboard,
              shortcut: "?",
              perform: () => {
                onClose();
                onOpenShortcuts();
              },
            },
          ]
        : []),
      ...(onOpenAuth
        ? [
            {
              id: "act-auth-profile",
              title: "Manage Auth Profile & Invites",
              subtitle: "View session keys and profile settings",
              category: "Actions" as const,
              icon: User,
              perform: () => {
                onOpenAuth();
                onClose();
              },
            },
          ]
        : []),
    ],
    [
      onSelectList,
      onSelectFolder,
      onNewTask,
      onToggleTheme,
      onToggleSidebar,
      onOpenShortcuts,
      onOpenAuth,
      onOpenTemplates,
      onOpenTrash,
      onClose,
    ]
  );

  const filteredActions = useMemo(() => {
    if (!query.trim()) return actions;
    const q = query.toLowerCase();
    return actions.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.subtitle && a.subtitle.toLowerCase().includes(q)) ||
        a.category.toLowerCase().includes(q)
    );
  }, [actions, query]);

  // Build navigable items for keyboard.
  const navItems = useMemo(() => {
    const items: Array<{ id: string; perform: () => void }> = [];
    if (query.trim() && results) {
      (results.tasks || []).forEach((t: BackendSearchTaskResult) => {
        items.push({
          id: `search-task-${t.id}`,
          perform: () => {
            onOpenTask?.(t.id);
            handleClose();
          },
        });
      });
      (results.lists || []).forEach((l) => {
        items.push({
          id: `search-list-${l.id}`,
          perform: () => {
            handleClose();
          },
        });
      });
      (results.tags || []).forEach((t) => {
        items.push({
          id: `search-tag-${t.id}`,
          perform: () => {
            handleClose();
          },
        });
      });
      (results.filters || []).forEach((f) => {
        items.push({
          id: `search-filter-${f.id}`,
          perform: () => {
            handleClose();
          },
        });
      });
    }
    filteredActions.forEach((a) => {
      items.push({ id: a.id, perform: a.perform });
    });
    return items;
  }, [query, results, filteredActions, onOpenTask]);

  // Keyboard navigation within list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        navItems.length ? (prev < navItems.length - 1 ? prev + 1 : 0) : 0
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        navItems.length ? (prev > 0 ? prev - 1 : navItems.length - 1) : 0
      );
    } else if (e.key === "Enter") {
      e.preventDefault();
      const current = navItems[selectedIndex];
      if (current) {
        current.perform();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleClose();
    }
  };

  if (!isOpen) return null;

  const hasQuery = !!query.trim();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-16 sm:pt-24 px-4 bg-black/50 backdrop-blur-xs select-none"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white shadow-2xl transition-all duration-200 dark:border-[#132E74] dark:bg-[#051A4D]"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search Input Bar */}
        <div className="relative flex items-center border-b border-[#E4E8F2] px-4 dark:border-[#132E74]">
          <Command className="h-4 w-4 text-[#09318D] dark:text-[#FD91CC]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command or search tasks..."
            className="w-full bg-transparent px-3 py-3.5 text-sm text-[#0B1220] placeholder:text-[#5B6478]/60 focus:outline-none dark:text-white dark:placeholder:text-[#9BB0D3]/60"
          />
          {loading && <Loader2 className="h-4 w-4 animate-spin text-[#09318D] dark:text-[#FD91CC]" />}
          <kbd className="ml-2 rounded border border-[#E4E8F2] bg-[#F2F5FC] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[#5B6478] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]">
            ESC
          </kbd>
        </div>

        {/* Results List */}
        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {hasQuery && loading && !results && (
            <div className="p-8 text-center text-xs text-[#5B6478] dark:text-[#9BB0D3]">Searching…</div>
          )}

          {hasQuery && error && (
            <div className="p-8 text-center text-xs text-red-500">{error}</div>
          )}

          {hasQuery && !loading && !error && results && (
            <>
              {/* Tasks */}
              {(results.tasks || []).length > 0 && (
                <div className="mb-2">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#5B6478] dark:text-[#9BB0D3]">Tasks</div>
                  {(results.tasks || []).map((t: BackendSearchTaskResult, idx: number) => {
                    const globalIdx = idx; // not exact but ok
                    const isSelected = navItems.findIndex((n) => n.id === `search-task-${t.id}`) === selectedIndex;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          onOpenTask?.(t.id);
                          handleClose();
                        }}
                        onMouseEnter={() => {
                          const i = navItems.findIndex((n) => n.id === `search-task-${t.id}`);
                          if (i >= 0) setSelectedIndex(i);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#09318D] text-white dark:bg-[#0D41B4] shadow-xs"
                            : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                        )}
                      >
                        <div className="min-w-0">
                          <div className="font-semibold truncate">
                            <Highlighted text={t.titleHl || t.title} />
                          </div>
                          {(t.notesHl || t.notes) && (
                            <div className={cn("text-[10px] truncate", isSelected ? "text-white/80" : "text-[#5B6478] dark:text-[#9BB0D3]")}>
                              <Highlighted text={t.notesHl || t.notes || ""} />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Lists */}
              {(results.lists || []).length > 0 && (
                <div className="mb-2">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#5B6478] dark:text-[#9BB0D3]">Lists</div>
                  {(results.lists || []).map((l) => {
                    const isSelected = navItems.findIndex((n) => n.id === `search-list-${l.id}`) === selectedIndex;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={handleClose}
                        onMouseEnter={() => {
                          const i = navItems.findIndex((n) => n.id === `search-list-${l.id}`);
                          if (i >= 0) setSelectedIndex(i);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#09318D] text-white dark:bg-[#0D41B4] shadow-xs"
                            : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                        )}
                      >
                        <ListIcon className="h-3.5 w-3.5" />
                        <span className="truncate">{l.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Tags */}
              {(results.tags || []).length > 0 && (
                <div className="mb-2">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#5B6478] dark:text-[#9BB0D3]">Tags</div>
                  {(results.tags || []).map((t) => {
                    const isSelected = navItems.findIndex((n) => n.id === `search-tag-${t.id}`) === selectedIndex;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={handleClose}
                        onMouseEnter={() => {
                          const i = navItems.findIndex((n) => n.id === `search-tag-${t.id}`);
                          if (i >= 0) setSelectedIndex(i);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#09318D] text-white dark:bg-[#0D41B4] shadow-xs"
                            : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                        )}
                      >
                        <Tag className="h-3.5 w-3.5" />
                        <span className="truncate">{t.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Saved Filters */}
              {(results.filters || []).length > 0 && (
                <div className="mb-2">
                  <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#5B6478] dark:text-[#9BB0D3]">Saved Filters</div>
                  {(results.filters || []).map((f) => {
                    const isSelected = navItems.findIndex((n) => n.id === `search-filter-${f.id}`) === selectedIndex;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={handleClose}
                        onMouseEnter={() => {
                          const i = navItems.findIndex((n) => n.id === `search-filter-${f.id}`);
                          if (i >= 0) setSelectedIndex(i);
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-[#09318D] text-white dark:bg-[#0D41B4] shadow-xs"
                            : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                        )}
                      >
                        <Filter className="h-3.5 w-3.5" />
                        <span className="truncate">{f.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              {(results.tasks || []).length === 0 &&
                (results.lists || []).length === 0 &&
                (results.tags || []).length === 0 &&
                (results.filters || []).length === 0 && (
                  <div className="p-8 text-center text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                    No results for &ldquo;{query}&rdquo;
                  </div>
                )}
            </>
          )}

          {/* Actions (always when query) */}
          {filteredActions.length > 0 && (
            <div className="mb-2">
              {hasQuery && (
                <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[#5B6478] dark:text-[#9BB0D3]">Actions</div>
              )}
              {filteredActions.map((action, idx) => {
                const navIdx = navItems.findIndex((n) => n.id === action.id);
                const isSelected = navIdx >= 0 && navIdx === selectedIndex;
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={action.perform}
                    onMouseEnter={() => {
                      if (navIdx >= 0) setSelectedIndex(navIdx);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors cursor-pointer",
                      isSelected
                        ? "bg-[#09318D] text-white dark:bg-[#0D41B4] shadow-xs"
                        : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-white dark:hover:bg-[#082363]"
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "flex h-7 w-7 items-center justify-center rounded-lg border",
                          isSelected
                            ? "border-white/30 bg-white/10 text-white"
                            : "border-[#E4E8F2] bg-[#F2F5FC] text-[#09318D] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#FD91CC]"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{action.title}</div>
                        {action.subtitle && (
                          <div
                            className={cn(
                              "text-[10px] truncate",
                              isSelected ? "text-white/80" : "text-[#5B6478] dark:text-[#9BB0D3]"
                            )}
                          >
                            {action.subtitle}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {action.shortcut && (
                        <kbd
                          className={cn(
                            "rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold",
                            isSelected
                              ? "border-white/30 bg-white/20 text-white"
                              : "border-[#E4E8F2] bg-[#F2F5FC] text-[#5B6478] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]"
                          )}
                        >
                          {action.shortcut}
                        </kbd>
                      )}
                      {isSelected && <ArrowRight className="h-3.5 w-3.5 text-white" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!hasQuery && filteredActions.length === 0 && (
            <div className="p-8 text-center text-xs text-[#5B6478] dark:text-[#9BB0D3]">
              No commands matching &ldquo;{query}&rdquo;
            </div>
          )}
        </div>

        {/* Command Palette Footer */}
        <div className="flex items-center justify-between border-t border-[#E4E8F2] bg-[#F2F5FC]/60 px-4 py-2 text-[11px] text-[#5B6478] dark:border-[#132E74] dark:bg-[#082363]/40 dark:text-[#9BB0D3]">
          <div className="flex items-center gap-2">
            <span>Navigate: <kbd className="font-mono">↑</kbd> <kbd className="font-mono">↓</kbd></span>
            <span>•</span>
            <span>Select: <kbd className="font-mono">↵</kbd></span>
          </div>
          <span className="font-mono text-[10px]">Todo Studio Command v0.1</span>
        </div>
      </div>
    </div>
  );
}