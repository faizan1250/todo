"use client";

import * as React from "react";
import { useState } from "react";
import { BackendStatusBadge } from "@/components/backend-status-badge";
import { UserNav, useAuth } from "@/components/auth";
import { Hero, FeaturesGrid, FaqSection } from "@/components/landing";
import { AppWorkspace, ThemeToggle } from "@/components/app";
import { Sparkles, LayoutDashboard, Globe } from "lucide-react";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const { isAuthenticated, openAuthModal } = useAuth();
  // If user is authenticated, default to app workspace; otherwise default to landing page
  const [activeView, setActiveView] = useState<"landing" | "app">(() =>
    isAuthenticated ? "app" : "landing"
  );

  const toggleTheme = () => {
    const isDark = document.documentElement.classList.contains("dark");
    if (isDark) {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("theme", "light");
    } else {
      document.documentElement.classList.add("dark");
      localStorage.setItem("theme", "dark");
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#0B1220] selection:bg-[#FD91CC]/30 selection:text-[#051A4D] dark:bg-[#051A4D] dark:text-[#F8FAFC] dark:selection:bg-[#FD91CC]/30 dark:selection:text-[#FD91CC]">
      {/* Global Top Application Navigation Header */}
      <header className="sticky top-0 z-30 border-b border-[#E4E8F2] bg-white/90 backdrop-blur-md dark:border-[#132E74] dark:bg-[#051A4D]/90 select-none">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          {/* Brand Logo & Version Pill */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveView("landing")}
              className="flex items-center gap-2.5 text-left cursor-pointer focus-ring-pink rounded-lg"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#09318D] text-white shadow-sm dark:bg-[#0D41B4]">
                <Sparkles className="h-4 w-4 text-[#FD91CC]" />
              </div>
              <div>
                <span className="text-sm font-extrabold tracking-tight text-[#0B1220] dark:text-white">
                  Todo Studio
                </span>
                <span className="ml-2 rounded-md bg-[#FFE8F5] px-1.5 py-0.5 text-[10px] font-bold text-[#051A4D] border border-[#FD91CC]/50 dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]">
                  Invite-Only
                </span>
              </div>
            </button>
          </div>

          {/* Central View Switcher Tabs */}
          <nav
            aria-label="Workspace View Switcher"
            className="flex items-center gap-1 rounded-xl border border-[#E4E8F2] bg-[#F2F5FC] p-1 dark:border-[#132E74] dark:bg-[#082363]"
          >
            <button
              type="button"
              onClick={() => setActiveView("landing")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                activeView === "landing"
                  ? "bg-white text-[#09318D] shadow-xs dark:bg-[#0D41B4] dark:text-white"
                  : "text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
              )}
            >
              <Globe className="h-3.5 w-3.5" />
              <span>Landing</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveView("app")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                activeView === "app"
                  ? "bg-white text-[#09318D] shadow-xs dark:bg-[#0D41B4] dark:text-white"
                  : "text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
              )}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              <span>App Workspace</span>
            </button>
          </nav>

          {/* Right Controls: Backend Status, Theme Switcher & User Auth Nav */}
          <div className="flex items-center gap-2.5">
            <BackendStatusBadge />
            <ThemeToggle />
            <UserNav />
          </div>
        </div>
      </header>

      {/* Main View Area */}
      <main className="flex-1 flex flex-col">
        {activeView === "landing" ? (
          <div>
            {/* Landing Hero Section */}
            <Hero
              onOpenAuth={(mode) => openAuthModal(mode || "sign-up")}
              onExploreApp={() => setActiveView("app")}
            />

            {/* 12-Column Features Grid */}
            <FeaturesGrid />

            {/* Polished Accordion FAQ */}
            <FaqSection />

            {/* Architectural Footer */}
            <footer className="border-t border-[#E4E8F2] bg-[#F2F5FC] py-12 dark:border-[#132E74] dark:bg-[#051A4D]">
              <div className="mx-auto max-w-7xl px-4 text-center sm:px-6 lg:px-8 space-y-4">
                <div className="flex items-center justify-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#09318D] text-white">
                    <Sparkles className="h-3.5 w-3.5 text-[#FD91CC]" />
                  </div>
                  <span className="text-sm font-bold text-[#0B1220] dark:text-white">
                    Todo Studio Engineering
                  </span>
                </div>

                <p className="text-xs text-[#5B6478] dark:text-[#9BB0D3] max-w-md mx-auto">
                  High-performance task orchestration interface paired with sub-millisecond ElysiaJS backend.
                </p>

                <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                  <span>Next.js 16 (App Router)</span>
                  <span>•</span>
                  <span>TailwindCSS v4</span>
                  <span>•</span>
                  <span>Better Auth (2FA + Invites)</span>
                  <span>•</span>
                  <span>ElysiaJS Backend (:3001)</span>
                </div>
              </div>
            </footer>
          </div>
        ) : (
          <AppWorkspace
            onOpenAuth={() => openAuthModal("sign-in")}
            onToggleTheme={toggleTheme}
          />
        )}
      </main>
    </div>
  );
}
