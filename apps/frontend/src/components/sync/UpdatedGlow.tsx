"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { subscribeRemoteChanged } from "./remote-events";

export interface UpdatedRowGlowProps {
  entity: string;
  id: string;
  deviceName?: string;
  children: ReactNode;
  className?: string;
}

const GLOW_MS = 1200;

export function UpdatedRowGlow({
  entity,
  id,
  deviceName,
  children,
  className,
}: UpdatedRowGlowProps) {
  const [glowing, setGlowing] = useState(false);
  const [eventDevice, setEventDevice] = useState<string | null>(null);
  const fromDevice = eventDevice ?? deviceName ?? "another device";
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeRemoteChanged((detail) => {
      if (detail.entity !== entity || detail.id !== id) return;
      setEventDevice(detail.deviceName);
      setGlowing(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setGlowing(false);
        timerRef.current = null;
      }, GLOW_MS);
    });
    return () => {
      unsubscribe();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [entity, id]);

  // deviceName prop wins at rest; event value wins for 1.2s after a ping.

  return (
    <div
      className={cn(
        "rounded-lg motion-safe:transition-colors motion-safe:duration-300",
        glowing && "bg-pink-500/10 ring-1 ring-pink-500/40",
        className,
      )}
    >
      {children}
      <p
        aria-live="polite"
        className={cn(
          "overflow-hidden px-1 text-xs text-fg-muted",
          "motion-safe:transition-all motion-safe:duration-300",
          glowing ? "mt-1 max-h-6 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {glowing ? copy.sync.updatedFromDevice(fromDevice) : ""}
      </p>
    </div>
  );
}
