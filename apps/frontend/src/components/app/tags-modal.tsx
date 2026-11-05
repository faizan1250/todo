"use client";

import * as React from "react";
import { useState, useEffect, useMemo } from "react";
import {
  Tag as TagIcon,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  Loader2,
  PaintBucket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TACTILE_COLOR_SWATCHES } from "./types";
import {
  updateTag,
  deleteTag,
  createTag,
  type BackendTag,
} from "@/lib/api";
import { mutate } from "@/lib/data/mutate";
import { v7 as uuidv7 } from "uuid";
import { useToast } from "./toast-system";

export interface TagsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tags: BackendTag[];
  tagCounts?: Record<string, number>;
  userId?: string | null;
  activeTagId?: string | null;
  onSelectTag?: (tag: BackendTag) => void;
  onTagsChanged?: () => void;
}

export function TagsModal({
  isOpen,
  onClose,
  tags,
  tagCounts = {},
  userId = null,
  activeTagId = null,
  onSelectTag,
  onTagsChanged,
}: TagsModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [colorPickerId, setColorPickerId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { toast, success } = useToast();

  const resetTransientState = () => {
    setSearchQuery("");
    setEditingId(null);
    setEditingName("");
    setColorPickerId(null);
    setPendingId(null);
  };

  const handleClose = React.useCallback(() => {
    resetTransientState();
    onClose();
  }, [onClose]);

  // Escape key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, handleClose]);

  const filteredTags = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const sorted = [...tags].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    );
    if (!q) return sorted;
    return sorted.filter((t) => t.name.toLowerCase().includes(q));
  }, [tags, searchQuery]);

  const handleRename = async (tag: BackendTag) => {
    const trimmed = editingName.trim();
    setEditingId(null);
    setEditingName("");
    if (!trimmed || trimmed.toLowerCase() === tag.name.toLowerCase()) return;
    if (tags.some((t) => t.id !== tag.id && t.name.toLowerCase() === trimmed.toLowerCase())) {
      toast({
        title: "Tag exists",
        message: `You already have a tag called "${trimmed}"`,
        type: "error",
      });
      return;
    }
    setPendingId(tag.id);
    const doRestRename = async () => {
      try {
        await updateTag(tag.id, { name: trimmed });
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
    setPendingId(null);
    success(`Renamed tag to "${trimmed}"`);
    onTagsChanged?.();
  };

  const handleRecolor = async (tag: BackendTag, color: string) => {
    if ((tag.color || "") === color) {
      setColorPickerId(null);
      return;
    }
    setColorPickerId(null);
    setPendingId(tag.id);
    const doRestRecolor = async () => {
      try {
        await updateTag(tag.id, { color });
      } catch (err) {
        console.error("Failed to recolor tag on backend:", err);
      }
    };
    if (userId) {
      try {
        await mutate(userId, {
          entity: "tags",
          op: "update",
          entityId: tag.id,
          patch: { color },
        });
      } catch {
        await doRestRecolor();
      }
    } else {
      await doRestRecolor();
    }
    setPendingId(null);
    success(`Updated color for "${tag.name}"`);
    onTagsChanged?.();
  };

  const handleUndoDelete = async (snap: { name: string; color: string }) => {
    if (tags.some((t) => t.name.toLowerCase() === snap.name.toLowerCase())) return;
    try {
      if (userId) {
        const newId = uuidv7();
        try {
          await mutate(userId, {
            entity: "tags",
            op: "create",
            entityId: newId,
            patch: { name: snap.name, color: snap.color },
          });
        } catch {
          await createTag({ name: snap.name, color: snap.color });
        }
      } else {
        await createTag({ name: snap.name, color: snap.color });
      }
      success(`Restored tag "${snap.name}"`);
    } catch (err) {
      console.error("Failed to restore tag on backend:", err);
      return;
    }
    onTagsChanged?.();
  };

  const handleDelete = async (tag: BackendTag) => {
    setEditingId(null);
    setColorPickerId(null);
    setPendingId(tag.id);
    const snap = { name: tag.name, color: tag.color || TACTILE_COLOR_SWATCHES[0].hex };
    const doRestDelete = async () => {
      try {
        await deleteTag(tag.id);
      } catch (err) {
        console.error("Failed to delete tag on backend:", err);
      }
    };
    if (userId) {
      try {
        await mutate(userId, { entity: "tags", op: "delete", entityId: tag.id });
      } catch {
        await doRestDelete();
      }
    } else {
      await doRestDelete();
    }
    setPendingId(null);
    toast({
      title: "Tag deleted",
      message: `"${snap.name}" was removed.`,
      actionLabel: "Undo",
      onAction: () => {
        void handleUndoDelete(snap);
      },
    });
    onTagsChanged?.();
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage Tags"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-150"
    >
      <div className="relative w-full max-w-lg max-h-[84vh] flex flex-col rounded-2xl border border-[#CAD5E8] dark:border-[#16367F] bg-white dark:bg-[#051A4D] shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-[#E4E8F2] dark:border-[#132E74] px-5 py-4 bg-white/95 dark:bg-[#051A4D]/95">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#09318D]/10 text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]">
              <TagIcon className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-[#0B1220] dark:text-white">
                  Tags
                </h2>
                <span className="rounded-full bg-[#F2F5FC] dark:bg-[#082363] px-2 py-0.5 text-xs font-mono font-semibold text-[#5B6478] dark:text-[#9BB0D3]">
                  {tags.length}
                </span>
              </div>
              <p className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                Rename, recolor, or delete tags. Select one to view its tasks.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white transition-colors cursor-pointer"
            title="Close (Esc)"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[#E4E8F2] dark:border-[#132E74] p-3 bg-[#F2F5FC]/50 dark:bg-[#082363]/30">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter tags..."
              aria-label="Filter tags"
              className="w-full rounded-lg border border-[#CAD5E8] bg-white pl-8 pr-2.5 py-1.5 text-xs text-[#0B1220] placeholder:text-[#5B6478]/60 focus:border-[#09318D] focus:outline-none focus:ring-1 focus:ring-[#09318D] dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white dark:focus:border-[#FD91CC] dark:focus:ring-[#FD91CC]"
            />
          </div>
        </div>

        {/* Tags List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {filteredTags.length === 0 && (
            <div className="py-8 text-center text-xs text-[#5B6478] dark:text-[#9BB0D3]">
              {searchQuery ? "No tags match search" : "No tags yet — create one from any task."}
            </div>
          )}
          {filteredTags.map((tag) => {
            const isActive = activeTagId === tag.id;
            const isEditing = editingId === tag.id;
            const isPending = pendingId === tag.id;
            const count = tagCounts[tag.id];
            return (
              <div
                key={tag.id}
                className={cn(
                  "rounded-xl border transition-all",
                  isActive
                    ? "border-[#09318D] bg-[#09318D]/5 dark:border-[#FD91CC] dark:bg-[#FD91CC]/10"
                    : "border-transparent hover:border-[#CAD5E8] hover:bg-[#F2F5FC]/60 dark:hover:border-[#132E74] dark:hover:bg-[#082363]/40"
                )}
              >
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color || "#09318D" }}
                  />
                  {isEditing ? (
                    <input
                      autoFocus
                      type="text"
                      value={editingName}
                      maxLength={100}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleRename(tag);
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setEditingName("");
                        }
                      }}
                      onBlur={() => void handleRename(tag)}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Rename tag ${tag.name}`}
                      className="min-w-0 flex-1 rounded border border-[#09318D] bg-white px-1.5 py-0.5 text-xs font-semibold text-[#0B1220] focus:outline-none dark:border-[#FD91CC] dark:bg-[#082363] dark:text-white"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        onSelectTag?.(tag);
                        handleClose();
                      }}
                      title={`View tasks tagged ${tag.name}`}
                      className="flex min-w-0 flex-1 items-center gap-2 rounded text-left cursor-pointer"
                    >
                      <span className="truncate text-xs font-semibold text-[#0B1220] dark:text-white">
                        {tag.name}
                      </span>
                      {typeof count === "number" && (
                        <span className="rounded-full bg-[#F2F5FC] px-1.5 py-0.5 text-[10px] font-mono font-semibold text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]">
                          {count}
                        </span>
                      )}
                    </button>
                  )}
                  {isPending ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#5B6478] dark:text-[#9BB0D3]" />
                  ) : (
                    !isEditing && (
                      <div className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() =>
                            setColorPickerId((prev) => (prev === tag.id ? null : tag.id))
                          }
                          title={`Change color of ${tag.name}`}
                          aria-label={`Change color of ${tag.name}`}
                          className="rounded p-1.5 text-[#5B6478] hover:bg-[#E4E8F2] hover:text-[#09318D] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-[#FFA8D7] cursor-pointer"
                        >
                          <PaintBucket className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(tag.id);
                            setEditingName(tag.name);
                          }}
                          title={`Rename tag ${tag.name}`}
                          aria-label={`Rename tag ${tag.name}`}
                          className="rounded p-1.5 text-[#5B6478] hover:bg-[#E4E8F2] hover:text-[#09318D] dark:text-[#9BB0D3] dark:hover:bg-[#082363] cursor-pointer"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDelete(tag)}
                          title={`Delete tag ${tag.name}`}
                          aria-label={`Delete tag ${tag.name}`}
                          className="rounded p-1.5 text-[#5B6478] hover:bg-rose-50 hover:text-rose-600 dark:text-[#9BB0D3] dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  )}
                </div>

                {/* Inline color picker */}
                {colorPickerId === tag.id && (
                  <div className="flex items-center gap-1.5 px-3 pb-2.5">
                    {TACTILE_COLOR_SWATCHES.map((swatch) => {
                      const isSelected = (tag.color || "") === swatch.hex;
                      return (
                        <button
                          key={swatch.id}
                          type="button"
                          onClick={() => void handleRecolor(tag, swatch.hex)}
                          title={swatch.name}
                          aria-label={`Set color ${swatch.name}`}
                          className={cn(
                            "h-5 w-5 rounded-full transition-transform cursor-pointer flex items-center justify-center",
                            swatch.bgClass,
                            isSelected
                              ? "scale-110 ring-2 ring-offset-1 ring-[#09318D] dark:ring-[#FD91CC] dark:ring-offset-[#051A4D]"
                              : "hover:scale-105"
                          )}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5 text-white stroke-[3]" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end border-t border-[#E4E8F2] dark:border-[#132E74] bg-[#F2F5FC]/60 dark:bg-[#082363]/40 px-5 py-3">
          <button
            type="button"
            onClick={handleClose}
            className="btn-tier2 rounded-lg border border-[#CAD5E8] bg-white px-3 py-1.5 text-xs font-semibold text-[#0B1220] hover:bg-[#F2F5FC] dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white dark:hover:bg-[#082363] transition-all cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
