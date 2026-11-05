"use client";

import * as React from "react";
import { CloudOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SignOutDialogProps {
  open: boolean;
  pendingCount: number;
  isWorking?: boolean;
  onClose: () => void;
  onSaveAndSignOut: () => void;
  onSignOutAnyway: () => void;
}

// Shown when the sign-out guard finds unsynced edits. Same dialog language
// as SessionExpiryDialog (overlay, card, focus ring) for consistency.
export function SignOutDialog({
  open,
  pendingCount,
  isWorking = false,
  onClose,
  onSaveAndSignOut,
  onSignOutAnyway,
}: SignOutDialogProps) {
  if (!open) return null;

  const noun = pendingCount === 1 ? "change" : "changes";

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#051A4D]/60 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-guard-title"
        aria-describedby="signout-guard-desc"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white text-[#0B1220] shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200"
      >
        <div className="relative border-b border-[#E4E8F2]/80 bg-white/50 px-6 py-5 dark:border-[#132E74]/80 dark:bg-[#082363]/50">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="focus-ring-pink absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#5B6478] transition-colors hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#092B7D] dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFE8F5] text-[#09318D] dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]"
            >
              <CloudOff className="h-5 w-5" />
            </div>
            <h2
              id="signout-guard-title"
              className="text-base font-bold tracking-tight text-[#0B1220] dark:text-white"
            >
              Unsaved changes
            </h2>
          </div>
          <p
            id="signout-guard-desc"
            className="mt-2 text-xs leading-relaxed text-[#5B6478] dark:text-[#9BB0D3]"
          >
            Some changes haven&apos;t been saved yet — {pendingCount} unsent{" "}
            {noun} waiting to sync. Sign out now and they will be lost.
          </p>
        </div>

        <div className="space-y-3 p-6">
          <Button
            type="button"
            variant="primary"
            className="w-full text-sm font-semibold"
            isLoading={isWorking}
            onClick={onSaveAndSignOut}
          >
            Save and sign out
          </Button>
          <button
            type="button"
            onClick={onSignOutAnyway}
            disabled={isWorking}
            className="focus-ring-pink w-full cursor-pointer text-center text-xs text-[#5B6478] underline-offset-4 transition-colors hover:text-red-600 hover:underline disabled:opacity-50 dark:text-[#9BB0D3] dark:hover:text-red-400"
          >
            Sign out anyway (changes will be lost)
          </button>
        </div>
      </div>
    </div>
  );
}
