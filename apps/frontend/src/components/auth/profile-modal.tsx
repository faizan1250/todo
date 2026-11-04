"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "./auth-provider";
import { updateCurrentProfile } from "@/lib/api";
import { Button, Input, Badge } from "@/components/ui";
import { CheckCircle2Icon, AlertCircleIcon } from "@/components/icons";
import { X, User, Globe, Calendar, ShieldCheck, ShieldAlert, SunMoon, LayoutList } from "lucide-react";

export interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ProfileModalDialogProps {
  onClose: () => void;
}

function ProfileModalDialog({ onClose }: ProfileModalDialogProps) {
  const { profile, user, setProfile } = useAuth();

  const [name, setName] = useState(profile?.name || user?.name || "");
  const [timezone, setTimezone] = useState(profile?.timezone || "UTC");
  const [locale, setLocale] = useState(profile?.locale || "en-US");
  const [weekStartsOn, setWeekStartsOn] = useState<number>(
    profile?.weekStartsOn ?? 1
  );
  const [theme, setTheme] = useState<string>(
    (profile?.preferences?.theme as string) || "system"
  );
  const [defaultListId, setDefaultListId] = useState<string>(
    (profile?.preferences?.defaultListId as string) || "today"
  );

  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const timeout = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 50);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeout);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const updated = await updateCurrentProfile({
        name: name.trim(),
        timezone: timezone.trim(),
        locale: locale.trim(),
        weekStartsOn: Number(weekStartsOn),
        preferences: {
          ...(profile?.preferences || {}),
          theme,
          defaultListId,
        },
      });

      // Synchronize document theme immediately
      if (theme === "dark") {
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
      } else if (theme === "light") {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
      } else if (theme === "system") {
        const isSystemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (isSystemDark) {
          document.documentElement.classList.add("dark");
        } else {
          document.documentElement.classList.remove("dark");
        }
        localStorage.removeItem("theme");
      }

      setProfile(updated);
      setSuccessMessage("Profile preferences updated successfully.");
      setTimeout(() => {
        setSuccessMessage(null);
      }, 3000);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to update profile."
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-[#051A4D]/60 backdrop-blur-xs transition-opacity duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-modal-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white text-[#0B1220] shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC]"
      >
        {/* Header */}
        <div className="relative border-b border-[#E4E8F2]/80 bg-white/50 px-6 py-5 dark:border-[#132E74]/80 dark:bg-[#082363]/50">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="focus-ring-pink absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6478] transition-colors hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#092B7D] dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          <h2
            id="profile-modal-title"
            className="text-xl font-bold tracking-tight text-[#0B1220] dark:text-white"
          >
            Workspace Profile
          </h2>
          <p className="mt-0.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
            Manage your personal settings, time display, and locale.
          </p>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {successMessage && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
            >
              <CheckCircle2Icon className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
            >
              <AlertCircleIcon className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Account Overview Tag */}
          <div className="flex items-center justify-between rounded-xl border border-[#E4E8F2] bg-[#F2F5FC] p-3 dark:border-[#132E74] dark:bg-[#061B4A]">
            <div>
              <p className="text-xs font-semibold text-[#0B1220] dark:text-[#F8FAFC]">
                {user?.email}
              </p>
              <p className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">
                Role: {profile?.role || user?.role || "user"}
              </p>
            </div>
            {profile?.twoFactorEnabled ? (
              <Badge
                variant="secondary"
                className="bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300"
              >
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                2FA Active
              </Badge>
            ) : (
              <Badge variant="outline">
                <ShieldAlert className="h-3 w-3 text-[#5B6478]" />
                2FA Off
              </Badge>
            )}
          </div>

          <div>
            <label
              htmlFor="profile-name"
              className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
            >
              Display Name
            </label>
            <div className="relative">
              <Input
                ref={firstInputRef}
                id="profile-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pl-9"
              />
              <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="profile-timezone"
                className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
              >
                Timezone
              </label>
              <div className="relative">
                <Input
                  id="profile-timezone"
                  type="text"
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="pl-9 text-xs"
                  placeholder="UTC"
                />
                <Globe className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
              </div>
            </div>

            <div>
              <label
                htmlFor="profile-locale"
                className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
              >
                Locale
              </label>
              <Input
                id="profile-locale"
                type="text"
                value={locale}
                onChange={(e) => setLocale(e.target.value)}
                className="text-xs"
                placeholder="en-US"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="profile-theme"
                className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
              >
                Theme Preference
              </label>
              <div className="relative">
                <select
                  id="profile-theme"
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                  className="flex h-10 w-full rounded-[10px] border border-[#E4E8F2] bg-white pl-9 pr-3 py-2 text-xs text-[#0B1220] shadow-2xs focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#072366]/50 dark:text-[#F8FAFC]"
                >
                  <option value="system">System Default</option>
                  <option value="light">Light Mode</option>
                  <option value="dark">Deep Blue Dark</option>
                </select>
                <SunMoon className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
              </div>
            </div>

            <div>
              <label
                htmlFor="profile-default-list"
                className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
              >
                Default View
              </label>
              <div className="relative">
                <select
                  id="profile-default-list"
                  value={defaultListId}
                  onChange={(e) => setDefaultListId(e.target.value)}
                  className="flex h-10 w-full rounded-[10px] border border-[#E4E8F2] bg-white pl-9 pr-3 py-2 text-xs text-[#0B1220] shadow-2xs focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#072366]/50 dark:text-[#F8FAFC]"
                >
                  <option value="today">Today</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="backlog">Backlog</option>
                  <option value="completed">Completed</option>
                </select>
                <LayoutList className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
              </div>
            </div>
          </div>

          <div>
            <label
              htmlFor="profile-week-start"
              className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
            >
              Week Starts On
            </label>
            <div className="relative">
              <select
                id="profile-week-start"
                value={weekStartsOn}
                onChange={(e) => setWeekStartsOn(Number(e.target.value))}
                className="flex h-10 w-full rounded-[10px] border border-[#E4E8F2] bg-white pl-9 pr-3 py-2 text-sm text-[#0B1220] shadow-2xs focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#072366]/50 dark:text-[#F8FAFC]"
              >
                <option value={1}>Monday (ISO standard)</option>
                <option value={0}>Sunday</option>
                <option value={6}>Saturday</option>
              </select>
              <Calendar className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" isLoading={isSaving}>
              Save Preferences
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProfileModal({ isOpen, onClose }: ProfileModalProps) {
  if (!isOpen) return null;
  return <ProfileModalDialog onClose={onClose} />;
}
