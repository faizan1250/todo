"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

export function ThemeToggle({ className }: ThemeToggleProps) {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Check initial preference from class on html or system preference
    const isDarkInitially =
      document.documentElement.classList.contains("dark") ||
      (localStorage.getItem("theme") === "dark") ||
      (!localStorage.getItem("theme") &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);

    if (isDarkInitially) {
      document.documentElement.classList.add("dark");
      setIsDark(true);
    } else {
      document.documentElement.classList.remove("dark");
      setIsDark(false);
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !isDark;
    setIsDark(nextDark);
    if (nextDark) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    }
  };

  if (!mounted) {
    return (
      <div
        className={cn(
          "h-8 w-8 rounded-lg border border-[#E4E8F2] bg-white dark:border-[#132E74] dark:bg-[#051A4D]",
          className
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg border border-[#E4E8F2] bg-white text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors focus-ring-pink dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3] dark:hover:text-white cursor-pointer",
        className
      )}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun className="h-4 w-4 text-[#FD91CC]" />
      ) : (
        <Moon className="h-4 w-4 text-[#09318D]" />
      )}
    </button>
  );
}
