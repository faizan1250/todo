import * as React from "react";
import {
  CheckCircle2,
  SearchX,
  CalendarCheck2,
  Sparkles,
  Inbox,
  FilterX,
  FolderOpen,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ListId, FolderId } from "./types";

export type EmptyStateType =
  | "search"
  | "filter"
  | "today"
  | "upcoming"
  | "backlog"
  | "completed"
  | "folder"
  | "generic";

export interface EmptyStateProps {
  type?: EmptyStateType;
  searchQuery?: string;
  activeList?: ListId;
  activeFolder?: FolderId | null;
  onAction?: () => void;
  actionLabel?: string;
  secondaryAction?: () => void;
  secondaryActionLabel?: string;
  className?: string;
}

interface StateContent {
  icon: React.ElementType;
  title: string;
  description: string;
  defaultActionLabel?: string;
}

export function EmptyState({
  type,
  searchQuery,
  activeList = "today",
  activeFolder,
  onAction,
  actionLabel,
  secondaryAction,
  secondaryActionLabel,
  className,
}: EmptyStateProps) {
  // Determine effective type if not explicitly passed
  let resolvedType: EmptyStateType = type || "generic";
  if (!type) {
    if (searchQuery && searchQuery.trim().length > 0) {
      resolvedType = "search";
    } else if (activeFolder) {
      resolvedType = "folder";
    } else if (
      activeList === "today" ||
      activeList === "upcoming" ||
      activeList === "backlog" ||
      activeList === "completed"
    ) {
      resolvedType = activeList as EmptyStateType;
    } else {
      resolvedType = "generic";
    }
  }

  const contentMap: Record<EmptyStateType, StateContent> = {
    search: {
      icon: SearchX,
      title: searchQuery ? `No tasks matching "${searchQuery}"` : "No matching tasks found",
      description: "Try searching with broader terms, checking spelling, or clearing active filters.",
      defaultActionLabel: "Clear Search",
    },
    filter: {
      icon: FilterX,
      title: "No tasks match current filters",
      description: "None of your tasks match the selected priority or status filters.",
      defaultActionLabel: "Reset Filters",
    },
    today: {
      icon: CheckCircle2,
      title: "All clear for today!",
      description: "You're completely caught up on today's milestones. Plan upcoming work or take a well-deserved breather.",
      defaultActionLabel: "Create a task",
    },
    upcoming: {
      icon: CalendarCheck2,
      title: "No upcoming milestones",
      description: "Your sprint schedule is wide open. Add future deadlines and deliverable targets to stay ahead.",
      defaultActionLabel: "Add upcoming task",
    },
    backlog: {
      icon: Inbox,
      title: "Engineering backlog is empty",
      description: "No pending backlog items. Capture technical debt, architecture refactors, or feature ideas here.",
      defaultActionLabel: "Add to backlog",
    },
    completed: {
      icon: Sparkles,
      title: "Nothing completed yet",
      description: "Check off your first milestone task to trigger the celebratory streak engine and record velocity.",
      defaultActionLabel: "View active tasks",
    },
    folder: {
      icon: FolderOpen,
      title: `No tasks in ${activeFolder ? activeFolder.charAt(0).toUpperCase() + activeFolder.slice(1) : "this folder"}`,
      description: "Organize project goals by assigning new tasks or dragging work items into this folder.",
      defaultActionLabel: "Create task in folder",
    },
    generic: {
      icon: Inbox,
      title: "No tasks found",
      description: "This view is currently empty. Get started by adding your first task.",
      defaultActionLabel: "Create task",
    },
  };

  const currentContent = contentMap[resolvedType] || contentMap.generic;
  const IconComponent = currentContent.icon;
  const effectiveActionLabel = actionLabel || currentContent.defaultActionLabel;

  return (
    <div
      role="region"
      aria-label="Empty state feedback"
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#E4E8F2] bg-white/70 p-8 sm:p-12 text-center backdrop-blur-xs motion-safe:transition-all dark:border-[#132E74] dark:bg-[#082363]/30",
        className
      )}
    >
      {/* Decorative Icon Badge with Tier 1 Elevation and Bubblegum Accent Light */}
      <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F2F5FC] border border-[#E4E8F2] shadow-2xs dark:bg-[#092B7D]/60 dark:border-[#132E74]">
        {/* Soft pink highlight ring (restrained 5-10% budget) */}
        <div
          className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-[#FD91CC] border-2 border-white dark:border-[#082363]"
          aria-hidden="true"
        />
        <IconComponent className="h-6 w-6 text-[#09318D] dark:text-[#FFA8D7]" />
      </div>

      {/* Primary Message */}
      <h3 className="text-base font-bold tracking-tight text-[#0B1220] dark:text-white">
        {currentContent.title}
      </h3>

      {/* Explanatory Friendly Copy */}
      <p className="mt-1.5 max-w-sm text-xs leading-relaxed text-[#5B6478] dark:text-[#9BB0D3]">
        {currentContent.description}
      </p>

      {/* Action Buttons */}
      {(onAction || secondaryAction) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {onAction && effectiveActionLabel && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={onAction}
              className="gap-1.5"
            >
              <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
              <span>{effectiveActionLabel}</span>
            </Button>
          )}

          {secondaryAction && secondaryActionLabel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={secondaryAction}
            >
              {secondaryActionLabel}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
