"use client";

import * as React from "react";
import { ArrowRight, KeyRound, Terminal, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LiveDemoPreview } from "./live-demo-preview";

interface HeroProps {
  onOpenAuth: (mode?: "sign-in" | "sign-up") => void;
  onExploreApp?: () => void;
}

export function Hero({ onOpenAuth, onExploreApp }: HeroProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-[#051A4D] via-[#07256C] to-[#09318D] text-white pt-16 pb-20 sm:pt-24 sm:pb-32">
      {/* Subtle Grid Ambient Texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-15 [background-image:radial-gradient(rgba(255,255,255,0.2)_1px,transparent_1px)] [background-size:24px_24px]"
      />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Top Header Tag */}
        <div className="flex flex-col items-center text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs backdrop-blur-md mb-6 shadow-sm">
            <span className="flex h-2 w-2 rounded-full bg-[#FD91CC] animate-pulse" />
            <span className="font-semibold tracking-wide uppercase text-white/90">
              Invite-Only Early Access
            </span>
            <span className="text-white/40">•</span>
            <span className="text-[#FFA8D7] font-medium">Batch #04 Open</span>
          </div>

          {/* Main Hero Headline */}
          <h1 className="max-w-4xl text-4xl font-extrabold tracking-tight text-white sm:text-5xl md:text-6xl lg:leading-[1.1]">
            Precision Task Orchestration for{" "}
            <span className="relative inline-block text-white">
              High-Velocity
              <span
                aria-hidden="true"
                className="absolute -bottom-1 left-0 right-0 h-1.5 rounded-full bg-gradient-to-r from-[#FD91CC] to-transparent opacity-80"
              />
            </span>{" "}
            Engineering Teams
          </h1>

          {/* Subtitle */}
          <p className="mt-6 max-w-2xl text-base sm:text-lg text-white/80 leading-relaxed">
            Eliminate mental drag with sub-millisecond local reactions, cryptographic invite guards,
            and keyboard-first ergonomics. Built on Next.js 16 and Bun + ElysiaJS.
          </p>

          {/* Action CTAs */}
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3 w-full sm:w-auto">
            <Button
              variant="accent"
              size="lg"
              onClick={() => onOpenAuth("sign-up")}
              className="w-full sm:w-auto text-[#051A4D] font-bold shadow-lg hover:shadow-[0_0_20px_rgba(253,145,204,0.4)]"
            >
              <KeyRound className="h-4 w-4" />
              <span>Claim Invite Access</span>
              <ArrowRight className="h-4 w-4" />
            </Button>

            {onExploreApp && (
              <Button
                variant="secondary"
                size="lg"
                onClick={onExploreApp}
                className="w-full sm:w-auto border-white/25 bg-white/10 text-white hover:bg-white/20 shadow-sm"
              >
                <Terminal className="h-4 w-4" />
                <span>Launch Interactive Demo</span>
              </Button>
            )}
          </div>

          {/* Proof Metric Chips */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/70">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-[#FD91CC]" />
              <span>Zero telemetry tracking</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-[#FD91CC]" />
              <span>Sub-millisecond ElysiaJS backend</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-[#FD91CC]" />
              <span>100% Keyboard Navigable (⌘K)</span>
            </div>
          </div>
        </div>

        {/* Live Interactive Product Mockup Preview */}
        <div className="mt-14 sm:mt-20">
          <LiveDemoPreview onOpenAuth={() => onOpenAuth("sign-up")} onExploreApp={onExploreApp} />
        </div>
      </div>
    </section>
  );
}
