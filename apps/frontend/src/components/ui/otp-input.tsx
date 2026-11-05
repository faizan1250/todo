"use client";

import * as React from "react";
import { OTPInput } from "input-otp";
import { cn } from "@/lib/utils";

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  onComplete?: (value: string) => void;
}

export function OtpInput({
  value,
  onChange,
  length = 6,
  disabled,
  onComplete,
}: OtpInputProps) {
  return (
    <OTPInput
      maxLength={length}
      value={value}
      onChange={(v) => {
        onChange(v);
        if (v.length === length) onComplete?.(v);
      }}
      disabled={disabled}
      containerClassName="flex items-center justify-center gap-2"
      render={({ slots }) => (
        <>
          {slots.map((slot, idx) => (
            <div
              key={idx}
              className={cn(
                "flex h-12 w-10 items-center justify-center rounded-[10px] border border-[var(--border)] bg-[var(--surface)] text-lg font-semibold text-[var(--fg)]",
                slot.isActive && "ring-2 ring-[var(--ring)]",
                slot.char && "border-[var(--primary)]"
              )}
            >
              {slot.char ?? slot.placeholderChar}
            </div>
          ))}
        </>
      )}
    />
  );
}
