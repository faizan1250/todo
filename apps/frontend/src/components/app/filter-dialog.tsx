"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { X, Filter, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { createFilter, updateFilter, previewFilter, type BackendSavedFilter } from "@/lib/api";

export interface FilterDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: "create" | "edit";
  filterToEdit?: BackendSavedFilter | null;
  onSuccess: (filter: BackendSavedFilter) => void;
}

function FilterDialogInner({ onClose, mode, filterToEdit, onSuccess }: Omit<FilterDialogProps, "isOpen">) {
  const [name, setName] = useState(mode === "edit" && filterToEdit ? filterToEdit.name : "");
  const [icon, setIcon] = useState(mode === "edit" && filterToEdit?.icon ? filterToEdit.icon : "filter");
  const [color, setColor] = useState(mode === "edit" && filterToEdit?.color ? filterToEdit.color : "#09318D");
  const [queryText, setQueryText] = useState(
    mode === "edit" && filterToEdit ? JSON.stringify(filterToEdit.query ?? {}, null, 2) : "{\n  \"status\": \"open\"\n}"
  );
  const [sortText, setSortText] = useState(
    mode === "edit" && filterToEdit?.sort ? JSON.stringify(filterToEdit.sort, null, 2) : ""
  );
  const [groupBy, setGroupBy] = useState(mode === "edit" && filterToEdit?.groupBy ? filterToEdit.groupBy : "");
  const [pinned, setPinned] = useState(mode === "edit" && filterToEdit ? filterToEdit.pinned : false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [previewOk, setPreviewOk] = useState<boolean | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 50);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
    };
  }, []);

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

  const parseJson = (text: string): unknown => {
    if (!text.trim()) return undefined;
    return JSON.parse(text);
  };

  const handlePreview = async () => {
    setErrorMessage(null);
    setPreviewOk(null);
    let query: unknown;
    let sort: unknown;
    try {
      query = parseJson(queryText);
      if (sortText.trim()) sort = parseJson(sortText);
    } catch (e) {
      setErrorMessage("Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
      setPreviewOk(false);
      return;
    }
    try {
      await previewFilter({ query, sort: sort as any });
      setPreviewOk(true);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Preview failed");
      setPreviewOk(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setErrorMessage("Filter name cannot be empty");
      inputRef.current?.focus();
      return;
    }
    let query: unknown;
    let sort: unknown;
    try {
      query = parseJson(queryText);
      if (sortText.trim()) sort = parseJson(sortText);
    } catch (e) {
      setErrorMessage("Invalid JSON: " + (e instanceof Error ? e.message : String(e)));
      return;
    }

    // validate by preview first
    try {
      await previewFilter({ query, sort: sort as any });
    } catch (e) {
      setErrorMessage("Validation failed: " + (e instanceof Error ? e.message : String(e)));
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const payload: any = {
        name: trimmed,
        icon,
        color,
        query,
        sort: sort ?? null,
        groupBy: groupBy || null,
        pinned,
      };
      const saved =
        mode === "edit" && filterToEdit
          ? await updateFilter(filterToEdit.id, payload)
          : await createFilter(payload);
      onSuccess(saved);
      onClose();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to save filter");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-xl border border-[#E4E8F2] bg-white p-5 shadow-xl dark:border-[#132E74] dark:bg-[#082363]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[#0B1220] dark:text-white">
            {mode === "edit" ? "Edit Filter" : "New Filter"}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[#F2F5FC] dark:hover:bg-[#051A4D]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium mb-1">Name</label>
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-[#E4E8F2] px-2 py-1.5 text-sm dark:border-[#132E74] dark:bg-[#051A4D]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Icon</label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-full rounded-md border border-[#E4E8F2] px-2 py-1.5 text-sm dark:border-[#132E74] dark:bg-[#051A4D]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Color</label>
              <input
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-full rounded-md border border-[#E4E8F2] px-2 py-1.5 text-sm dark:border-[#132E74] dark:bg-[#051A4D]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Query (JSON)</label>
            <textarea
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              rows={6}
              className="w-full rounded-md border border-[#E4E8F2] px-2 py-1.5 text-xs font-mono dark:border-[#132E74] dark:bg-[#051A4D]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Sort (JSON optional)</label>
            <textarea
              value={sortText}
              onChange={(e) => setSortText(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-[#E4E8F2] px-2 py-1.5 text-xs font-mono dark:border-[#132E74] dark:bg-[#051A4D]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Group by</label>
            <input
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              placeholder="none"
              className="w-full rounded-md border border-[#E4E8F2] px-2 py-1.5 text-sm dark:border-[#132E74] dark:bg-[#051A4D]"
            />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            <span className="text-xs">Pinned</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePreview}
              className="rounded-md border border-[#E4E8F2] px-3 py-1.5 text-xs dark:border-[#132E74]"
            >
              Preview
            </button>
            {previewOk === true && <span className="text-xs text-green-600">OK</span>}
            {previewOk === false && <span className="text-xs text-red-600">Failed</span>}
          </div>

          {errorMessage && <p className="text-xs text-red-600">{errorMessage}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-xs">
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-md bg-[#09318D] px-3 py-1.5 text-xs text-white disabled:opacity-50"
            >
              {isSubmitting ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function FilterDialog({ isOpen, ...props }: FilterDialogProps) {
  if (!isOpen) return null;
  return <FilterDialogInner {...props} />;
}
