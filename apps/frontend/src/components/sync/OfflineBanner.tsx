"use client";

import { Check, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";

export interface OfflineBannerProps {
  online: boolean;
  catchingUp: boolean;
  className?: string;
}

export function OfflineBanner({ online, catchingUp, className }: OfflineBannerProps) {
  if (online && !catchingUp) return null;

  const showCatchingUp = online && catchingUp;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex min-h-[48px] w-full items-center justify-center gap-2 border-b border-border bg-soft px-4 py-2 text-center text-sm text-fg",
        "motion-safe:transition-opacity motion-safe:duration-300",
        className,
      )}
    >
      {showCatchingUp ? (
        <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-success" />
      ) : (
        <Moon aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
      )}
      <span>{showCatchingUp ? copy.sync.backOnline : copy.sync.offlineBanner}</span>
    </div>
  );
}
