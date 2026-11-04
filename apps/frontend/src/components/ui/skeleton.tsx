import * as React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  shimmer?: boolean;
}

export function Skeleton({
  className,
  shimmer = true,
  ...props
}: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading content"
      className={cn(
        "rounded-md bg-[#EBF0FA] dark:bg-[#0C2B7A]",
        shimmer ? "animate-pulse" : "",
        className
      )}
      {...props}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}
