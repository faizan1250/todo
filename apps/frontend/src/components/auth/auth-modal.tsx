"use client";

import * as React from "react";
import { useState, useEffect, useRef } from "react";
import { authClient } from "@/lib/auth-client";
import { Button, Input } from "@/components/ui";
import { AlertCircleIcon, SparklesIcon } from "@/components/icons";
import { Lock, Mail, User, ShieldCheck, X } from "lucide-react";

export type AuthMode = "sign-in" | "sign-up" | "2fa";

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultMode?: "sign-in" | "sign-up";
  onSuccess?: () => void;
}

interface AuthModalDialogProps {
  onClose: () => void;
  defaultMode: "sign-in" | "sign-up";
  onSuccess?: () => void;
}

function AuthModalDialog({
  onClose,
  defaultMode,
  onSuccess,
}: AuthModalDialogProps) {
  const [mode, setMode] = useState<AuthMode>(defaultMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");

  const [isLoading, setIsLoading] = useState(false);
  const [generalError, setGeneralError] = useState<string | null>(null);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);

  // Focus trap & Escape key listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    // Autofocus first input after mount
    const timeout = setTimeout(() => {
      firstInputRef.current?.focus();
    }, 50);

    // Prevent background scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearTimeout(timeout);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setIsLoading(true);

    try {
      const res = await authClient.signIn.email({
        email: email.trim(),
        password,
      });

      if (res.error) {
        setGeneralError(res.error.message || "Invalid email or password.");
        setIsLoading(false);
        return;
      }

      // Check if 2FA redirect is requested by Better Auth
      const dataAny = res.data as { twoFactorRedirect?: boolean } | undefined;
      if (dataAny?.twoFactorRedirect) {
        setMode("2fa");
        setIsLoading(false);
        return;
      }

      // Successfully authenticated
      setIsLoading(false);
      onSuccess?.();
      onClose();
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : "An unexpected sign in error occurred."
      );
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    setIsLoading(true);

    try {
      // Call Better Auth signUp with open registration (name, email, password)
      const res = await authClient.signUp.email({
        name: name.trim(),
        email: email.trim(),
        password,
      });

      if (res.error) {
        setGeneralError(res.error.message || "Failed to create account.");
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      onSuccess?.();
      onClose();
    } catch (err) {
      setGeneralError(
        err instanceof Error
          ? err.message
          : "An unexpected error occurred during sign up."
      );
      setIsLoading(false);
    }
  };

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);
    const trimmed = totpCode.trim();

    if (!trimmed || trimmed.length < 6) {
      setGeneralError("Please enter a valid 6-digit TOTP code.");
      return;
    }

    setIsLoading(true);

    try {
      const res = await authClient.twoFactor.verifyTotp({
        code: trimmed,
      });

      if (res.error) {
        setGeneralError(
          res.error.message || "Invalid TOTP code. Please try again."
        );
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      onSuccess?.();
      onClose();
    } catch (err) {
      setGeneralError(
        err instanceof Error ? err.message : "Failed to verify 2FA code."
      );
      setIsLoading(false);
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
        ref={modalContainerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[#E4E8F2] bg-white text-[#0B1220] shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363] dark:text-[#F8FAFC]"
      >
        {/* Modal Header */}
        <div className="relative border-b border-[#E4E8F2]/80 bg-white/50 px-6 py-5 dark:border-[#132E74]/80 dark:bg-[#082363]/50">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="focus-ring-pink absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#5B6478] transition-colors hover:bg-[#F2F5FC] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:bg-[#092B7D] dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#09318D] text-white shadow-2xs">
              <SparklesIcon className="h-4 w-4 text-[#FD91CC]" />
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[#09318D] dark:text-[#9BB0D3]">
              Todo Studio Auth
            </span>
          </div>

          <h2
            id="auth-modal-title"
            className="mt-2 text-xl font-bold tracking-tight text-[#0B1220] dark:text-white"
          >
            {mode === "sign-in" && "Sign in to workspace"}
            {mode === "sign-up" && "Create your account"}
            {mode === "2fa" && "Two-Factor Verification"}
          </h2>
          <p className="mt-0.5 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
            {mode === "sign-in" &&
              "Access your orchestrated sprints, tasks, and team milestones."}
            {mode === "sign-up" &&
              "Create your account to unlock your workspace immediately."}
            {mode === "2fa" &&
              "Provide the 6-digit TOTP code from your mobile authenticator app."}
          </p>

          {/* Mode Switcher Pills (only when not in 2FA) */}
          {mode !== "2fa" && (
            <div className="mt-4 flex rounded-lg border border-[#E4E8F2] bg-[#F2F5FC] p-1 dark:border-[#132E74] dark:bg-[#061B4A]">
              <button
                type="button"
                onClick={() => {
                  setMode("sign-in");
                  setGeneralError(null);
                }}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                  mode === "sign-in"
                    ? "btn-primary-depth text-white shadow-xs"
                    : "text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("sign-up");
                  setGeneralError(null);
                }}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-all ${
                  mode === "sign-up"
                    ? "btn-primary-depth text-white shadow-xs"
                    : "text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
                }`}
              >
                Sign Up
              </button>
            </div>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-6">
          {/* General Error Banner */}
          {generalError && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200"
            >
              <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              <span>{generalError}</span>
            </div>
          )}

          {/* SIGN IN FORM */}
          {mode === "sign-in" && (
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label
                  htmlFor="signin-email"
                  className="mb-1.5 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
                >
                  Email address
                </label>
                <div className="relative">
                  <Input
                    ref={firstInputRef}
                    id="signin-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="faizan@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                  />
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signin-password"
                  className="mb-1.5 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
                >
                  Password
                </label>
                <div className="relative">
                  <Input
                    id="signin-password"
                    type="password"
                    name="password"
                    autoComplete="current-password"
                    required
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                  />
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading}
                className="w-full text-sm font-semibold"
              >
                Sign In
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-up");
                    setGeneralError(null);
                  }}
                  className="focus-ring-pink text-xs text-[#09318D] underline-offset-4 hover:underline dark:text-[#FFA8D7]"
                >
                  Don&apos;t have an account? Create an account →
                </button>
              </div>
            </form>
          )}

          {/* SIGN UP FORM */}
          {mode === "sign-up" && (
            <form onSubmit={handleSignUp} className="space-y-3.5">
              <div>
                <label
                  htmlFor="signup-name"
                  className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
                >
                  Full name
                </label>
                <div className="relative">
                  <Input
                    ref={firstInputRef}
                    id="signup-name"
                    type="text"
                    name="name"
                    autoComplete="name"
                    required
                    placeholder="Faizan Khan"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="pl-9"
                  />
                  <User className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-email"
                  className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
                >
                  Email address
                </label>
                <div className="relative">
                  <Input
                    id="signup-email"
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    placeholder="faizan@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9"
                  />
                  <Mail className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
                </div>
              </div>

              <div>
                <label
                  htmlFor="signup-password"
                  className="mb-1 block text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
                >
                  Password (8+ characters)
                </label>
                <div className="relative">
                  <Input
                    id="signup-password"
                    type="password"
                    name="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-9"
                  />
                  <Lock className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[#5B6478] dark:text-[#9BB0D3]" />
                </div>
              </div>

              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading}
                className="w-full text-sm font-semibold"
              >
                Create Account
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-in");
                    setGeneralError(null);
                  }}
                  className="focus-ring-pink text-xs text-[#09318D] underline-offset-4 hover:underline dark:text-[#FFA8D7]"
                >
                  Already have an account? Sign in →
                </button>
              </div>
            </form>
          )}

          {/* TWO FACTOR TOTP VERIFICATION */}
          {mode === "2fa" && (
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div className="rounded-xl border border-[#D5E1F7] bg-[#F2F5FC] p-4 text-center dark:border-[#173F94] dark:bg-[#092B7D]/40">
                <ShieldCheck className="mx-auto h-8 w-8 text-[#09318D] dark:text-[#FD91CC]" />
                <p className="mt-2 text-xs text-[#5B6478] dark:text-[#9BB0D3]">
                  Enter the 6-digit code displayed in your authenticator app
                  (Google Authenticator, 1Password, etc.)
                </p>
              </div>

              <div>
                <label
                  htmlFor="totp-code"
                  className="mb-1.5 block text-center text-xs font-medium text-[#0B1220] dark:text-[#F8FAFC]"
                >
                  6-Digit Verification Code
                </label>
                <Input
                  ref={firstInputRef}
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  placeholder="000000"
                  value={totpCode}
                  onChange={(e) =>
                    setTotpCode(e.target.value.replace(/\D/g, ""))
                  }
                  className="text-center font-mono text-xl tracking-widest"
                />
              </div>

              <Button
                type="submit"
                variant="primary"
                isLoading={isLoading}
                className="w-full text-sm font-semibold"
              >
                Verify & Continue
              </Button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setMode("sign-in");
                    setGeneralError(null);
                    setTotpCode("");
                  }}
                  className="focus-ring-pink text-xs text-[#5B6478] hover:text-[#0B1220] dark:text-[#9BB0D3] dark:hover:text-white"
                >
                  ← Back to Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export function AuthModal({
  isOpen,
  onClose,
  defaultMode = "sign-in",
  onSuccess,
}: AuthModalProps) {
  if (!isOpen) return null;

  return (
    <AuthModalDialog
      onClose={onClose}
      defaultMode={defaultMode}
      onSuccess={onSuccess}
    />
  );
}
