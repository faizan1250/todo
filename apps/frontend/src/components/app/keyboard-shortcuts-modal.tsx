import * as React from "react";
import { useEffect, useRef } from "react";
import { X, Keyboard, Command, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ShortcutItem {
  keys: string[];
  description: string;
  category: "Navigation" | "Task Actions" | "General";
}

export const SHORTCUTS_DATA: ShortcutItem[] = [
  // Navigation
  { keys: ["J", "↓"], description: "Navigate to next task", category: "Navigation" },
  { keys: ["K", "↑"], description: "Navigate to previous task", category: "Navigation" },
  { keys: ["⌘K", "/"], description: "Open Command Palette", category: "Navigation" },
  { keys: ["Esc"], description: "Close modal, drawer, or deselect", category: "Navigation" },

  // Task Actions
  { keys: ["N"], description: "Quick focus task creation input", category: "Task Actions" },
  { keys: ["Space", "X"], description: "Toggle complete on selected task", category: "Task Actions" },
  { keys: ["D", "⌫"], description: "Delete selected task (with undo toast)", category: "Task Actions" },
  { keys: ["Enter"], description: "Expand selected task detail", category: "Task Actions" },

  // General
  { keys: ["?", "Shift+/"], description: "Open keyboard shortcuts cheat sheet", category: "General" },
  { keys: ["Esc"], description: "Dismiss open dialogs or panels", category: "General" },
];

export interface KeyboardShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsModal({
  isOpen,
  onClose,
}: KeyboardShortcutsModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const timeout = setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 50);

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeout);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const categories: ("Navigation" | "Task Actions" | "General")[] = [
    "Navigation",
    "Task Actions",
    "General",
  ];

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
        aria-labelledby="shortcuts-modal-title"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white text-[#0B1220] shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC] animate-in fade-in-50 zoom-in-95 duration-150"
      >
        {/* Header */}
        <div className="relative border-b border-[#E4E8F2]/80 bg-white/60 px-6 py-5 dark:border-[#132E74]/80 dark:bg-[#082363]/60 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#09318D] text-white shadow-sm dark:bg-[#0D41B4]">
              <Keyboard className="h-4 w-4 text-[#FD91CC]" />
            </div>
            <div>
              <h2
                id="shortcuts-modal-title"
                className="text-lg font-bold tracking-tight text-[#0B1220] dark:text-white"
              >
                Keyboard Shortcuts
              </h2>
              <p className="text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                Navigate and orchestrate your workspace at the speed of thought.
              </p>
            </div>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts dialog"
            className="focus-ring-pink inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6478] transition-colors hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#092B7D] dark:hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="max-h-[65vh] overflow-y-auto p-6 space-y-6">
          {categories.map((category) => {
            const items = SHORTCUTS_DATA.filter((s) => s.category === category);
            if (items.length === 0) return null;

            return (
              <div key={category} className="space-y-2.5">
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
                  {category}
                </h3>

                <div className="rounded-xl border border-[#E4E8F2] bg-[#F2F5FC]/50 divide-y divide-[#E4E8F2]/70 dark:border-[#132E74] dark:bg-[#061B4A]/60 dark:divide-[#132E74]/70">
                  {items.map((item, idx) => (
                    <div
                      key={`${category}-${idx}`}
                      className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                    >
                      <span className="text-[#0B1220] dark:text-[#F8FAFC] font-medium">
                        {item.description}
                      </span>

                      <div className="flex items-center gap-1.5 shrink-0 ml-3">
                        {item.keys.map((k) => (
                          <kbd
                            key={k}
                            className={cn(
                              "inline-flex h-6 min-w-6 items-center justify-center rounded-md border px-1.5 font-mono text-[11px] font-semibold shadow-2xs select-none",
                              "border-[#D1DCF0] bg-white text-[#09318D] dark:border-[#16367F] dark:bg-[#082363] dark:text-[#FFA8D7]"
                            )}
                          >
                            {k}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Note */}
        <div className="border-t border-[#E4E8F2] bg-[#F2F5FC]/80 px-6 py-3 flex items-center justify-between text-xs text-[#5B6478] dark:border-[#132E74] dark:bg-[#061D52] dark:text-[#9BB0D3]">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[#FD91CC]" />
            <span>Press <kbd className="font-mono font-bold text-[#09318D] dark:text-white">?</kbd> anywhere to open</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="font-medium text-[#09318D] hover:underline dark:text-[#FFA8D7] cursor-pointer"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
