"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/AuthShell";
import { copy } from "@/lib/copy";

function VerifyEmailInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";

  React.useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        if (token) {
          await (authClient as unknown as { verifyEmail?: (a: unknown) => Promise<unknown> }).verifyEmail?.({ query: { token } });
        }
      } catch {
        // ignore
      }
      if (!cancelled) {
        setTimeout(() => router.push("/"), 1500);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [token, router]);

  return (
    <AuthShell title={copy.auth.verifyTitle} subtitle={copy.auth.verifySubtitle}>
      <div className="flex items-center justify-center py-8">
        <div className="h-12 w-12 rounded-full bg-[var(--success)]/20 flex items-center justify-center">
          <span className="text-[var(--success)] text-2xl">✓</span>
        </div>
      </div>
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
