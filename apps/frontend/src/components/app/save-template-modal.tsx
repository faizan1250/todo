"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { Bookmark, X, Loader2 } from "lucide-react";

interface SaveTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (templateName: string) => Promise<void> | void;
  defaultName?: string;
}

interface SaveTemplateDialogProps {
  onClose: () => void;
  onSave: (templateName: string) => Promise<void> | void;
  defaultName: string;
}

function SaveTemplateDialog({
  onClose,
  onSave,
  defaultName,
}: SaveTemplateDialogProps) {
  const [templateName, setTemplateName] = useState(defaultName);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape key to dismiss
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = templateName.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save template");
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-template-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#051A4D]/40 backdrop-blur-xs animate-in fade-in duration-150"
    >
      {/* Click outside backdrop */}
      <div className="fixed inset-0" onClick={isSubmitting ? undefined : onClose} />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-[#E4E8F2] bg-white p-5 shadow-xl transition-all dark:border-[#132E74] dark:bg-[#051A4D]">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E4E8F2] dark:border-[#132E74]">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FD91CC]/20 text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]">
              <Bookmark className="h-4 w-4" />
            </div>
            <div>
              <h2 id="save-template-title" className="text-sm font-bold text-[#0B1220] dark:text-white">
                Save Task as Template
              </h2>
              <p className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                Save this task and its subtasks/checklist for reusable workflows.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label
              htmlFor="template-name-input"
              className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]"
            >
              Template Name
            </label>
            <input
              id="template-name-input"
              ref={inputRef}
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="e.g. Weekly Release Sprint checklist"
              disabled={isSubmitting}
              className="mt-1.5 w-full rounded-lg border border-[#E4E8F2] bg-white px-3 py-2 text-xs font-medium text-[#0B1220] placeholder:text-[#5B6478]/50 focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white dark:placeholder:text-[#9BB0D3]/50"
            />
            {error && (
              <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">
                {error}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={onClose}
              className="rounded-lg border border-[#E4E8F2] bg-white px-3 py-1.5 text-xs font-semibold text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] disabled:opacity-50 transition-colors cursor-pointer dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3] dark:hover:bg-[#0D41B4] dark:hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!templateName.trim() || isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-[#09318D] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#0D41B4] disabled:opacity-50 transition-colors cursor-pointer focus-ring-pink dark:bg-[#0D41B4] dark:hover:bg-[#134EC9]"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>Save Template</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function SaveTemplateModal({
  isOpen,
  onClose,
  onSave,
  defaultName = "",
}: SaveTemplateModalProps) {
  if (!isOpen) return null;

  return (
    <SaveTemplateDialog
      defaultName={defaultName}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
