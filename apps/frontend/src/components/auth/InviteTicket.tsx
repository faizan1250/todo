"use client";

import * as React from "react";
import { Input } from "@/components/ui";

export interface InviteTicketProps {
  value: string;
  onChange: (v: string) => void;
  status?: "idle" | "checking" | "valid" | "invalid";
  disabled?: boolean;
}

export function InviteTicket({ value, onChange, status, disabled }: InviteTicketProps) {
  const border =
    status === "valid"
      ? "border-[var(--success)]"
      : status === "invalid"
      ? "border-[var(--danger)]"
      : "border-[var(--border)]";

  return (
    <div className={`rounded-xl border-2 border-dashed ${border} p-4 bg-[var(--bg-soft)]`}>
      <label className="block text-xs font-medium text-[var(--fg-muted)] mb-2">
        Invite code
      </label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        disabled={disabled}
        autoComplete="off"
        placeholder="ABC123"
        className="text-center font-mono text-lg tracking-widest bg-transparent border-0 focus:ring-0"
      />
      {status === "checking" && (
        <p className="mt-2 text-xs text-[var(--fg-muted)]">Checking...</p>
      )}
      {status === "valid" && (
        <p className="mt-2 text-xs text-[var(--success)]">Looks good.</p>
      )}
      {status === "invalid" && (
        <p className="mt-2 text-xs text-[var(--danger)]">That code is not valid.</p>
      )}
    </div>
  );
}
