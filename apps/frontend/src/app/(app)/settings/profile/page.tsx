"use client";

import * as React from "react";
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
  locale: z.string().min(2),
  weekStartsOn: z.number(),
  theme: z.enum(["light", "dark", "system"]),
});

type Form = z.infer<typeof schema>;

const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : ["UTC"];

export default function ProfileSettingsPage() {
  const { profile, user, setProfile } = useAuth();
  const [tzQuery, setTzQuery] = React.useState("");

  const form = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: profile?.name || user?.name || "",
      timezone: profile?.timezone || "UTC",
      locale: profile?.locale || "en-US",
      weekStartsOn: profile?.weekStartsOn ?? 1,
      theme: (profile?.preferences?.theme as "light" | "dark" | "system") || "system",
    },
  });

  React.useEffect(() => {
    if (profile) {
      form.reset({
        name: profile.name,
        timezone: profile.timezone,
        locale: profile.locale,
        weekStartsOn: profile.weekStartsOn,
        theme: (profile.preferences?.theme as "light" | "dark" | "system") || "system",
      });
    }
  }, [profile, form]);

  const initials = (form.watch("name") || user?.name || "?")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const filteredTz = TIMEZONES.filter((t) =>
    t.toLowerCase().includes(tzQuery.toLowerCase())
  ).slice(0, 20);

  const onSubmit = async (data: Form) => {
    try {
      const updated = await updateCurrentProfile({
        name: data.name.trim(),
        timezone: data.timezone.trim(),
        locale: data.locale.trim(),
        weekStartsOn: Number(data.weekStartsOn),
        preferences: { ...(profile?.preferences || {}), theme: data.theme },
      });
      setProfile(updated);
      toast.success(copy.account.saved);
    } catch {
      toast.error("Could not save. Try again.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">{copy.account.profileSection}</h1>
      <div className="flex items-center gap-4">
        <div className="h-14 w-14 rounded-full bg-[var(--primary)] text-white flex items-center justify-center font-semibold">
          {initials}
        </div>
        <div className="text-sm text-[var(--fg-muted)]">{user?.email}</div>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">{copy.account.nameLabel}</label>
          <Input {...form.register("name")} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{copy.account.timezoneLabel}</label>
          <Input
            value={tzQuery}
            onChange={(e) => setTzQuery(e.target.value)}
            placeholder="Search time zone"
          />
          <select
            {...form.register("timezone")}
            className="mt-2 w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            size={6}
          >
            {(tzQuery ? filteredTz : [form.getValues("timezone")]).map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{copy.account.localeLabel}</label>
          <Input {...form.register("locale")} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Week starts on</label>
          <select {...form.register("weekStartsOn")} className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <option value={1}>Monday</option>
            <option value={0}>Sunday</option>
            <option value={6}>Saturday</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">{copy.account.themeLabel}</label>
          <select {...form.register("theme")} className="w-full rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            <option value="light">{copy.account.themeLight}</option>
            <option value="dark">{copy.account.themeDark}</option>
            <option value="system">{copy.account.themeAuto}</option>
          </select>
        </div>
        <Button type="submit" isLoading={form.formState.isSubmitting}>
          {copy.account.saveButton}
        </Button>
      </form>
    </div>
  );
}