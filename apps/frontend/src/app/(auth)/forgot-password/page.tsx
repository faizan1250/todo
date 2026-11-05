"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { copy } from "@/lib/copy";
import { Button, Input } from "@/components/ui";
import { AuthShell } from "@/components/auth/AuthShell";
import { toast } from "sonner";

const schema = z.object({ email: z.string().email() });

export default function ForgotPasswordPage() {
  const [done, setDone] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ email: string }>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: { email: string }) => {
    try {
      await (authClient as unknown as { requestPasswordReset?: (a: unknown) => Promise<unknown> }).requestPasswordReset?.({ email: data.email, redirectTo: "/reset-password" });
    } catch {
      // ignore
    }
    setDone(true);
    toast.success(copy.auth.forgotConfirm);
  };

  return (
    <AuthShell title={copy.auth.forgotTitle} subtitle={copy.auth.forgotSubtitle}>
      {done ? (
        <p className="text-sm text-[var(--fg-muted)]">{copy.auth.forgotConfirm}</p>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
              {copy.auth.emailLabel}
            </label>
            <Input type="email" autoComplete="email" {...register("email")} />
          </div>
          <Button type="submit" className="w-full" isLoading={isSubmitting}>
            {copy.auth.sendLink}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
