"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { validateInviteCode, type InviteValidationResponse } from "@/lib/api";

export type InviteStatus = "idle" | "checking" | "valid" | "invalid";

export interface UseInviteValidatorOptions {
  debounceMs?: number;
  initialCode?: string;
  autoValidate?: boolean;
}

export interface UseInviteValidatorReturn {
  code: string;
  setCode: (code: string) => void;
  status: InviteStatus;
  isValid: boolean;
  validationResult: InviteValidationResponse | null;
  errorMessage: string | null;
  validate: (overrideCode?: string) => Promise<InviteValidationResponse>;
  reset: () => void;
}

export function useInviteValidator(
  options: UseInviteValidatorOptions = {}
): UseInviteValidatorReturn {
  const { debounceMs = 500, initialCode = "", autoValidate = true } = options;

  const [code, setCode] = useState(initialCode);
  const [status, setStatus] = useState<InviteStatus>("idle");
  const [validationResult, setValidationResult] =
    useState<InviteValidationResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const activeRequestId = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runValidation = useCallback(
    async (codeToValidate: string): Promise<InviteValidationResponse> => {
      const trimmed = codeToValidate.trim();
      const requestId = ++activeRequestId.current;

      if (!trimmed) {
        setStatus("idle");
        setValidationResult(null);
        setErrorMessage(null);
        return {
          valid: false,
          reason: "Invite code is required",
          remainingUses: 0,
        };
      }

      setStatus("checking");
      setErrorMessage(null);

      try {
        const result = await validateInviteCode(trimmed);

        // Guard against race conditions if user typed again
        if (requestId !== activeRequestId.current) {
          return result;
        }

        setValidationResult(result);
        if (result.valid) {
          setStatus("valid");
          setErrorMessage(null);
        } else {
          setStatus("invalid");
          setErrorMessage(result.reason || "Invalid invite code");
        }
        return result;
      } catch (err) {
        if (requestId !== activeRequestId.current) {
          return {
            valid: false,
            reason: "Request superseded",
            remainingUses: 0,
          };
        }
        const msg =
          err instanceof Error ? err.message : "Failed to validate invite code";
        setStatus("invalid");
        setErrorMessage(msg);
        const fallback = {
          valid: false,
          reason: msg,
          remainingUses: 0,
        };
        setValidationResult(fallback);
        return fallback;
      }
    },
    []
  );

  useEffect(() => {
    if (!autoValidate) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    const trimmed = code.trim();
    if (!trimmed) {
      setStatus("idle");
      setValidationResult(null);
      setErrorMessage(null);
      return;
    }

    timerRef.current = setTimeout(() => {
      runValidation(trimmed);
    }, debounceMs);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [code, debounceMs, autoValidate, runValidation]);

  const validate = useCallback(
    async (overrideCode?: string) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      return runValidation(overrideCode !== undefined ? overrideCode : code);
    },
    [code, runValidation]
  );

  const reset = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    activeRequestId.current++;
    setCode("");
    setStatus("idle");
    setValidationResult(null);
    setErrorMessage(null);
  }, []);

  return {
    code,
    setCode,
    status,
    isValid: status === "valid",
    validationResult,
    errorMessage,
    validate,
    reset,
  };
}
