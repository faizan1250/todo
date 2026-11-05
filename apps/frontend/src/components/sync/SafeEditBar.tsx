"use client";

import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

export interface SafeEditBarProps {
  onShowNew: () => void;
  onKeepMine: () => void;
  className?: string;
}

export function SafeEditBar({ onShowNew, onKeepMine, className }: SafeEditBarProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-border bg-surface px-4 py-3 shadow-soft-blue sm:flex-row sm:items-center",
        className,
      )}
    >
      <p className="flex-1 text-sm text-fg">This task was updated on another device.</p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onShowNew}
          className="btn-primary-depth inline-flex min-h-[48px] cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-semibold text-white focus-ring-pink"
        >
          {copy.sync.showNewVersion}
        </button>
        <button
          type="button"
          onClick={onKeepMine}
          className="inline-flex min-h-[48px] cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-fg-muted hover:text-fg focus-ring-pink"
        >
          {copy.sync.keepMine}
        </button>
      </div>
    </div>
  );
}
