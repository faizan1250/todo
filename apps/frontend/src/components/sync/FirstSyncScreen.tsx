"use client";

import { cn } from "@/lib/utils";

export interface FirstSyncScreenProps {
  /** 0..1 pull progress. Clamped for rendering. */
  progress: number;
  /** Rows pulled so far (for the "N tasks" line). */
  count: number;
  /** When true the screen fades out (parent unmounts after). */
  done: boolean;
  className?: string;
}

const clamp01 = (n: number): number =>
  Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;

export function FirstSyncScreen({ progress, count, done, className }: FirstSyncScreenProps) {
  const pct = clamp01(progress);
  const label =
    count === 1 ? "1 task so far…" : `${count} tasks so far…`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-hidden={done}
      className={cn(
        "flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 py-16 text-center",
        "motion-safe:transition-opacity motion-safe:duration-300",
        done && "pointer-events-none opacity-0",
        className,
      )}
    >
      <div className="max-w-sm">
        <h1 className="text-lg font-semibold text-fg">
          Setting up your tasks on this device…
        </h1>
        <p className="mt-1 text-sm text-fg-muted">{label}</p>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct * 100)}
        className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-border"
      >
        <div
          aria-hidden="true"
          className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300 motion-safe:ease-out"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>

      {/* Skeleton rows: static placeholders, no shimmer (reduced-motion safe). */}
      <div aria-hidden="true" className="w-full max-w-sm space-y-2">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
          >
            <div className="h-4 w-4 shrink-0 rounded-full bg-border" />
            <div className="h-3 flex-1 rounded bg-border" />
          </div>
        ))}
      </div>
    </div>
  );
}
