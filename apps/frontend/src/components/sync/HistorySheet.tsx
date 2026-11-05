"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { getSyncConflicts, type SyncConflict } from "@/lib/api";
import {
  formatConflictValue,
  restoreFromTrash,
  restoreMyVersion,
} from "./conflict-actions";

export interface HistorySheetProps {
  open: boolean;
  onClose: () => void;
  userId: string;
  entityId: string;
  // Known entity for the deleted-elsewhere empty state (restore needs it).
  // When omitted, the entity is derived from the fetched conflict rows.
  entity?: string | null;
}

const FOCUSABLE = 'button, [href], [tabindex]:not([tabindex="-1"])';

interface HistoryContentProps {
  userId: string;
  entityId: string;
  entity: string | null;
  onDone: () => void;
}

// Keyed by entityId from the parent, so loading/error/rows always start
// fresh and the effect below only sets state from async callbacks.
function HistoryContent({ userId, entityId, entity, onDone }: HistoryContentProps) {
  const [conflicts, setConflicts] = useState<SyncConflict[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSyncConflicts({ limit: 50 })
      .then((res) => {
        if (cancelled) return;
        setConflicts(res.conflicts.filter((c) => c.entityId === entityId));
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : copy.sync.stuck);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const rows = conflicts ?? [];
  const derivedEntity = entity ?? rows[0]?.entity ?? null;

  const handleRestoreRow = async (row: SyncConflict): Promise<void> => {
    setRestoringId(row.id);
    try {
      await restoreMyVersion(userId, {
        entity: row.entity,
        entityId: row.entityId,
        field: row.field,
        losingValue: row.losingValue,
      });
      toast(copy.sync.allSaved);
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : copy.sync.stuck);
    } finally {
      setRestoringId(null);
    }
  };

  const handleRestoreDeleted = async (): Promise<void> => {
    if (!derivedEntity) return;
    setRestoringId("__deleted__");
    try {
      await restoreFromTrash(userId, derivedEntity, entityId);
      toast(copy.sync.allSaved);
      onDone();
    } catch (err) {
      toast(err instanceof Error ? err.message : copy.sync.stuck);
    } finally {
      setRestoringId(null);
    }
  };

  if (error !== null) {
    return <p className="text-sm text-fg-muted">{error}</p>;
  }
  if (conflicts === null) {
    return <p className="text-sm text-fg-muted">{copy.sync.refreshing}</p>;
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-fg-muted">{copy.sync.deletedElsewhere}</p>
        {derivedEntity !== null ? (
          <button
            type="button"
            disabled={restoringId !== null}
            onClick={() => void handleRestoreDeleted()}
            className="btn-primary-depth inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg px-4 text-sm font-semibold text-white focus-ring-pink disabled:cursor-default disabled:opacity-60"
          >
            Restore
          </button>
        ) : null}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => {
        const updated = copy.sync.lastUpdated(row.at);
        const busy = restoringId !== null;
        return (
          <li
            key={row.id}
            className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-3 shadow-soft-blue"
          >
            <p className="text-sm font-semibold text-fg">{row.field}</p>
            <p className="text-sm text-fg-muted">
              Your version: {formatConflictValue(row.losingValue)}
            </p>
            <p className="text-sm text-fg-muted">
              New version: {formatConflictValue(row.winningValue)}
            </p>
            {updated !== null ? (
              <p className="text-xs text-fg-muted">{updated}</p>
            ) : null}
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRestoreRow(row)}
              className="inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-4 text-sm font-medium text-fg-muted hover:text-fg focus-ring-pink disabled:cursor-default disabled:opacity-60"
            >
              {copy.sync.keepMine}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function HistorySheet({
  open,
  onClose,
  userId,
  entityId,
  entity = null,
}: HistorySheetProps) {
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
        aria-labelledby="history-sheet-title"
        tabIndex={-1}
        className={cn(
          "relative max-h-[80vh] w-full max-w-md overflow-y-auto rounded-t-xl border border-border bg-surface p-5 text-fg shadow-lift-blue",
          "outline-none sm:rounded-xl",
        )}
      >
        <h2 id="history-sheet-title" className="text-base font-semibold">
          What changed
        </h2>
        <div className="mt-3">
          <HistoryContent
            key={entityId}
            userId={userId}
            entityId={entityId}
            entity={entity}
            onDone={onClose}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={copy.sync.close}
          className="mt-4 inline-flex min-h-[48px] w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-surface px-4 text-base font-medium text-fg-muted hover:text-fg focus-ring-pink"
        >
          {copy.sync.close}
        </button>
      </section>
    </div>
  );
}
