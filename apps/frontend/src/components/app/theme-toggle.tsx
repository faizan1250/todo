"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOptionalAuth } from "@/components/auth";

interface ThemeToggleProps {
  className?: string;
}

const THEMES = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "Auto", icon: Monitor },
] as const;

export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  const auth = useOptionalAuth();
  const mounted = React.useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const handleSelect = (value: string) => {
    setTheme(value);
    if (auth?.isAuthenticated && auth.updatePreferences) {
      void auth.updatePreferences({ theme: value });
    }
  };

  if (!mounted) {
    return (
      <div
        className={cn(
          "inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1",
          className
        )}
      />
    );
  }

  return (
    <div
      role="group"
      aria-label="Theme selection"
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1",
        className
      )}
    >
      {THEMES.map(({ value, label, icon: Icon }) => {
        const active = theme === value;
        return (
          <button
            key={value}
            type="button"
            onClick={() => handleSelect(value)}
            aria-pressed={active}
            aria-label={`${label} theme`}
            title={label}
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-md text-[var(--fg-muted)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
              active
                ? "bg-[var(--primary)] text-[var(--on-primary)]"
                : "hover:bg-[var(--bg-soft)] hover:text-[var(--fg)]"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="sr-only">{label}</span>
          </button>
        );
      })}
    </div>
  );
}