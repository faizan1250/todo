"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/components/auth/auth-provider";
import { authClient } from "@/lib/auth-client";

import { Button, Input } from "@/components/ui";
import { toast } from "sonner";

interface DeviceSession {
  id: string;
  userAgent?: string;
  ipAddress?: string;
  createdAt?: string;
  lastSeen?: string;
  isCurrent?: boolean;
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

type PasswordForm = z.infer<typeof passwordSchema>;

export default function SessionsSettingsPage() {
  const { session } = useAuth();
  const [sessions, setSessions] = React.useState<DeviceSession[]>([]);
  const [loading, setLoading] = React.useState(false);

  const pwForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  const loadSessions = async () => {
    setLoading(true);
    try {
      const res = (await (authClient as unknown as { listSessions: () => Promise<unknown> }).listSessions()) as { data?: unknown };
      const list = (res?.data || []) as unknown as DeviceSession[];
      setSessions(Array.isArray(list) ? list : []);
    } catch {
      toast.error("Could not load sessions.");
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    let active = true;
    (async () => {
      if (!active) return;
      await loadSessions();
    })();
    return () => {
      active = false;
    };
  }, []);

  const revoke = async (id: string) => {
    try {
      await (authClient as unknown as { revokeSession: (a: { token: string }) => Promise<unknown> }).revokeSession({ token: id });
      toast.success("Signed out.");
      void loadSessions();
    } catch {
      toast.error("Could not sign out that device.");
    }
  };

  const revokeOthers = async () => {
    try {
      await (authClient as unknown as { revokeOtherSessions: () => Promise<unknown> }).revokeOtherSessions();
      toast.success("Signed out of other devices.");
      void loadSessions();
    } catch {
      toast.error("Could not sign out other devices.");
    }
  };

  const changePassword = async (data: PasswordForm) => {
    try {
      const res = (await (authClient as unknown as { changePassword: (a: unknown) => Promise<unknown> }).changePassword({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      })) as { error?: { message?: string } };
      if (res?.error) {
        toast.error(res.error.message || "Could not change password.");
        return;
      }
      toast.success("Password updated.");
      pwForm.reset();
    } catch {
      toast.error("Could not change password.");
    }
  };

  const connectGoogle = async () => {
    try {
      await (authClient as unknown as { linkSocial: (a: unknown) => Promise<unknown> }).linkSocial({ provider: "google", callbackURL: "/settings/sessions" });
    } catch {
      toast.error("Could not connect account.");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">Sessions</h1>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Signed-in devices</h2>
          <Button variant="outline" onClick={revokeOthers}>Sign out others</Button>
        </div>
        {loading && <p className="text-sm text-[var(--fg-muted)]">Loading...</p>}
        <ul className="space-y-2">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center justify-between rounded border border-[var(--border)] p-3">
              <div>
                <div className="text-sm font-medium">{s.userAgent || "Unknown device"}</div>
                <div className="text-xs text-[var(--fg-muted)]">
                  {s.ipAddress || "Unknown location"} {s.lastSeen ? `· last seen ${s.lastSeen}` : ""}
                </div>
                {s.id === session?.id && (
                  <span className="text-xs text-emerald-600">Current device</span>
                )}
              </div>
              {s.id !== session?.id && (
                <Button variant="outline" size="sm" onClick={() => revoke(s.id)}>
                  Sign out
                </Button>
              )}
            </li>
          ))}
          {sessions.length === 0 && !loading && (
            <li className="text-sm text-[var(--fg-muted)]">No sessions found.</li>
          )}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Account recovery</h2>
        <form onSubmit={pwForm.handleSubmit(changePassword)} className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1.5">Current password</label>
            <Input type="password" {...pwForm.register("currentPassword")} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">New password</label>
            <Input type="password" {...pwForm.register("newPassword")} />
          </div>
          <Button type="submit" isLoading={pwForm.formState.isSubmitting}>
            Change password
          </Button>
        </form>
        <div className="flex gap-2">
          <Button variant="outline" onClick={connectGoogle}>Connect Google</Button>
        </div>
      </section>
    </div>
  );
}