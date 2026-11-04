"use client";

import * as React from "react";
import { useState } from "react";
import { useAuth } from "./auth-provider";
import { ProfileModal } from "./profile-modal";
import { useInviteValidator } from "@/hooks/use-invite-validator";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Badge, Input } from "@/components/ui";
import { CheckCircle2Icon, AlertCircleIcon, SparklesIcon } from "@/components/icons";
import { ShieldCheck, ShieldAlert, KeyRound, UserCheck, ArrowRight } from "lucide-react";

export function AuthSessionCard() {
  const { user, profile, isAuthenticated, isLoading, openAuthModal, logout } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);

  // Standalone invite checker for interactive homepage testing
  const testerInvite = useInviteValidator({
    debounceMs: 350,
    autoValidate: true,
  });

  if (isLoading) {
    return (
      <div className="mb-6 rounded-2xl border border-[#E4E8F2] bg-white/70 p-5 shadow-2xs dark:border-[#132E74] dark:bg-[#082363]/40">
        <div className="h-5 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800 mb-2" />
        <div className="h-4 w-64 animate-pulse rounded bg-zinc-100 dark:bg-zinc-800/60" />
      </div>
    );
  }

  if (isAuthenticated && user) {
    return (
      <>
        <Card className="mb-8 border-[#D5E1F7] bg-linear-to-r from-[#F2F5FC] via-white to-[#F2F5FC] dark:from-[#082363] dark:via-[#092B7D] dark:to-[#082363]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#09318D] text-white shadow-2xs">
                  <UserCheck className="h-5 w-5 text-[#FD91CC]" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base sm:text-lg">
                      Welcome back, {user.name || user.email}
                    </CardTitle>
                    <Badge variant="default" className="text-[10px]">
                      {profile?.role || user.role || "Member"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs">
                    Authenticated session active with Better Auth & ElysiaJS
                  </CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setProfileOpen(true)}
                  className="text-xs"
                >
                  Edit Profile
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => logout()}
                  className="text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Sign Out
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="pt-2 text-xs">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-[#E4E8F2] bg-white/80 p-3.5 dark:border-[#132E74] dark:bg-[#061B4A]/70">
              <div>
                <span className="text-[10px] text-[#5B6478] dark:text-[#9BB0D3] uppercase tracking-wider font-semibold">
                  Email
                </span>
                <p className="mt-0.5 font-medium truncate">{user.email}</p>
              </div>

              <div>
                <span className="text-[10px] text-[#5B6478] dark:text-[#9BB0D3] uppercase tracking-wider font-semibold">
                  Timezone
                </span>
                <p className="mt-0.5 font-medium">{profile?.timezone || "UTC"}</p>
              </div>

              <div>
                <span className="text-[10px] text-[#5B6478] dark:text-[#9BB0D3] uppercase tracking-wider font-semibold">
                  Locale
                </span>
                <p className="mt-0.5 font-medium">{profile?.locale || "en-US"}</p>
              </div>

              <div>
                <span className="text-[10px] text-[#5B6478] dark:text-[#9BB0D3] uppercase tracking-wider font-semibold">
                  2FA Protection
                </span>
                <div className="mt-0.5 flex items-center gap-1 font-medium">
                  {profile?.twoFactorEnabled ? (
                    <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                      <ShieldCheck className="h-3.5 w-3.5" /> Enabled
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[#5B6478] dark:text-[#9BB0D3]">
                      <ShieldAlert className="h-3.5 w-3.5" /> Disabled
                    </span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <ProfileModal
          isOpen={profileOpen}
          onClose={() => setProfileOpen(false)}
        />
      </>
    );
  }

  // Unauthenticated State: Early Access & Invite Checker Card
  return (
    <Card className="mb-8 border-[#D5E1F7] bg-linear-to-r from-[#F2F5FC] via-white to-[#F2F5FC] dark:from-[#082363] dark:via-[#092B7D] dark:to-[#082363]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#09318D] text-white shadow-2xs">
              <SparklesIcon className="h-5 w-5 text-[#FD91CC]" />
            </div>
            <div>
              <CardTitle className="text-base sm:text-lg">
                Private Workspace Access
              </CardTitle>
              <CardDescription className="text-xs">
                Registration is currently invite-only. Sign in or validate your invite token below.
              </CardDescription>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openAuthModal("sign-in")}
              className="text-xs"
            >
              Sign In
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => openAuthModal("sign-up")}
              className="text-xs"
            >
              Claim Invite Code
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-2">
        <div className="rounded-xl border border-[#E4E8F2] bg-white/80 p-3.5 dark:border-[#132E74] dark:bg-[#061B4A]/70">
          <label
            htmlFor="home-invite-check"
            className="mb-1.5 flex items-center justify-between text-xs font-medium"
          >
            <span className="flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-[#09318D] dark:text-[#FD91CC]" />
              Test Invite Code Preflight
            </span>
            <span className="text-[10px] text-[#5B6478] dark:text-[#9BB0D3]">
              POST /api/invite/validate
            </span>
          </label>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                id="home-invite-check"
                placeholder="Enter invite code (e.g. VIP-BETA-2026)"
                value={testerInvite.code}
                onChange={(e) =>
                  testerInvite.setCode(e.target.value.toUpperCase())
                }
                className="font-mono uppercase text-xs tracking-wider"
              />
            </div>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => testerInvite.validate()}
              isLoading={testerInvite.status === "checking"}
              className="text-xs shrink-0"
            >
              Validate Code
            </Button>
          </div>

          {/* Validation Feedback */}
          <div className="mt-2 min-h-[24px]">
            {testerInvite.status === "valid" && (
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="secondary"
                    className="bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-300"
                  >
                    <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-600" />
                    Valid Invite Code
                  </Badge>
                  <span className="text-emerald-700 dark:text-emerald-300 text-xs">
                    Remaining uses: {testerInvite.validationResult?.remainingUses ?? 1}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="accent"
                  size="sm"
                  onClick={() => openAuthModal("sign-up")}
                  className="text-xs h-7 py-0 px-2.5"
                >
                  Create Account with this Code <ArrowRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            )}

            {testerInvite.status === "invalid" && (
              <div className="flex items-center gap-1.5 text-xs">
                <Badge
                  variant="accent"
                  className="bg-[#FFE8F5] text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-300"
                >
                  <AlertCircleIcon className="h-3.5 w-3.5 text-red-600" />
                  Invalid Code
                </Badge>
                <span className="text-red-700 dark:text-red-300">
                  {testerInvite.errorMessage}
                </span>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
