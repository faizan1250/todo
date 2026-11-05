"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { copy } from "@/lib/copy";
import { Button, PasswordInput } from "@/components/ui";
import { AuthShell } from "@/components/auth/AuthShell";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { toast } from "sonner";

const schema = z.object({ password: z.string().min(8), confirm: z.string().min(8) }).refine((d) => d.password === d.confirm, {
  message: "Passwords do not match",
  path: ["confirm"],
});

function ResetPasswordInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [expired, setExpired] = React.useState(false);
  const {
    register,
    handleSubmit,
    watch,
    formState: { isSubmitting },
  } = useForm<{ password: string; confirm: string }>({ resolver: zodResolver(schema) });

  const password = watch("password") ?? "";

  const onSubmit = async (data: { password: string }) => {
    try {
      const res = await authClient.resetPassword({
        newPassword: data.password,
        token,
      });
      if (res.error) {
        setExpired(true);
        toast.error(copy.auth.resetExpired);
        return;
      }
      toast.success(copy.auth.resetSuccess);
      router.push("/sign-in");
    } catch {
      setExpired(true);
      toast.error(copy.auth.resetExpired);
    }
  };

  if (!token) {
    return (
      <AuthShell title={copy.auth.resetTitle}>
        <p className="text-sm text-[var(--fg-muted)]">{copy.auth.resetExpired}</p>
        <a href="/forgot-password" className="text-sm text-[var(--primary)] hover:underline">
          {copy.auth.resetExpired}
        </a>
      </AuthShell>
    );
  }

  if (expired) {
    return (
      <AuthShell title={copy.auth.resetTitle}>
        <p className="text-sm text-[var(--fg-muted)]">{copy.auth.resetExpired}</p>
        <a href="/forgot-password" className="text-sm text-[var(--primary)] hover:underline">
          Send me a new one
        </a>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={copy.auth.resetTitle}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
            {copy.auth.passwordLabel}
          </label>
          <PasswordInput autoComplete="new-password" {...register("password")} />
          <PasswordStrength password={password} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
            {copy.auth.confirmPasswordLabel}
          </label>
          <PasswordInput autoComplete="new-password" {...register("confirm")} />
        </div>
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          {copy.auth.resetSuccess.split(".")[0]}
        </Button>
      </form>
    </AuthShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
