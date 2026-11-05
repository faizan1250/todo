"use client";

import * as React from "react";
import { Sparkles } from "lucide-react";

export function BrandPanel() {
  return (
    <div className="hidden lg:flex flex-col justify-between h-full p-10 bg-[var(--bg-soft)] border-r border-[var(--border)]">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--primary)] text-white shadow-xs">
          <Sparkles className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-[var(--fg)]">Todo Studio</span>
      </div>
      <div>
        <h2 className="text-3xl font-bold tracking-tight text-[var(--fg)]">
          Keep your tasks in sync, anywhere.
        </h2>
        <p className="mt-3 text-sm text-[var(--fg-muted)] max-w-sm">
          A calm place for your work, shared with the people you invite.
        </p>
      </div>
      <p className="text-xs text-[var(--fg-muted)]">© Todo Studio</p>
    </div>
  );
}
