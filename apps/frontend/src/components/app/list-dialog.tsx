"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import {
  X,
  List as ListIcon,
  CheckSquare,
  Briefcase,
  Code,
  Sparkles,
  BookOpen,
  Heart,
  Flag,
  Star,
  Zap,
  Folder as FolderIcon,
  Check,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  createList,
  updateList,
  type BackendList,
  type BackendFolder,
} from "@/lib/api";
import { TACTILE_COLOR_SWATCHES, LIST_ICON_PRESETS } from "./types";

export interface ListDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  listToEdit?: BackendList | null;
  defaultFolderId?: string | null;
  folders: BackendFolder[];
  onSuccess: (list: BackendList) => void;
}

const ICON_COMPONENTS: Record<string, React.ElementType> = {
  list: ListIcon,
  "check-square": CheckSquare,
  briefcase: Briefcase,
  code: Code,
  sparkles: Sparkles,
  "book-open": BookOpen,
  heart: Heart,
  flag: Flag,
  star: Star,
  zap: Zap,
};

function ListDialogModalInner({
  onClose,
  mode,
  listToEdit,
  defaultFolderId = null,
  folders,
  onSuccess,
}: Omit<ListDialogProps, "isOpen">) {
  const [name, setName] = useState(mode === "edit" && listToEdit ? listToEdit.name : "");
  const [folderId, setFolderId] = useState<string | null>(
    mode === "edit" && listToEdit ? (listToEdit.folderId ?? null) : defaultFolderId
  );
  const [color, setColor] = useState<string>(
    mode === "edit" && listToEdit && listToEdit.color
      ? listToEdit.color
      : TACTILE_COLOR_SWATCHES[0].hex
  );
  const [icon, setIcon] = useState<string>(
    mode === "edit" && listToEdit && listToEdit.icon ? listToEdit.icon : "list"
  );
  const viewType = (mode === "edit" && listToEdit?.viewType) || "list";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setErrorMessage("List name cannot be empty");
      inputRef.current?.focus();
      return;
    }

    if (trimmed.length > 100) {
      setErrorMessage("List name must be 100 characters or fewer");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      if (mode === "edit" && listToEdit) {
        const updated = await updateList(listToEdit.id, {
          name: trimmed,
          folderId: folderId || null,
          color,
          icon,
          viewType,
        });
        onSuccess(updated);
      } else {
        const created = await createList({
          name: trimmed,
          folderId: folderId || undefined,
          color,
          icon,
          viewType,
        });
        onSuccess(created);
      }
      onClose();
    } catch (err) {
      console.error("Failed to save list:", err);
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to save list"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const SelectedIconComponent = ICON_COMPONENTS[icon] || ListIcon;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#051A4D]/60 backdrop-blur-xs transition-opacity duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="list-dialog-title"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white text-[#0B1220] shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC] animate-in fade-in-50 zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="relative border-b border-[#E4E8F2]/80 bg-white/60 px-6 py-4.5 dark:border-[#132E74]/80 dark:bg-[#082363]/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-xl shadow-xs transition-colors"
              style={{ backgroundColor: color }}
            >
              <SelectedIconComponent className="h-4.5 w-4.5 text-white" />
            </div>
            <div>
              <h2
                id="list-dialog-title"
                className="text-base sm:text-lg font-bold tracking-tight text-[#0B1220] dark:text-white"
              >
                {mode === "edit" ? "Edit List" : "Create New List"}
              </h2>
              <p className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                {mode === "edit"
                  ? "Update list settings, color, and destination folder"
                  : "Organize tasks into focused, tactile lists"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {errorMessage && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
            >
              {errorMessage}
            </div>
          )}

          {/* List Name */}
          <div className="space-y-1.5">
            <label
              htmlFor="list-name"
              className="block text-xs font-semibold text-[#0B1220] dark:text-white"
            >
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="list-name"
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Sprint Milestones, Product Roadmap..."
              maxLength={100}
              disabled={isSubmitting}
              className="w-full rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/50 px-3 py-2 text-sm text-[#0B1220] placeholder:text-[#5B6478]/60 focus:border-[#09318D] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white dark:placeholder:text-[#9BB0D3]/60 dark:focus:bg-[#051A4D]"
            />
            <div className="flex justify-end text-[10px] font-mono text-[#5B6478] dark:text-[#9BB0D3]">
              {name.length}/100
            </div>
          </div>

          {/* Destination Folder Selection */}
          <div className="space-y-1.5">
            <label
              htmlFor="list-folder"
              className="block text-xs font-semibold text-[#0B1220] dark:text-white"
            >
              Folder
            </label>
            <div className="relative">
              <FolderIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
              <select
                id="list-folder"
                value={folderId || ""}
                onChange={(e) => setFolderId(e.target.value ? e.target.value : null)}
                disabled={isSubmitting}
                className="w-full appearance-none rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/50 py-2 pl-9 pr-8 text-xs font-medium text-[#0B1220] focus:border-[#09318D] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#051A4D] dark:text-white"
              >
                <option value="">None (Root List)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Color Swatch Picker (8 tactile colors) */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#0B1220] dark:text-white">
              Color Accent
            </label>
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              {TACTILE_COLOR_SWATCHES.map((swatch) => {
                const isSelected = color === swatch.hex;
                return (
                  <button
                    key={swatch.id}
                    type="button"
                    onClick={() => setColor(swatch.hex)}
                    title={swatch.name}
                    aria-label={`Select ${swatch.name} color`}
                    disabled={isSubmitting}
                    className={cn(
                      "group relative flex h-9 w-full items-center justify-center rounded-lg border transition-all cursor-pointer focus-ring-pink",
                      isSelected
                        ? "border-[#0B1220] ring-2 ring-[#FD91CC] scale-105 shadow-sm dark:border-white"
                        : "border-black/10 hover:scale-102 hover:shadow-xs opacity-85 hover:opacity-100"
                    )}
                    style={{ backgroundColor: swatch.hex }}
                  >
                    {isSelected && (
                      <Check className="h-4 w-4 text-white drop-shadow-md stroke-[3]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Icon Picker Presets */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#0B1220] dark:text-white">
              Icon
            </label>
            <div className="grid grid-cols-5 sm:grid-cols-10 gap-1.5">
              {LIST_ICON_PRESETS.map((iconName) => {
                const IconComponent = ICON_COMPONENTS[iconName] || ListIcon;
                const isSelected = icon === iconName;
                return (
                  <button
                    key={iconName}
                    type="button"
                    onClick={() => setIcon(iconName)}
                    title={iconName}
                    aria-label={`Select ${iconName} icon`}
                    disabled={isSubmitting}
                    className={cn(
                      "flex h-8 w-full items-center justify-center rounded-lg border text-xs transition-all cursor-pointer focus-ring-pink",
                      isSelected
                        ? "border-[#09318D] bg-[#09318D]/10 text-[#09318D] shadow-xs dark:border-[#FD91CC] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
                        : "border-[#E4E8F2] text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:border-[#132E74] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white"
                    )}
                  >
                    <IconComponent className="h-4 w-4" />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-end gap-2.5 border-t border-[#E4E8F2] pt-4 dark:border-[#132E74]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded-lg border border-[#E4E8F2] bg-white px-3.5 py-2 text-xs font-medium text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !name.trim()}
              className="btn-primary-depth inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-xs focus-ring-pink cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : mode === "edit" ? (
                <span>Save Changes</span>
              ) : (
                <span>Create List</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ListDialog(props: ListDialogProps) {
  if (!props.isOpen) return null;
  return (
    <ListDialogModalInner
      key={props.mode === "edit" && props.listToEdit ? props.listToEdit.id : "create-list"}
      {...props}
    />
  );
}
