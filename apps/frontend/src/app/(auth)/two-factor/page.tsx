"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { copy } from "@/lib/copy";
import { Button } from "@/components/ui";
import { OtpInput } from "@/components/ui/otp-input";
import { AuthShell } from "@/components/auth/AuthShell";
import { toast } from "sonner";

export default function TwoFactorPage() {
  const router = useRouter();
  const [code, setCode] = React.useState("");
  const [useEmergency, setUseEmergency] = React.useState(false);
  const [remember, setRemember] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const verify = async (value: string) => {
    setLoading(true);
    try {
      const res = useEmergency
        ? await authClient.twoFactor.verifyBackupCode({ code: value })
        : await authClient.twoFactor.verifyTotp({ code: value });
      if (res.error) {
        toast.error("That code is not valid.");
        return;
      }
      router.push("/");
    } catch {
      toast.error("That code is not valid.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={copy.auth.twoFactorTitle} subtitle={copy.auth.twoFactorSubtitle}>
      <div className="space-y-4">
        <OtpInput value={code} onChange={setCode} length={6} onComplete={verify} />
        <label className="flex items-center gap-2 text-sm text-[var(--fg-muted)]">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          {copy.auth.rememberDevice}
        </label>
        <Button
          className="w-full"
          isLoading={loading}
          onClick={() => verify(code)}
          disabled={code.length < 6}
        >
          {copy.auth.verifyButton}
        </Button>
        <button
          type="button"
          onClick={() => setUseEmergency((v) => !v)}
          className="text-sm text-[var(--primary)] hover:underline"
        >
          {copy.auth.useEmergency}
        </button>
      </div>
    </AuthShell>
  );
}
