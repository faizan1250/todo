"use client";

import * as React from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { Tag as TagIcon, Check, Plus, X, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TACTILE_COLOR_SWATCHES,
  type ColorSwatch,
} from "./types";
import {
  getTags,
  createTag,
  replaceTaskTags,
  type BackendTag,
} from "@/lib/api";

interface TagPickerPopoverProps {
  taskId: string;
  activeTags: string[]; // tag names
  activeTagIds?: string[]; // tag IDs
  onTagsUpdated: (updatedTagNames: string[], updatedTagIds: string[]) => void;
  disabled?: boolean;
}

export function TagPickerPopover({
  taskId,
  activeTags,
  activeTagIds = [],
  onTagsUpdated,
  disabled = false,
}: TagPickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [availableTags, setAvailableTags] = useState<BackendTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedColor, setSelectedColor] = useState<ColorSwatch>(TACTILE_COLOR_SWATCHES[0]);

  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open and load tags
  const handleOpen = () => {
    setIsOpen(true);
    setIsLoading(true);
    getTags()
      .then((tags) => {
        setAvailableTags(tags);
      })
      .catch((err) => {
        console.warn("Could not load remote tags, using active tags:", err);
      })
      .finally(() => {
        setIsLoading(false);
      });
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleClose = () => {
    setIsOpen(false);
    setSearchQuery("");
  };

  // Click outside and escape key to dismiss
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  // Merged tag pool (remote + active tags)
  const allTags = useMemo(() => {
    const map = new Map<string, { id?: string; name: string; color?: string | null }>();

    // Add pre-existing available tags
    for (const t of availableTags) {
      map.set(t.name.toLowerCase(), t);
    }

    // Add active tags if not present
    activeTags.forEach((name, idx) => {
      const lower = name.toLowerCase();
      if (!map.has(lower)) {
        map.set(lower, {
          id: activeTagIds[idx] || `tag-${name}`,
          name,
          color: TACTILE_COLOR_SWATCHES[idx % TACTILE_COLOR_SWATCHES.length].hex,
        });
      }
    });

    return Array.from(map.values());
  }, [availableTags, activeTags, activeTagIds]);

  const filteredTags = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allTags;
    return allTags.filter((t) => t.name.toLowerCase().includes(q));
  }, [allTags, searchQuery]);

  const exactMatchExists = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return allTags.some((t) => t.name.toLowerCase() === q);
  }, [allTags, searchQuery]);

  const handleToggleTag = async (tag: { id?: string; name: string }) => {
    const isCurrentlyActive = activeTags.some(
      (t) => t.toLowerCase() === tag.name.toLowerCase()
    );

    let nextNames: string[];
    let nextIds: string[];

    if (isCurrentlyActive) {
      nextNames = activeTags.filter(
        (t) => t.toLowerCase() !== tag.name.toLowerCase()
      );
      nextIds = activeTagIds.filter((id) => id !== tag.id);
    } else {
      nextNames = [...activeTags, tag.name];
      nextIds = tag.id ? [...activeTagIds, tag.id] : activeTagIds;
    }

    // Optimistic UI update
    onTagsUpdated(nextNames, nextIds);

    // Call API if task ID is real
    if (tag.id && !taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
      try {
        await replaceTaskTags(taskId, nextIds);
      } catch (err) {
        console.error("Failed to replace task tags on backend:", err);
      }
    }
  };

  const handleCreateNewTag = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed || isCreating) return;

    setIsCreating(true);

    try {
      let createdId = `tag-${Date.now()}`;

      // Call create tag API if reachable
      try {
        const created = await createTag({
          name: trimmed,
          color: selectedColor.hex,
        });
        createdId = created.id;
        setAvailableTags((prev) => [...prev, created]);
      } catch (err) {
        console.warn("Backend createTag failed, using local tag:", err);
      }

      const nextNames = [...activeTags, trimmed];
      const nextIds = [...activeTagIds, createdId];

      onTagsUpdated(nextNames, nextIds);

      if (!taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        try {
          await replaceTaskTags(taskId, nextIds);
        } catch (replaceErr) {
          console.error("Failed to assign created tag to task:", replaceErr);
        }
      }

      setSearchQuery("");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="relative inline-block" ref={popoverRef}>
      {/* Trigger Button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => (isOpen ? handleClose() : handleOpen())}
        aria-label="Add or manage tags"
        aria-expanded={isOpen}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border border-dashed border-[#CAD5E8] bg-white px-2 py-0.5 text-xs font-semibold text-[#09318D] hover:border-[#09318D] hover:bg-[#F2F5FC] transition-colors cursor-pointer focus-ring-pink dark:border-[#1F459E] dark:bg-[#082363] dark:text-[#FFA8D7] dark:hover:border-[#FD91CC]",
          isOpen && "border-solid border-[#09318D] bg-[#F2F5FC] dark:border-[#FD91CC]"
        )}
      >
        <Plus className="h-3 w-3" />
        <TagIcon className="h-3 w-3" />
        <span>Tag</span>
      </button>

      {/* Popover Card */}
      {isOpen && (
        <div
          role="dialog"
          aria-label="Tag selector"
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-xl border border-[#E4E8F2] bg-white p-2.5 shadow-lg dark:border-[#132E74] dark:bg-[#051A4D]"
        >
          {/* Search Input */}
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
            <input
              ref={inputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search or create tag..."
              className="w-full rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/50 pl-8 pr-7 py-1 text-xs text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear tag query"
                className="absolute right-2 text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          {/* Tags List */}
          <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
            {isLoading && (
              <div className="flex items-center justify-center py-3 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                <span>Loading tags...</span>
              </div>
            )}

            {!isLoading && filteredTags.length === 0 && exactMatchExists && (
              <div className="py-2 text-center text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                No matching tags.
              </div>
            )}

            {!isLoading &&
              filteredTags.map((t) => {
                const isActive = activeTags.some(
                  (at) => at.toLowerCase() === t.name.toLowerCase()
                );
                return (
                  <button
                    key={t.id || t.name}
                    type="button"
                    onClick={() => handleToggleTag(t)}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-1 text-xs font-medium transition-colors cursor-pointer",
                      isActive
                        ? "bg-[#09318D]/10 text-[#09318D] font-bold dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                        : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-[#E4E8F2] dark:hover:bg-[#082363]"
                    )}
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color || "#09318D" }}
                      />
                      <span className="truncate">{t.name}</span>
                    </div>
                    {isActive && <Check className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />}
                  </button>
                );
              })}
          </div>

          {/* Create New Tag Section */}
          {!exactMatchExists && searchQuery.trim() && (
            <div className="mt-2.5 border-t border-[#E4E8F2] pt-2.5 dark:border-[#132E74]">
              <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
                <span>Create &quot;{searchQuery.trim()}&quot;</span>
                <span className="text-[10px] text-[#5B6478]/70 dark:text-[#9BB0D3]/70">
                  {selectedColor.name}
                </span>
              </div>

              {/* 8-color tactile swatch picker */}
              <div className="grid grid-cols-8 gap-1.5 py-1">
                {TACTILE_COLOR_SWATCHES.map((swatch) => {
                  const isSelected = selectedColor.id === swatch.id;
                  return (
                    <button
                      key={swatch.id}
                      type="button"
                      onClick={() => setSelectedColor(swatch)}
                      title={swatch.name}
                      aria-label={`Select color ${swatch.name}`}
                      className={cn(
                        "h-5 w-5 rounded-full transition-transform cursor-pointer flex items-center justify-center",
                        swatch.bgClass,
                        isSelected ? "scale-110 ring-2 ring-offset-1 ring-[#09318D] dark:ring-[#FD91CC] dark:ring-offset-[#051A4D]" : "hover:scale-105"
                      )}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                    </button>
                  );
                })}
              </div>

              {/* Create Button */}
              <button
                type="button"
                disabled={isCreating}
                onClick={handleCreateNewTag}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-[#09318D] py-1 text-xs font-semibold text-white hover:bg-[#0D41B4] disabled:opacity-50 transition-colors cursor-pointer focus-ring-pink dark:bg-[#0D41B4] dark:hover:bg-[#134EC9]"
              >
                {isCreating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                <span>Create Tag</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
