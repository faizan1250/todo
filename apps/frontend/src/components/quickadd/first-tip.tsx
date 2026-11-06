"use client";

import * as React from "react";
import { Sparkles, X } from "lucide-react";

interface FirstTipProps {
  summary: string;
  onDismiss: () => void;
}

/** One-time tip shown when the first chips appear. Dismissal persists. */
export function FirstTip({ summary, onDismiss }: FirstTipProps) {
  return (
    <div
      data-testid="smart-first-tip"
      role="status"
      className="flex items-center justify-between gap-2 rounded-lg border border-[#FD91CC]/40 bg-[#FD91CC]/10 px-2.5 py-1.5 dark:border-[#FD91CC]/30 dark:bg-[#FD91CC]/5"
    >
      <p className="flex min-w-0 items-center gap-1.5 text-[11px] text-[#0B1220] dark:text-[#E4E8F2]">
        <Sparkles className="h-3.5 w-3.5 shrink-0 text-[#09318D] dark:text-[#FD91CC]" />
        <span className="truncate">
          We set {summary} from your words. Tap ✕ on a chip to undo.
        </span>
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss smart typing tip"
        className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-[#09318D] hover:bg-[#FD91CC]/20 dark:text-[#FFA8D7] cursor-pointer"
      >
        Got it
      </button>
    </div>
  );
}

export function FirstTipCloseButton({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      aria-label="Dismiss smart typing tip"
      className="rounded p-0.5 text-[#5B6478] hover:bg-[#FD91CC]/20 dark:text-[#9BB0D3] cursor-pointer"
    >
      <X className="h-3 w-3" />
    </button>
  );
}
