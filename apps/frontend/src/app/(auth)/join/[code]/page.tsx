"use client";

import * as React from "react";
import { Suspense } from "react";
import { useParams, useRouter } from "next/navigation";
import { useInviteValidator } from "@/hooks/use-invite-validator";
import { AuthShell } from "@/components/auth/AuthShell";
import { InviteTicket } from "@/components/auth/InviteTicket";
import { Button } from "@/components/ui";
import { copy } from "@/lib/copy";

function JoinInner() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = decodeURIComponent(params.code ?? "");
  const invite = useInviteValidator({ initialCode: code, autoValidate: true });

  React.useEffect(() => {
    if (invite.isValid) {
      const t = setTimeout(() => {
        router.push(`/sign-up?code=${encodeURIComponent(invite.code)}`);
      }, 600);
      return () => clearTimeout(t);
    }
  }, [invite.isValid, invite.code, router]);

  return (
    <AuthShell title="You are invited" subtitle={copy.auth.inviteCodeHint}>
      <InviteTicket value={invite.code} onChange={invite.setCode} status={invite.status} />
      {invite.isValid && (
        <p className="mt-4 text-sm text-[var(--success)]">Opening sign-up...</p>
      )}
      {!invite.isValid && invite.code && (
        <div className="mt-4">
          <Button variant="outline" onClick={() => router.push("/sign-up")}>
            Continue to sign-up
          </Button>
        </div>
      )}
    </AuthShell>
  );
}

export default function JoinPage() {
  return (
    <Suspense fallback={null}>
      <JoinInner />
    </Suspense>
  );
}
