"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/components/auth/auth-provider";
import { authClient } from "@/lib/auth-client";
import { copy } from "@/lib/copy";
import { Button, Input } from "@/components/ui";
import { OtpInput } from "@/components/ui/otp-input";
import { toast } from "sonner";

const passwordSchema = z.object({ password: z.string().min(8) });

type PasswordForm = z.infer<typeof passwordSchema>;

export default function SecuritySettingsPage() {
  const { profile, setProfile } = useAuth();
  const [step, setStep] = React.useState(0); // 0 idle, 1 password, 2 qr, 3 verify, 4 codes
  const [totpUri, setTotpUri] = React.useState<string | null>(null);
  const [secret, setSecret] = React.useState<string | null>(null);
  const [backupCodes, setBackupCodes] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [code, setCode] = React.useState("");

  const pwForm = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema) });

  const startSetup = async (data: PasswordForm) => {
    setLoading(true);
    try {
      const res = (await (authClient as unknown as { twoFactor: { enable: (a: unknown) => Promise<unknown> } }).twoFactor.enable({ password: data.password })) as { error?: { message?: string }; data?: { totpURI?: string; uri?: string; secret?: string } };
      if (res?.error) {
        toast.error(res.error.message || "Could not start setup.");
        return;
      }
      setTotpUri(res?.data?.totpURI || res?.data?.uri || null);
      setSecret(res?.data?.secret || null);
      setStep(2);
    } catch {
      toast.error("Extra security setup is not available right now.");
    } finally {
      setLoading(false);
    }
  };

  const verify = async (value: string) => {
    setLoading(true);
    try {
      const res = (await (authClient as unknown as { twoFactor: { verifyTotp: (a: unknown) => Promise<unknown> } }).twoFactor.verifyTotp({ code: value })) as { error?: { message?: string }; data?: { backupCodes?: string[] } };
      if (res?.error) {
        toast.error("That code is not valid.");
        return;
      }
      const codes = res?.data?.backupCodes || [];
      setBackupCodes(Array.isArray(codes) ? codes : []);
      setStep(4);
      setProfile(profile ? { ...profile, twoFactorEnabled: true } : profile);
      toast.success("Extra security turned on.");
    } catch {
      toast.error("That code is not valid.");
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      await (authClient as unknown as { twoFactor: { disable: (a: unknown) => Promise<unknown> } }).twoFactor.disable({ password: "" });
      setProfile(profile ? { ...profile, twoFactorEnabled: false } : profile);
      toast.success("Extra security turned off.");
    } catch {
      toast.error("Could not turn off. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const copyCodes = () => {
    navigator.clipboard.writeText(backupCodes.join("\n")).then(() => toast.success("Copied."));
  };
  const downloadCodes = () => {
    const blob = new Blob([backupCodes.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "emergency-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">{copy.account.securitySection}</h1>

      {profile?.twoFactorEnabled ? (
        <div className="space-y-4">
          <p className="text-sm text-[var(--fg-muted)]">Extra security is on.</p>
          <Button variant="outline" onClick={disable} isLoading={loading}>
            Turn off extra security
          </Button>
        </div>
      ) : (
        <>
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-[var(--fg-muted)]">
                Add an extra check when you sign in.
              </p>
              <Button onClick={() => setStep(1)}>Set up extra security</Button>
            </div>
          )}

          {step === 1 && (
            <form onSubmit={pwForm.handleSubmit(startSetup)} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Confirm your password</label>
                <Input type="password" {...pwForm.register("password")} />
              </div>
              <Button type="submit" isLoading={loading}>Continue</Button>
            </form>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm font-medium">Step 1: Install an authenticator app.</p>
              <p className="text-sm font-medium">Step 2: Scan this code.</p>
              {totpUri ? (
                <div className="space-y-2">
                  <img
                    alt="QR code"
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpUri)}`}
                    className="border border-[var(--border)] rounded"
                  />
                  <p className="text-xs text-[var(--fg-muted)] break-all">
                    Or enter this code: {secret || totpUri}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--fg-muted)]">QR code not available. Use the text code above.</p>
              )}
              <p className="text-sm font-medium">Step 3: Enter the 6-digit code.</p>
              <OtpInput value={code} onChange={setCode} length={6} onComplete={verify} />
              <Button onClick={() => verify(code)} isLoading={loading} disabled={code.length < 6}>
                Verify
              </Button>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm font-medium">Save these emergency codes. They will not be shown again.</p>
              <div className="rounded border border-[var(--border)] p-3 font-mono text-xs space-y-1">
                {backupCodes.map((c) => (
                  <div key={c}>{c}</div>
                ))}
              </div>
              <p className="text-xs text-red-600">
                Warning: store these somewhere safe. Anyone with these codes can access your account.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" onClick={copyCodes}>Copy</Button>
                <Button variant="outline" onClick={downloadCodes}>Download</Button>
                <Button onClick={() => setStep(0)}>Done</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}