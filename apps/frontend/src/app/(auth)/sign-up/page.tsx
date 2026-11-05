"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { copy } from "@/lib/copy";
import { Button, Input, PasswordInput } from "@/components/ui";
import { AuthShell } from "@/components/auth/AuthShell";
import { SocialButtons } from "@/components/auth/SocialButtons";
import { PasswordStrength } from "@/components/auth/PasswordStrength";
import { InviteTicket } from "@/components/auth/InviteTicket";
import { useInviteValidator } from "@/hooks/use-invite-validator";
import { toast } from "sonner";

const schema = z
  .object({
    code: z.string().min(1),
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),
  });

type Form = z.infer<typeof schema>;

function SignUpInner() {
  const router = useRouter();
  const params = useSearchParams();
  const codeParam = params.get("code") ?? "";
  const invite = useInviteValidator({ initialCode: codeParam, autoValidate: true });

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { code: codeParam },
  });

  const password = watch("password") ?? "";

  React.useEffect(() => {
    setValue("code", invite.code);
  }, [invite.code, setValue]);

  const onSubmit = async (data: Form) => {
    try {
      const res = await authClient.signUp.email({
        name: data.name.trim(),
        email: data.email.trim(),
        password: data.password,
        // @ts-expect-error extra field
        inviteCode: data.code,
      });
      if (res.error) {
        toast.error(res.error.message || copy.auth.emailInUse);
        return;
      }
      router.push(`/check-email?email=${encodeURIComponent(data.email)}`);
    } catch {
      toast.error(copy.auth.emailInUse);
    }
  };

  return (
    <AuthShell title={copy.auth.signUpTitle} subtitle={copy.auth.signUpSubtitle}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <InviteTicket
          value={invite.code}
          onChange={invite.setCode}
          status={invite.status}
        />
        <div>
          <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
            Name
          </label>
          <Input autoComplete="name" {...register("name")} aria-invalid={!!errors.name} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
            {copy.auth.emailLabel}
          </label>
          <Input type="email" autoComplete="email" {...register("email")} aria-invalid={!!errors.email} />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
            {copy.auth.passwordLabel}
          </label>
          <PasswordInput autoComplete="new-password" {...register("password")} aria-invalid={!!errors.password} />
          <PasswordStrength password={password} />
        </div>
        <Button type="submit" className="w-full" isLoading={isSubmitting} disabled={!invite.isValid && invite.code.length > 0}>
          {copy.auth.signUpButton}
        </Button>
      </form>
      <div className="mt-6">
        <SocialButtons callbackURL="/" />
      </div>
      <p className="mt-6 text-center text-sm text-[var(--fg-muted)]">
        {copy.auth.switchToSignIn}{" "}
        <a href="/sign-in" className="text-[var(--primary)] hover:underline">
          {copy.auth.signInButton}
        </a>
      </p>
    </AuthShell>
  );
}

export default function SignUpPage() {
  return (
    <Suspense fallback={null}>
      <SignUpInner />
    </Suspense>
  );
}
