"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

export interface SyncSheetProps {
  open: boolean;
  onClose: () => void;
  lastSyncAt: number | null;
  pendingCount: number;
  onSaveNow: () => void;
}

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

export function SyncSheet({ open, onClose, lastSyncAt, pendingCount, onSaveNow }: SyncSheetProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true",
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const updated = copy.sync.lastUpdated(lastSyncAt) ?? copy.sync.settingUp;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-fg/40 motion-safe:transition-opacity"
      />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-sheet-title"
        tabIndex={-1}
        className={cn(
          "relative w-full max-w-md rounded-t-xl border border-border bg-surface p-5 text-fg shadow-lift-blue",
          "outline-none sm:rounded-xl",
        )}
      >
        <h2 id="sync-sheet-title" className="text-base font-semibold">
          {copy.sync.title}
        </h2>
        <p className="mt-1 text-sm text-fg-muted">{updated}</p>
        {pendingCount > 0 ? (
          <p className="mt-1 text-sm text-fg-muted">
            {copy.sync.waitingCount(pendingCount)}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSaveNow}
            className="btn-primary-depth inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg px-4 text-base font-semibold text-white focus-ring-pink"
          >
            {copy.sync.saveNow}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.sync.close}
            className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-4 text-base font-medium text-fg-muted hover:text-fg focus-ring-pink"
          >
            {copy.sync.close}
          </button>
        </div>
      </section>
    </div>
  );
}
