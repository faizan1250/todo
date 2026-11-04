"use client";

import * as React from "react";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an unhandled error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="flex min-h-[400px] w-full flex-col items-center justify-center p-6 text-center"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-rose-200 bg-rose-50 text-rose-600 shadow-2xs dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-400">
            <AlertTriangle className="h-7 w-7" />
          </div>

          <h2 className="mt-4 text-lg font-bold tracking-tight text-[#0B1220] dark:text-white">
            {this.props.fallbackTitle || "Something went wrong in this view"}
          </h2>

          <p className="mt-1.5 max-w-md text-xs text-[#5B6478] dark:text-[#9BB0D3]">
            {this.state.error?.message ||
              "An unexpected client-side error occurred. Your workspace data remains intact."}
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={this.handleReset}
              className="gap-2"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Try Again</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (typeof window !== "undefined") {
                  window.location.reload();
                }
              }}
              className="gap-2"
            >
              <Home className="h-3.5 w-3.5" />
              <span>Reload Page</span>
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
