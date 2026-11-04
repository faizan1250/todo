"use client";

import * as React from "react";
import { createContext, useContext, useState, useCallback, useId } from "react";
import { CheckCircle2, AlertCircle, Info, X, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ToastOptions {
  title?: string;
  message: string;
  type?: "default" | "success" | "error" | "info";
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

interface ToastItem extends ToastOptions {
  id: string;
}

interface ToastContextType {
  toast: (options: ToastOptions) => void;
  success: (message: string, options?: Partial<ToastOptions>) => void;
  error: (message: string, options?: Partial<ToastOptions>) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    ({
      title,
      message,
      type = "default",
      actionLabel,
      onAction,
      durationMs = 4500,
    }: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      const newToast: ToastItem = {
        id,
        title,
        message,
        type,
        actionLabel,
        onAction,
        durationMs,
      };

      setToasts((prev) => [...prev, newToast]);

      if (durationMs > 0) {
        setTimeout(() => {
          dismiss(id);
        }, durationMs);
      }
    },
    [dismiss]
  );

  const success = useCallback(
    (message: string, options?: Partial<ToastOptions>) => {
      toast({ ...options, message, type: "success" });
    },
    [toast]
  );

  const error = useCallback(
    (message: string, options?: Partial<ToastOptions>) => {
      toast({ ...options, message, type: "error" });
    },
    [toast]
  );

  return (
    <ToastContext.Provider value={{ toast, success, error, dismiss }}>
      {children}
      {/* Toast viewport rendered at bottom right */}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2 sm:bottom-6 sm:right-6 max-w-sm w-full"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            role="status"
            className="pointer-events-auto flex items-center justify-between gap-3 rounded-xl border border-[#E4E8F2] bg-white p-3.5 shadow-lift-blue text-xs transition-all duration-200 animate-in fade-in slide-in-from-bottom-2 dark:border-[#132E74] dark:bg-[#051A4D]"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {item.type === "success" && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              )}
              {item.type === "error" && (
                <AlertCircle className="h-4 w-4 shrink-0 text-rose-500" />
              )}
              {item.type === "default" && (
                <Info className="h-4 w-4 shrink-0 text-[#09318D] dark:text-[#FD91CC]" />
              )}

              <div className="min-w-0">
                {item.title && (
                  <p className="font-bold text-[#0B1220] dark:text-white truncate">
                    {item.title}
                  </p>
                )}
                <p className="text-[#5B6478] dark:text-[#9BB0D3] truncate">
                  {item.message}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {item.actionLabel && item.onAction && (
                <button
                  type="button"
                  onClick={() => {
                    item.onAction?.();
                    dismiss(item.id);
                  }}
                  className="flex items-center gap-1 rounded-md bg-[#FFE8F5] px-2.5 py-1 text-[11px] font-bold text-[#051A4D] hover:bg-[#FFA8D7] transition-colors dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7] cursor-pointer"
                >
                  <Undo2 className="h-3 w-3" />
                  <span>{item.actionLabel}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => dismiss(item.id)}
                aria-label="Dismiss notification"
                className="rounded p-1 text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors dark:text-[#9BB0D3] dark:hover:bg-[#082363]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
