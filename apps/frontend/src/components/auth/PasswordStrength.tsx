"use client";

import * as React from "react";

function score(pw: string): number {
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return Math.min(s, 4);
}

const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];

export function PasswordStrength({ password }: { password: string }) {
  const s = score(password);
  return (
    <div className="mt-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${
              i < s ? "bg-[var(--primary)]" : "bg-[var(--border)]"
            }`}
          />
        ))}
      </div>
      <p className="mt-1 text-xs text-[var(--fg-muted)]">{labels[s]}</p>
    </div>
  );
}
