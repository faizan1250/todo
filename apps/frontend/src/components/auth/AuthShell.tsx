"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface AuthShellProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
  className?: string;
}

export function AuthShell({ children, title, subtitle, className }: AuthShellProps) {
  return (
    <div className={cn("w-full max-w-md", className)}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--fg)]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-[var(--fg-muted)]">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
