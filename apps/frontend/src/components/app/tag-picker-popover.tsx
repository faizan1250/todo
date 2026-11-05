"use client";

import * as React from "react";
import { useState, useEffect, useRef, useMemo } from "react";
import { Tag as TagIcon, Check, Plus, X, Search, Loader2, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TACTILE_COLOR_SWATCHES,
  type ColorSwatch,
} from "./types";
import {
  getTags,
  createTag,
  updateTag,
  deleteTag,
  replaceTaskTags,
  type BackendTag,
} from "@/lib/api";
import { mutate } from "@/lib/data/mutate";
import { v7 as uuidv7 } from "uuid";
import { useToast } from "./toast-system";

interface TagPickerPopoverProps {
  taskId: string;
  activeTags: string[]; // tag names
  activeTagIds?: string[]; // tag IDs
  onTagsUpdated: (updatedTagNames: string[], updatedTagIds: string[]) => void;
  disabled?: boolean;
  triggerClassName?: string;
  label?: string;
  userId?: string | null;
}

export function TagPickerPopover({
  taskId,
  activeTags,
  activeTagIds = [],
  onTagsUpdated,
  disabled = false,
  triggerClassName,
  label,
  userId = null,
}: TagPickerPopoverProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [availableTags, setAvailableTags] = useState<BackendTag[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [selectedColor, setSelectedColor] = useState<ColorSwatch>(TACTILE_COLOR_SWATCHES[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const { toast, success } = useToast();

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

  // Name to surface in the duplicate-name guard (only while typing).
  const duplicateNameHint = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return null;
    const hit = allTags.find((t) => t.name.toLowerCase() === q.toLowerCase());
    return hit ? hit.name : null;
  }, [allTags, searchQuery]);

  // Persist a whole-set tag-id replacement: offline-first setTags sync op,
  // REST remains the fallback when there is no userId or Dexie throws.
  const persistTagIds = async (nextIds: string[]) => {
    if (taskId.startsWith("temp-") || taskId.startsWith("task-")) return;
    if (userId) {
      try {
        await mutate(userId, {
          entity: "tasks",
          op: "setTags",
          entityId: taskId,
          patch: { tagIds: nextIds },
        });
      } catch {
        try {
          await replaceTaskTags(taskId, nextIds);
        } catch (err) {
          console.error("Failed to replace task tags on backend:", err);
        }
      }
    } else {
      try {
        await replaceTaskTags(taskId, nextIds);
      } catch (err) {
        console.error("Failed to replace task tags on backend:", err);
      }
    }
  };

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

    if (tag.id) {
      await persistTagIds(nextIds);
    }
  };

  const handleRenameTag = async (tag: { id?: string; name: string }) => {
    const trimmed = editingName.trim();
    const oldName = tag.name;
    setEditingId(null);
    setEditingName("");
    if (!trimmed || trimmed.toLowerCase() === oldName.toLowerCase()) return;
    if (!tag.id || tag.id.startsWith("tag-")) return;
    if (
      allTags.some(
        (t) => t.id !== tag.id && t.name.toLowerCase() === trimmed.toLowerCase()
      )
    ) {
      toast({
        title: "Tag exists",
        message: `You already have a tag called "${trimmed}"`,
        type: "error",
      });
      return;
    }

    // Optimistic rename everywhere it surfaces
    setAvailableTags((prev) =>
      prev.map((t) => (t.id === tag.id ? { ...t, name: trimmed } : t))
    );
    if (activeTags.some((t) => t.toLowerCase() === oldName.toLowerCase())) {
      onTagsUpdated(
        activeTags.map((t) =>
          t.toLowerCase() === oldName.toLowerCase() ? trimmed : t
        ),
        [...activeTagIds]
      );
    }

    const doRestRename = async () => {
      try {
        await updateTag(tag.id as string, { name: trimmed });
      } catch (err) {
        console.error("Failed to rename tag on backend:", err);
      }
    };
    if (userId) {
      try {
        await mutate(userId, {
          entity: "tags",
          op: "update",
          entityId: tag.id,
          patch: { name: trimmed },
        });
      } catch {
        await doRestRename();
      }
    } else {
      await doRestRename();
    }
    success(`Renamed tag to "${trimmed}"`);
  };

  const handleUndoDeleteTag = async (snap: { name: string; color: string }) => {
    const name = snap.name;
    if (
      availableTags.some((t) => t.name.toLowerCase() === name.toLowerCase())
    ) {
      return;
    }
    let newId: string;
    try {
      if (userId) {
        newId = uuidv7();
        await mutate(userId, {
          entity: "tags",
          op: "create",
          entityId: newId,
          patch: { name, color: snap.color },
        });
      } else {
        const created = await createTag({ name, color: snap.color });
        newId = created.id;
      }
    } catch {
      try {
        const created = await createTag({ name, color: snap.color });
        newId = created.id;
      } catch (err) {
        console.error("Failed to restore tag on backend:", err);
        return;
      }
    }
    const restored: BackendTag = {
      id: newId,
      userId: userId ?? "",
      name,
      color: snap.color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
    };
    setAvailableTags((prev) => [...prev, restored]);
    onTagsUpdated([...activeTags, name], [...activeTagIds, newId]);
    await persistTagIds([...activeTagIds, newId]);
  };

  const handleDeleteTag = async (tag: { id?: string; name: string; color?: string | null }) => {
    setEditingId(null);
    // Synthetic local-only tags were never persisted: just detach.
    if (!tag.id || tag.id.startsWith("tag-")) {
      const nextNames = activeTags.filter(
        (t) => t.toLowerCase() !== tag.name.toLowerCase()
      );
      const nextIds = activeTagIds.filter((id) => id !== tag.id);
      onTagsUpdated(nextNames, nextIds);
      await persistTagIds(nextIds);
      return;
    }
    const tagId = tag.id;
    const snap = { name: tag.name, color: tag.color || TACTILE_COLOR_SWATCHES[0].hex };
    const wasAttached = activeTags.some(
      (t) => t.toLowerCase() === tag.name.toLowerCase()
    );
    const nextNames = activeTags.filter(
      (t) => t.toLowerCase() !== tag.name.toLowerCase()
    );
    const nextIds = activeTagIds.filter((id) => id !== tagId);

    // Optimistic removal from the pool and the task
    setAvailableTags((prev) => prev.filter((t) => t.id !== tagId));
    if (wasAttached) {
      onTagsUpdated(nextNames, nextIds);
      await persistTagIds(nextIds);
    }

    const doRestDelete = async () => {
      try {
        await deleteTag(tagId);
      } catch (err) {
        console.error("Failed to delete tag on backend:", err);
      }
    };
    if (userId) {
      try {
        await mutate(userId, { entity: "tags", op: "delete", entityId: tagId });
      } catch {
        await doRestDelete();
      }
    } else {
      await doRestDelete();
    }
    toast({
      title: "Tag deleted",
      message: `"${snap.name}" was removed${wasAttached ? " from this task" : ""}.`,
      actionLabel: "Undo",
      onAction: () => {
        void handleUndoDeleteTag(snap);
      },
    });
  };

  const handleCreateNewTag = async () => {
    const trimmed = searchQuery.trim();
    if (!trimmed || isCreating) return;
    if (allTags.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      toast({
        title: "Tag exists",
        message: `You already have a tag called "${trimmed}"`,
        type: "error",
      });
      return;
    }

    setIsCreating(true);

    try {
      const doRestCreate = async (): Promise<string> => {
        try {
          const created = await createTag({
            name: trimmed,
            color: selectedColor.hex,
          });
          setAvailableTags((prev) => [...prev, created]);
          return created.id;
        } catch (err) {
          console.warn("Backend createTag failed, using local tag:", err);
          return `tag-${Date.now()}`;
        }
      };

      // Offline-first tag create; the client-generated id is the sync
      // entityId, so it can be attached immediately. Falls back to REST.
      let createdId: string;
      if (userId) {
        createdId = uuidv7();
        try {
          await mutate(userId, {
            entity: "tags",
            op: "create",
            entityId: createdId,
            patch: { name: trimmed, color: selectedColor.hex },
          });
          setAvailableTags((prev) =>
            prev.some((t) => t.id === createdId)
              ? prev
              : [
                  ...prev,
                  {
                    id: createdId,
                    userId,
                    name: trimmed,
                    color: selectedColor.hex,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    version: 1,
                  },
                ]
          );
        } catch {
          createdId = await doRestCreate();
        }
      } else {
        createdId = await doRestCreate();
      }

      const nextNames = [...activeTags, trimmed];
      const nextIds = [...activeTagIds, createdId];

      onTagsUpdated(nextNames, nextIds);

      // Attach the created tag via setTags (whole-set replace with the full
      // new id array). REST remains the fallback when there is no userId or
      // Dexie throws.
      if (!taskId.startsWith("temp-") && !taskId.startsWith("task-")) {
        if (userId) {
          try {
            await mutate(userId, {
              entity: "tasks",
              op: "setTags",
              entityId: taskId,
              patch: { tagIds: nextIds },
            });
          } catch {
            try {
              await replaceTaskTags(taskId, nextIds);
            } catch (replaceErr) {
              console.error("Failed to assign created tag to task:", replaceErr);
            }
          }
        } else {
          try {
            await replaceTaskTags(taskId, nextIds);
          } catch (replaceErr) {
            console.error("Failed to assign created tag to task:", replaceErr);
          }
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
          triggerClassName ||
            "inline-flex items-center gap-1 rounded-md border border-dashed border-[#CAD5E8] bg-white px-2 py-0.5 text-xs font-semibold text-[#09318D] hover:border-[#09318D] hover:bg-[#F2F5FC] transition-colors cursor-pointer focus-ring-pink dark:border-[#1F459E] dark:bg-[#082363] dark:text-[#FFA8D7] dark:hover:border-[#FD91CC]",
          isOpen && !triggerClassName && "border-solid border-[#09318D] bg-[#F2F5FC] dark:border-[#FD91CC]"
        )}
      >
        <TagIcon className="h-3.5 w-3.5" />
        <span>{label || "Tag"}</span>
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

          {/* Duplicate-name guard: typing an existing name explains why no create row appears */}
          {!isLoading && duplicateNameHint && (
            <div className="px-2 pt-1 text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
              You already have a tag called &quot;{duplicateNameHint}&quot;
            </div>
          )}

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
                const rowKey = t.id || t.name;
                const isEditing = editingId === rowKey;
                return (
                  <div
                    key={rowKey}
                    className={cn(
                      "group flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-xs font-medium transition-colors",
                      isActive
                        ? "bg-[#09318D]/10 text-[#09318D] font-bold dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                        : "text-[#0B1220] hover:bg-[#F2F5FC] dark:text-[#E4E8F2] dark:hover:bg-[#082363]"
                    )}
                  >
                    {isEditing ? (
                      <input
                        autoFocus
                        type="text"
                        value={editingName}
                        maxLength={100}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleRenameTag(t);
                          if (e.key === "Escape") {
                            setEditingId(null);
                            setEditingName("");
                          }
                        }}
                        onBlur={() => void handleRenameTag(t)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`Rename tag ${t.name}`}
                        className="min-w-0 flex-1 rounded border border-[#09318D] bg-white px-1.5 py-0.5 text-xs text-[#0B1220] focus:outline-none dark:border-[#FD91CC] dark:bg-[#082363] dark:text-white"
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleToggleTag(t)}
                        title={isActive ? `Remove tag ${t.name}` : `Add tag ${t.name}`}
                        className="flex min-w-0 flex-1 items-center justify-between gap-1 rounded px-1 py-0.5 text-left cursor-pointer"
                      >
                        <div className="flex min-w-0 items-center gap-1.5 truncate">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: t.color || "#09318D" }}
                          />
                          <span className="truncate">{t.name}</span>
                        </div>
                        {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-[#09318D] dark:text-[#FD91CC]" />}
                      </button>
                    )}
                    {!isEditing && (
                      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {t.id && !t.id.startsWith("tag-") && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingId(rowKey);
                              setEditingName(t.name);
                            }}
                            title={`Rename tag ${t.name}`}
                            aria-label={`Rename tag ${t.name}`}
                            className="rounded p-1 text-[#5B6478] hover:bg-[#E4E8F2] hover:text-[#09318D] dark:text-[#9BB0D3] dark:hover:bg-[#082363] cursor-pointer"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleDeleteTag(t)}
                          title={`Delete tag ${t.name}`}
                          aria-label={`Delete tag ${t.name}`}
                          className="rounded p-1 text-[#5B6478] hover:bg-rose-50 hover:text-rose-600 dark:text-[#9BB0D3] dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
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
