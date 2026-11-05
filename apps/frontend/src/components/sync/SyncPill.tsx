"use client";

import { Check, Moon, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import type { SyncState } from "@/lib/sync2/status";

export interface SyncPillProps {
  state: SyncState;
  pendingCount: number;
  lastSyncAt: number | null;
  onOpen: () => void;
}

type Tone = "saved" | "saving" | "offline" | "waiting" | "trouble" | "update";

function resolveTone(state: SyncState, pendingCount: number): Tone {
  switch (state) {
    case "updateRequired":
      return "update";
    case "offline":
      return "offline";
    case "backoff":
      return pendingCount > 0 ? "waiting" : "trouble";
    case "pushing":
    case "pulling":
    case "resyncing":
      return "saving";
    case "idle":
    default:
      return pendingCount > 0 ? "waiting" : "saved";
  }
}

function labelFor(
  tone: Tone,
  state: SyncState,
  pendingCount: number,
  lastSyncAt: number | null,
): string {
  switch (tone) {
    case "saving":
      if (state === "pulling" || state === "resyncing") return copy.sync.refreshing;
      return pendingCount > 0 ? copy.sync.savingCount(pendingCount) : copy.sync.saving;
    case "offline":
      return copy.sync.offlineBanner;
    case "waiting":
      return copy.sync.waitingCount(pendingCount);
    case "trouble":
      return copy.sync.stuck;
    case "update":
      return copy.sync.newVersion;
    case "saved":
    default:
      return lastSyncAt == null ? copy.sync.settingUp : copy.sync.allSaved;
  }
}

function ToneIcon({ tone }: { tone: Tone }) {
  if (tone === "saving") {
    return (
      <span
        aria-hidden="true"
        className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-border border-t-primary motion-safe:animate-spin"
      />
    );
  }
  if (tone === "saved") {
    return <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-success" />;
  }
  if (tone === "offline") {
    return <Moon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warning" />;
  }
  if (tone === "update") {
    return (
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />
    );
  }
  // waiting + trouble share the warning mark; waiting also carries a count badge.
  return (
    <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-warning" />
  );
}

export function SyncPill({ state, pendingCount, lastSyncAt, onOpen }: SyncPillProps) {
  const tone = resolveTone(state, pendingCount);
  const label = labelFor(tone, state, pendingCount, lastSyncAt);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-live="polite"
      className={cn(
        "inline-flex min-h-[48px] max-w-full cursor-pointer items-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm text-fg-muted shadow-soft-blue",
        "hover:border-primary/40 hover:text-fg",
        "focus-ring-pink",
      )}
    >
      <ToneIcon tone={tone} />
      <span className="truncate">{label}</span>
      {tone === "waiting" && pendingCount > 0 ? (
        <span
          aria-hidden="true"
          className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-warning/15 px-1 text-[11px] font-semibold text-warning"
        >
          {pendingCount}
        </span>
      ) : null}
    </button>
  );
}
