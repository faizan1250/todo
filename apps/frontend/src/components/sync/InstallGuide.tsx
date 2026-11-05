"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const VISIT_KEY = "todo:install-guide-visits";
const DISMISS_KEY = "todo:install-guide-dismissed";
const SHOW_AFTER_VISITS = 3;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone ===
      true
  );
}

// Friendly install nudge: appears from the 3rd visit (localStorage counter,
// self-contained), one-tap install on Android/Chrome via beforeinstallprompt,
// 3-step Share → Add to Home Screen guidance on iPhone.
export function InstallGuide() {
  const [visible, setVisible] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [installing, setInstalling] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone()) return;
    try {
      if (window.localStorage.getItem(DISMISS_KEY) === "1") return;
      const visits = Number(window.localStorage.getItem(VISIT_KEY) ?? "0") + 1;
      window.localStorage.setItem(VISIT_KEY, String(visits));
      if (visits >= SHOW_AFTER_VISITS) {
        const t = window.setTimeout(() => setVisible(true), 1200);
        return () => window.clearTimeout(t);
      }
    } catch {
      // Storage unavailable (private mode) — stay hidden, never break.
    }
    return undefined;
  }, []);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible || done) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  const install = async () => {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === "accepted") {
        setDone(true);
        dismiss();
      }
    } finally {
      setInstalling(false);
      setDeferred(null);
    }
  };

  const ios = isIOS();

  return (
    <section
      aria-label="Install Todo Studio"
      className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8"
    >
      <div className="relative overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#09318D] via-[#FD91CC] to-[#09318D]"
        />
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install guide"
          className="focus-ring-pink absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6478] transition-colors hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#092B7D] dark:hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:gap-6 sm:p-6">
          <div
            aria-hidden="true"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#09318D] text-white"
          >
            <Download className="h-5 w-5 text-[#FD91CC]" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-bold tracking-tight text-[#0B1220] dark:text-white">
              Add Todo Studio to your Home Screen
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-[#5B6478] dark:text-[#9BB0D3]">
              Add your tasks to your Home Screen so your tasks stay on your
              phone — one tap to open, works offline.
            </p>
            {ios || !deferred ? (
              <ol className="mt-3 space-y-1.5 text-xs text-[#0B1220] dark:text-[#F8FAFC]">
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F2F5FC] text-[10px] font-bold text-[#09318D] dark:bg-[#092B7D] dark:text-[#FFA8D7]">
                    1
                  </span>
                  <span>
                    Tap{" "}
                    <Share
                      className="inline h-3.5 w-3.5 align-[-2px]"
                      aria-label="Share"
                    />{" "}
                    Share in Safari&apos;s toolbar
                  </span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F2F5FC] text-[10px] font-bold text-[#09318D] dark:bg-[#092B7D] dark:text-[#FFA8D7]">
                    2
                  </span>
                  <span>Scroll down and tap “Add to Home Screen”</span>
                </li>
                <li className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#F2F5FC] text-[10px] font-bold text-[#09318D] dark:bg-[#092B7D] dark:text-[#FFA8D7]">
                    3
                  </span>
                  <span>Tap “Add” in the top-right corner</span>
                </li>
              </ol>
            ) : (
              <div className="mt-3">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  isLoading={installing}
                  onClick={install}
                >
                  Install Todo Studio
                </Button>
              </div>
            )}
          </div>
          {(ios || !deferred) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={dismiss}
              className="shrink-0"
            >
              Maybe later
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
