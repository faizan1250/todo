import * as React from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Skeleton placeholder for a single task row in the workspace list.
 */
export function TaskRowSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading task"
      className={cn(
        "flex items-center justify-between gap-3 rounded-xl border border-[#E4E8F2] bg-white p-3.5 sm:px-4 sm:py-3 dark:border-[#132E74] dark:bg-[#082363]/50",
        className
      )}
    >
      <div className="flex items-center gap-3.5 min-w-0 flex-1">
        {/* Checkbox Skeleton */}
        <Skeleton className="h-5 w-5 shrink-0 rounded-md" />

        <div className="min-w-0 flex-1 space-y-2">
          {/* Top row: Priority chip + Title */}
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-14 rounded-full" />
            <Skeleton className="h-4 w-3/5 rounded-md" />
          </div>

          {/* Bottom row: Subtasks & Tags */}
          <div className="flex items-center gap-2 pt-0.5">
            <Skeleton className="h-3 w-16 rounded" />
            <Skeleton className="h-3 w-12 rounded" />
            <Skeleton className="h-3 w-20 rounded" />
          </div>
        </div>
      </div>

      {/* Right meta badge */}
      <div className="hidden sm:flex items-center gap-2 shrink-0">
        <Skeleton className="h-4 w-16 rounded-md" />
      </div>
    </div>
  );
}

/**
 * Skeleton placeholder list rendering multiple task rows.
 */
export function TaskRowSkeletonList({
  count = 4,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-label="Loading task list"
      className={cn("space-y-2.5", className)}
    >
      {Array.from({ length: count }).map((_, index) => (
        <TaskRowSkeleton key={`task-skeleton-${index}`} />
      ))}
    </div>
  );
}

/**
 * Skeleton placeholder for sidebar navigation items.
 */
export function SidebarItemSkeleton({ isCollapsed }: { isCollapsed?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading navigation item"
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2",
        isCollapsed && "justify-center px-0"
      )}
    >
      <Skeleton className="h-4 w-4 shrink-0 rounded" />
      {!isCollapsed && (
        <>
          <Skeleton className="h-3.5 flex-1 rounded" />
          <Skeleton className="h-4 w-6 rounded-full" />
        </>
      )}
    </div>
  );
}

/**
 * Skeleton placeholder for the entire sidebar navigation panel.
 */
export function SidebarSkeleton({ isCollapsed }: { isCollapsed?: boolean }) {
  return (
    <div
      role="status"
      aria-label="Loading sidebar navigation"
      className="space-y-6 px-3 py-2"
    >
      <div>
        {!isCollapsed && <Skeleton className="h-3 w-14 mb-2 ml-1 rounded" />}
        <div className="space-y-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <SidebarItemSkeleton key={`list-skeleton-${i}`} isCollapsed={isCollapsed} />
          ))}
        </div>
      </div>

      <div>
        {!isCollapsed && <Skeleton className="h-3 w-16 mb-2 ml-1 rounded" />}
        <div className="space-y-1">
          {Array.from({ length: 3 }).map((_, i) => (
            <SidebarItemSkeleton key={`folder-skeleton-${i}`} isCollapsed={isCollapsed} />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Skeleton placeholder for profile card modal or popover.
 */
export function ProfileCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading profile details"
      className={cn(
        "rounded-2xl border border-[#E4E8F2] bg-white p-6 space-y-4 dark:border-[#132E74] dark:bg-[#082363]",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-4 w-32 rounded" />
          <Skeleton className="h-3 w-48 rounded" />
        </div>
      </div>

      <div className="space-y-3 pt-2">
        <Skeleton className="h-9 w-full rounded-lg" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-9 rounded-lg" />
          <Skeleton className="h-9 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-full rounded-lg" />
      </div>
    </div>
  );
}

/**
 * Skeleton placeholder for statistics and streak widgets.
 */
export function StatsWidgetSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading statistics widget"
      className={cn(
        "flex items-center justify-between rounded-xl border border-[#E4E8F2] bg-white p-4 dark:border-[#132E74] dark:bg-[#082363]",
        className
      )}
    >
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-3.5 w-24 rounded" />
          <Skeleton className="h-5 w-16 rounded" />
        </div>
      </div>
      <Skeleton className="h-6 w-14 rounded-full" />
    </div>
  );
}

/**
 * Skeleton placeholder for the task detail panel.
 */
export function TaskDetailSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading task detail"
      className={cn("p-6 space-y-6", className)}
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-20 rounded-md" />
          <Skeleton className="h-5 w-24 rounded-md" />
        </div>
        <Skeleton className="h-7 w-4/5 rounded-md" />
      </div>

      <div className="space-y-2">
        <Skeleton className="h-4 w-28 rounded" />
        <Skeleton className="h-16 w-full rounded-lg" />
      </div>

      <div className="space-y-3">
        <Skeleton className="h-4 w-24 rounded" />
        <div className="space-y-2">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      </div>
    </div>
  );
}
