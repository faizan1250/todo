"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { authClient } from "@/lib/auth-client";
import { copy } from "@/lib/copy";
import { Button, Input, PasswordInput } from "@/components/ui";
import { AuthShell } from "@/components/auth/AuthShell";
import { SocialButtons } from "@/components/auth/SocialButtons";
import { toast } from "sonner";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

type Form = z.infer<typeof schema>;

export default function SignInPage() {
  const router = useRouter();
  const [caps, setCaps] = React.useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Form>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: Form) => {
    try {
      const res = await authClient.signIn.email({
        email: data.email.trim(),
        password: data.password,
      });
      if (res.error) {
        toast.error(copy.auth.invalidCredentials);
        return;
      }
      const twoFactor = (res.data as { twoFactorRedirect?: boolean })?.twoFactorRedirect;
      if (twoFactor) {
        router.push("/two-factor");
        return;
      }
      router.push("/");
    } catch {
      toast.error(copy.auth.invalidCredentials);
    }
  };

  const magicLink = async (email: string) => {
    try {
      // @ts-expect-error optional plugin
      await authClient.signIn.magicLink?.({ email, callbackURL: "/" });
      toast.success("Check your email for a sign-in link.");
    } catch {
      toast.error("That is not available yet.");
    }
  };

  return (
    <AuthShell title={copy.auth.signInTitle} subtitle={copy.auth.signInSubtitle}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
            {copy.auth.emailLabel}
          </label>
          <Input
            type="email"
            autoComplete="email"
            {...register("email")}
            aria-invalid={!!errors.email}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[var(--fg)] mb-1.5">
            {copy.auth.passwordLabel}
          </label>
          <PasswordInput
            autoComplete="current-password"
            onKeyUp={(e) => setCaps(e.getModifierState?.("CapsLock") ?? false)}
            {...register("password")}
            aria-invalid={!!errors.password}
          />
          {caps && <p className="mt-1 text-xs text-[var(--warning)]">{copy.auth.capsLock}</p>}
        </div>
        <Button type="submit" className="w-full" isLoading={isSubmitting}>
          {copy.auth.signInButton}
        </Button>
        <div className="text-center">
          <button
            type="button"
            onClick={() => {
              const email = (document.querySelector('input[name="email"]') as HTMLInputElement)?.value;
              if (email) magicLink(email);
            }}
            className="text-sm text-[var(--primary)] hover:underline"
          >
            {copy.auth.magicLink}
          </button>
        </div>
        <div className="text-center">
          <a href="/forgot-password" className="text-sm text-[var(--fg-muted)] hover:underline">
            {copy.auth.forgotPassword}
          </a>
        </div>
      </form>
      <div className="mt-6">
        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--border)]" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-[var(--bg)] px-2 text-[var(--fg-muted)]">or</span>
          </div>
        </div>
        <SocialButtons />
      </div>
      <p className="mt-6 text-center text-sm text-[var(--fg-muted)]">
        {copy.auth.switchToSignUp}{" "}
        <a href="/sign-up" className="text-[var(--primary)] hover:underline">
          {copy.auth.signUpButton}
        </a>
      </p>
    </AuthShell>
  );
}
