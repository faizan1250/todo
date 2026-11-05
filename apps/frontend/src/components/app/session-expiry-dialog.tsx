"use client";

import * as React from "react";
import { LogIn, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SessionExpiryDialogProps {
  isOpen: boolean;
  onClose?: () => void;
  onSignIn?: () => void;
  returnTo?: string;
}

export function SessionExpiryDialog({
  isOpen,
  onClose,
  onSignIn,
  returnTo,
}: SessionExpiryDialogProps) {
  if (!isOpen) return null;

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#051A4D]/60 backdrop-blur-xs"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-expiry-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white text-[#0B1220] shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC] motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200"
      >
        <div className="relative border-b border-[#E4E8F2]/80 bg-white/50 px-6 py-5 dark:border-[#132E74]/80 dark:bg-[#082363]/50">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="focus-ring-pink absolute right-4 top-4 inline-flex h-11 w-11 items-center justify-center rounded-lg text-[#5B6478] transition-colors hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#092B7D] dark:hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}

          <h2
            id="session-expiry-title"
            className="text-xl font-bold tracking-tight text-[#0B1220] dark:text-white"
          >
            Welcome back, please sign in again
          </h2>
          <p className="mt-1.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
            Your session ended. Sign in to pick up where you left off — nothing
            you were working on was lost.
          </p>
        </div>

        <div className="p-6">
          <Button
            type="button"
            variant="primary"
            className="w-full gap-2 text-sm font-semibold"
            onClick={() => {
              onSignIn?.();
              onClose?.();
            }}
          >
            <LogIn className="h-4 w-4" />
            <span>Sign in again</span>
          </Button>
          {returnTo && (
            <p className="mt-3 text-center text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
              You&apos;ll return to this page after signing in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}