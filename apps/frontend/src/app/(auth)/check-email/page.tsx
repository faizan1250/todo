"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { OpenMailButton } from "@/components/auth/OpenMailButton";
import { Button } from "@/components/ui";
import { copy } from "@/lib/copy";
import { toast } from "sonner";

function CheckEmailInner() {
  const params = useSearchParams();
  const email = params.get("email") ?? "";
  const [cooldown, setCooldown] = React.useState(0);

  React.useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const resend = () => {
    if (cooldown > 0) return;
    setCooldown(30);
    toast.success("Sent again.");
  };

  return (
    <AuthShell title={copy.auth.checkEmailTitle} subtitle={`${copy.auth.checkEmailSubtitle} ${email}`}>
      <OpenMailButton email={email} />
      <p className="mt-4 text-sm text-[var(--fg-muted)]">{copy.auth.didntGetIt}</p>
      <div className="mt-4 flex gap-3">
        <Button
          variant="outline"
          onClick={resend}
          disabled={cooldown > 0}
        >
          {cooldown > 0 ? `${copy.auth.resendCooldown} ${cooldown}s` : copy.auth.resend}
        </Button>
        <a href="/sign-up" className="text-sm text-[var(--primary)] hover:underline self-center">
          {copy.auth.wrongEmail}
        </a>
      </div>
    </AuthShell>
  );
}

export default function CheckEmailPage() {
  return (
    <Suspense fallback={null}>
      <CheckEmailInner />
    </Suspense>
  );
}
