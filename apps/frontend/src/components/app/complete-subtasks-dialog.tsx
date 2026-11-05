"use client";

import * as React from "react";
import { useEffect } from "react";
import { CheckSquare, X } from "lucide-react";
import { copy } from "@/lib/copy";

export interface CompleteSubtasksDialogProps {
  isOpen: boolean;
  openCount: number;
  onConfirmAll: () => void;
  onConfirmSingle: () => void;
  onClose: () => void;
}

export function CompleteSubtasksDialog({
  isOpen,
  openCount,
  onConfirmAll,
  onConfirmSingle,
  onClose,
}: CompleteSubtasksDialogProps) {
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

  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#051A4D]/60 backdrop-blur-xs animate-in fade-in-0 duration-150 motion-reduce:animate-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="complete-subtasks-dialog-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white text-[#0B1220] shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC] animate-in fade-in-50 zoom-in-95 duration-150 motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#09318D]/10 text-[#09318D] dark:bg-[#FD91CC]/15 dark:text-[#FFA8D7]">
              <CheckSquare className="h-4.5 w-4.5" />
            </div>
            <h2
              id="complete-subtasks-dialog-title"
              className="text-sm sm:text-base font-bold tracking-tight"
            >
              {copy.tasks.completeWithSubtasks(openCount)}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1.5 text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:text-[#9BB0D3] dark:hover:bg-[#051A4D] dark:hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col gap-2 px-5 py-5">
          <button
            type="button"
            onClick={onConfirmAll}
            className="btn-primary-depth inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-semibold text-white focus-ring-pink"
          >
            Yes, complete all
          </button>
          <button
            type="button"
            onClick={onConfirmSingle}
            autoFocus
            className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg border border-[#CAD5E8] bg-white px-4 text-sm font-semibold text-[#0B1220] hover:bg-[#F2F5FC] focus-ring-pink dark:border-[#16367F] dark:bg-[#051A4D] dark:text-white dark:hover:bg-[#082363]"
          >
            No, just this one
          </button>
        </div>
      </div>
    </div>
  );
}
