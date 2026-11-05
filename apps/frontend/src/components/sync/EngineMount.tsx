"use client";

// New-engine app-shell mount (Phase 5 cutover 6a).
//
// Runs alongside the OLD engine (SyncStatus/NetworkBanner in page.tsx) until
// the cutover removes the old one. Both engines pushing/pulling concurrently
// is safe: pushes are idempotent (mutation id), pulls are harmless dupes.
//
// Owns: useSyncEngine(userId) lifecycle, SyncPill + SyncSheet wiring,
// OfflineBanner, FirstSyncScreen (resyncing / first-ever sync), InstallGuide,
// SWRegister. Renders engine UI only when signed in; SW + install nudge are
// user-independent.

import * as React from "react";
import { useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useSyncEngine } from "@/hooks/useSyncEngine";
import { SyncPill } from "./SyncPill";
import { SyncSheet } from "./SyncSheet";
import { OfflineBanner } from "./OfflineBanner";
import { FirstSyncScreen } from "./FirstSyncScreen";
import { InstallGuide } from "./InstallGuide";
import { SWRegister } from "./SWRegister";

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  React.useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  return online;
}

export function SyncEngineMount() {
  const { user } = useAuth();
  const { state, pendingCount, lastSyncAt, syncNow } = useSyncEngine(
    user?.id ?? null,
  );
  const [sheetOpen, setSheetOpen] = useState(false);
  const online = useOnline();

  if (!user) {
    return (
      <>
        <SWRegister />
        <InstallGuide />
      </>
    );
  }

  const catchingUp = state === "pushing" || state === "pulling";
  // First-ever sync (nothing applied yet, still working) or full resync.
  const showFirstSync =
    state === "resyncing" ||
    ((state === "pushing" || state === "pulling") && lastSyncAt == null);

  return (
    <>
      <SWRegister />
      <OfflineBanner online={online} catchingUp={catchingUp} />
      <div className="flex justify-center px-4 pt-2">
        <SyncPill
          state={state}
          pendingCount={pendingCount}
          lastSyncAt={lastSyncAt}
          onOpen={() => setSheetOpen(true)}
        />
      </div>
      <SyncSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        lastSyncAt={lastSyncAt}
        pendingCount={pendingCount}
        onSaveNow={syncNow}
      />
      {showFirstSync ? (
        <FirstSyncScreen progress={0.3} count={pendingCount} done={false} />
      ) : null}
      <InstallGuide />
    </>
  );
}
