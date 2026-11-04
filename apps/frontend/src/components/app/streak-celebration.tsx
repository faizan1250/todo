"use client";

import * as React from "react";
import { useEffect, useState } from "react";
import { Flame, Sparkles, X, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";

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

export function StreakCelebration({
  active,
  streakCount,
  taskTitle,
  onDismiss,
  durationMs = 3200,
}: StreakCelebrationProps) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (active) {
      // Generate restrained particle burst positions
      const newParticles: Particle[] = Array.from({ length: 12 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 160,
        y: -30 - Math.random() * 80,
        size: Math.floor(Math.random() * 5) + 4,
        color: i % 2 === 0 ? "#FD91CC" : "#09318D",
        delay: Math.random() * 0.1,
      }));
      setParticles(newParticles);

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
          {particles.map((p) => (
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
