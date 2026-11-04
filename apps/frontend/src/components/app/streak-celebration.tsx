"use client";

import * as React from "react";
import { useEffect } from "react";
import { Flame, X } from "lucide-react";

interface StreakCelebrationProps {
  active: boolean;
  streakCount: number;
  taskTitle?: string;
  onDismiss: () => void;
  durationMs?: number;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
  delay: number;
}

const PARTICLES: Particle[] = [
  { id: 0, x: -60, y: -45, size: 6, color: "#FD91CC", delay: 0.02 },
  { id: 1, x: 45, y: -65, size: 5, color: "#09318D", delay: 0.05 },
  { id: 2, x: -30, y: -80, size: 7, color: "#FD91CC", delay: 0.08 },
  { id: 3, x: 70, y: -40, size: 5, color: "#09318D", delay: 0.01 },
  { id: 4, x: -75, y: -55, size: 6, color: "#FD91CC", delay: 0.06 },
  { id: 5, x: 20, y: -75, size: 8, color: "#09318D", delay: 0.03 },
  { id: 6, x: -15, y: -90, size: 5, color: "#FD91CC", delay: 0.09 },
  { id: 7, x: 55, y: -60, size: 6, color: "#09318D", delay: 0.04 },
  { id: 8, x: -45, y: -35, size: 7, color: "#FD91CC", delay: 0.07 },
  { id: 9, x: 35, y: -85, size: 5, color: "#09318D", delay: 0.02 },
  { id: 10, x: -80, y: -70, size: 6, color: "#FD91CC", delay: 0.05 },
  { id: 11, x: 65, y: -75, size: 7, color: "#09318D", delay: 0.08 },
];

export function StreakCelebration({
  active,
  streakCount,
  taskTitle,
  onDismiss,
  durationMs = 3200,
}: StreakCelebrationProps) {
  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        onDismiss();
      }, durationMs);

      return () => clearTimeout(timer);
    }
  }, [active, durationMs, onDismiss]);

  if (!active) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-6 z-50 flex items-center justify-center px-4"
    >
      <div className="relative pointer-events-auto">
        {/* Floating Particles Burst (Disabled if prefers-reduced-motion) */}
        <div aria-hidden="true" className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
          {PARTICLES.map((p) => (
            <span
              key={p.id}
              className="absolute rounded-full animate-out fade-out zoom-out"
              style={{
                width: `${p.size}px`,
                height: `${p.size}px`,
                backgroundColor: p.color,
                transform: `translate(${p.x}px, ${p.y}px)`,
                animationDuration: "800ms",
                animationDelay: `${p.delay}s`,
                animationFillMode: "forwards",
              }}
            />
          ))}
        </div>

        {/* Celebration Card Banner */}
        <div className="animate-in fade-in slide-in-from-top-4 duration-200 flex items-center gap-3 rounded-2xl border border-[#FD91CC]/80 bg-white p-3.5 shadow-lift-blue ring-2 ring-[#FD91CC]/30 sm:px-5 sm:py-3 dark:border-[#FD91CC]/40 dark:bg-[#051A4D]">
          {/* Flame Icon Pill */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFE8F5] text-[#051A4D] shadow-2xs dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]">
            <Flame className="h-5 w-5 fill-[#FD91CC] text-[#051A4D] dark:fill-[#FD91CC] dark:text-[#FFA8D7]" />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-extrabold uppercase tracking-wider text-[#051A4D] dark:text-white">
                {streakCount}-Day Velocity Streak!
              </span>
              <span className="rounded-full bg-[#FFE8F5] px-2 py-0.5 font-mono text-[10px] font-bold text-[#051A4D] border border-[#FD91CC]/60 dark:bg-[#FD91CC]/20 dark:text-[#FFA8D7]">
                +50 XP
              </span>
            </div>
            <p className="mt-0.5 text-xs text-[#5B6478] dark:text-[#9BB0D3] max-w-xs truncate">
              {taskTitle ? `Completed "${taskTitle}"` : "Keep your momentum rolling forward."}
            </p>
          </div>

          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss streak celebration"
            className="ml-2 flex h-6 w-6 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] hover:text-[#0B1220] transition-colors dark:text-[#9BB0D3] dark:hover:bg-[#082363] dark:hover:text-white cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
