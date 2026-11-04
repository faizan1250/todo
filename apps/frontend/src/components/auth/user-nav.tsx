"use client";

import * as React from "react";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "./auth-provider";
import { ProfileModal } from "./profile-modal";
import { Button, Badge } from "@/components/ui";
import {
  ChevronDown,
  Settings,
  LogOut,
  RefreshCw,
} from "lucide-react";

export function UserNav() {
  const { user, profile, isAuthenticated, isLoading, logout, openAuthModal, refreshSession } =
    useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown on click outside or Escape
  useEffect(() => {
    if (!dropdownOpen) return;

    const handlePointerDown = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [dropdownOpen]);

  // Loading skeleton placeholder to prevent CLS
  if (isLoading) {
    return (
      <div className="flex items-center gap-2" aria-hidden="true">
        <div className="h-8 w-16 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800/70" />
        <div className="h-8 w-20 animate-pulse rounded-lg bg-zinc-200/70 dark:bg-zinc-800/70" />
      </div>
    );
  }

  // Unauthenticated State: Sign In & Sign Up triggers
  if (!isAuthenticated || !user) {
    return (
      <nav aria-label="Account actions" className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => openAuthModal("sign-in")}
          className="text-xs"
        >
          Sign In
        </Button>
        <Button
          type="button"
          variant="accent"
          size="sm"
          onClick={() => openAuthModal("sign-up")}
          className="text-xs"
        >
          Sign Up
        </Button>
      </nav>
    );
  }

  // Get Initials for Avatar
  const getInitials = (name?: string, email?: string) => {
    if (name && name.trim()) {
      const parts = name.trim().split(" ");
      if (parts.length >= 2 && parts[0] && parts[1]) {
        return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      }
      return name.slice(0, 2).toUpperCase();
    }
    if (email) {
      return email.slice(0, 2).toUpperCase();
    }
    return "US";
  };

  const initials = getInitials(user.name, user.email);

  return (
    <>
      <div ref={containerRef} className="relative inline-block text-left">
        {/* User Trigger Button */}
        <button
          type="button"
          onClick={() => setDropdownOpen((prev) => !prev)}
          aria-haspopup="menu"
          aria-expanded={dropdownOpen}
          className="focus-ring-pink inline-flex items-center gap-2 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0B1220] shadow-2xs transition-colors hover:bg-[#F2F5FC] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC] dark:hover:bg-[#092B7D]"
        >
          {/* Avatar */}
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#09318D] text-[10px] font-bold text-white shadow-2xs">
            {initials}
          </div>

          <span className="hidden max-w-[120px] truncate sm:inline-block font-medium">
            {user.name || user.email}
          </span>

          <ChevronDown
            className={`h-3.5 w-3.5 text-[#5B6478] transition-transform duration-150 dark:text-[#9BB0D3] ${
              dropdownOpen ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Dropdown Menu */}
        {dropdownOpen && (
          <div
            role="menu"
            aria-orientation="vertical"
            className="absolute right-0 z-40 mt-2 w-64 origin-top-right rounded-xl border border-[#E4E8F2] bg-white p-1.5 shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] animate-in fade-in-0 zoom-in-95 duration-150"
          >
            {/* Header info */}
            <div className="border-b border-[#E4E8F2]/80 px-3 py-2.5 dark:border-[#132E74]/80">
              <div className="flex items-center justify-between">
                <p className="truncate text-xs font-semibold text-[#0B1220] dark:text-white">
                  {user.name || "Workspace Member"}
                </p>
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                  {profile?.role || user.role || "user"}
                </Badge>
              </div>
              <p className="truncate text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                {user.email}
              </p>
              {profile?.timezone && (
                <p className="mt-1 text-[10px] text-[#5B6478]/80 dark:text-[#9BB0D3]/80">
                  Timezone: {profile.timezone}
                </p>
              )}
            </div>

            {/* Menu options */}
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setDropdownOpen(false);
                  setProfileModalOpen(true);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#0B1220] transition-colors hover:bg-[#F2F5FC] dark:text-[#F8FAFC] dark:hover:bg-[#092B7D]"
              >
                <Settings className="h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
                <span>Profile Settings</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setIsRefreshing(true);
                  await refreshSession();
                  setIsRefreshing(false);
                  setDropdownOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[#0B1220] transition-colors hover:bg-[#F2F5FC] dark:text-[#F8FAFC] dark:hover:bg-[#092B7D]"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3] ${
                    isRefreshing ? "animate-spin" : ""
                  }`}
                />
                <span>Refresh Session</span>
              </button>
            </div>

            {/* Sign Out */}
            <div className="border-t border-[#E4E8F2]/80 pt-1 dark:border-[#132E74]/80">
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  setDropdownOpen(false);
                  await logout();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Profile Settings Modal */}
      <ProfileModal
        isOpen={profileModalOpen}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  );
}
