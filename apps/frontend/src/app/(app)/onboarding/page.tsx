"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/components/auth/auth-provider";
import { updateCurrentProfile } from "@/lib/api";
import { copy } from "@/lib/copy";
import { Button, Input } from "@/components/ui";
import { toast } from "sonner";

const schema = z.object({
  name: z.string().min(1),
  timezone: z.string().min(1),
  theme: z.enum(["light", "dark", "system"]),
});

type Form = z.infer<typeof schema>;

export default function OnboardingPage() {
  const router = useRouter();
  const { profile, user, setProfile, updatePreferences } = useAuth();
  const [step, setStep] = React.useState(0);

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: profile?.name || user?.name || "",
      timezone: profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      theme: (profile?.preferences?.theme as "light" | "dark" | "system") || "system",
    },
  });

  const finish = async (data: Form) => {
    try {
      const updated = await updateCurrentProfile({
        name: data.name.trim(),
        timezone: data.timezone.trim(),
        preferences: { ...(profile?.preferences || {}), theme: data.theme },
      });
      setProfile(updated);
      // apply theme
      if (data.theme === "dark") {
        document.documentElement.classList.add("dark");
        localStorage.setItem("theme", "dark");
      } else if (data.theme === "light") {
        document.documentElement.classList.remove("dark");
        localStorage.setItem("theme", "light");
      } else {
        localStorage.removeItem("theme");
      }
      void updatePreferences({ theme: data.theme });
      toast.success(copy.onboarding.finishButton);
    } catch {
      toast.error("Could not save. Try again.");
    }
    // create example task in inbox (best effort)
    try {
      const { getLists, createTask } = await import("@/lib/api");
      const lists = await getLists();
      const inbox = lists.find((l) => l.isInbox) || lists[0];
      if (inbox) {
        await createTask({ title: "Welcome task: try completing me", listId: inbox.id });
      }
    } catch {
      // ignore
    }
    router.push("/");
  };

  const skip = () => {
    if (step < 2) setStep(step + 1);
    else router.push("/");
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{copy.onboarding.welcomeTitle}</h1>
          <p className="text-sm text-[var(--fg-muted)]">{copy.onboarding.welcomeSubtitle}</p>
        </div>
        <div className="text-xs text-[var(--fg-muted)]">
          Step {step + 1} of 3
        </div>

        {step === 0 && (
          <form
            onSubmit={form.handleSubmit(() => setStep(1))}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1.5">{copy.onboarding.displayNameLabel}</label>
              <Input {...form.register("name")} aria-invalid={!!form.formState.errors.name} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">{copy.onboarding.timezoneLabel}</label>
              <Input {...form.register("timezone")} />
            </div>
            <div className="flex gap-2">
              <Button type="submit">{copy.onboarding.continueButton}</Button>
              <Button type="button" variant="outline" onClick={skip}>{copy.onboarding.skipButton}</Button>
            </div>
          </form>
        )}

        {step === 1 && (
          <form
            onSubmit={form.handleSubmit(() => setStep(2))}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium mb-1.5">{copy.onboarding.themeLabel}</label>
              <select
                {...form.register("theme")}
                className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
              >
                <option value="light">{copy.account.themeLight}</option>
                <option value="dark">{copy.account.themeDark}</option>
                <option value="system">{copy.account.themeAuto}</option>
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit">{copy.onboarding.continueButton}</Button>
              <Button type="button" variant="outline" onClick={skip}>{copy.onboarding.skipButton}</Button>
            </div>
          </form>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm">{copy.onboarding.stepDone}</p>
            <div className="flex gap-2">
              <Button onClick={form.handleSubmit(finish)}>{copy.onboarding.finishButton}</Button>
              <Button type="button" variant="outline" onClick={skip}>{copy.onboarding.skipButton}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}