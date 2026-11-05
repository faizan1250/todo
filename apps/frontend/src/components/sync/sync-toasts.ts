"use client";

// Conflict / sync toasts (Phase 5 Day 4b). sonner IS installed
// (package.json: sonner ^2.0.8), so these call it directly.
// NOTE: <Toaster> mount belongs to the app layout — out of scope here.
// Mount <Toaster position="bottom-center" /> once in the root layout
// before these toasts become visible.

import { toast } from "sonner";
import { copy } from "@/lib/copy";

export function toastConflict(taskName: string, onSeeChanges: () => void): void {
  toast(copy.sync.conflictKept(taskName), {
    action: { label: copy.sync.showNewVersion, onClick: onSeeChanges },
  });
}

export function toastDeletedElsewhere(onRestore?: () => void): void {
  toast(copy.sync.deletedElsewhere, {
    ...(onRestore != null
      ? { action: { label: "Restore", onClick: onRestore } }
      : {}),
  });
}

export function toastRejected(): void {
  toast(copy.sync.rejectedReverted);
}
