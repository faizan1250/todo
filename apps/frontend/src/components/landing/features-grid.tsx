"use client";

import * as React from "react";
import {
  Sparkles,
  Zap,
  ShieldCheck,
  RefreshCw,
  Flame,
  Command,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FeatureItem {
  icon: React.ElementType;
  title: string;
  badge?: string;
  description: string;
  stat?: string;
  colSpan?: string; // for 12-column grid versatility
}

const FEATURES: FeatureItem[] = [
  {
    icon: Sparkles,
    title: "Instant Open Access",
    badge: "Frictionless",
    description:
      "Start organizing immediately. Create your account with just email and password—no invite codes, waitlists, or gatekeeping.",
    stat: "Zero Waitlist",
    colSpan: "col-span-12 md:col-span-6 lg:col-span-4",
  },
  {
    icon: Zap,
    title: "Sub-Millisecond ElysiaJS Backend",
    badge: "0.8ms P99",
    description:
      "Powered by Bun and ElysiaJS routing. Local in-memory caching and optimistic UI updates guarantee instant task toggles with zero interface freezing.",
    stat: "< 1ms Latency",
    colSpan: "col-span-12 md:col-span-6 lg:col-span-4",
  },
  {
    icon: ShieldCheck,
    title: "End-to-End Cryptographic Privacy",
    badge: "Zero-Knowledge",
    description:
      "Your engineering sprint notes, client tasks, and strategic roadmaps are never monetized, indexed, or shared with third-party model scrapers.",
    stat: "AES-256 GCM",
    colSpan: "col-span-12 md:col-span-6 lg:col-span-4",
  },
  {
    icon: Command,
    title: "Keyboard-First Command Palette",
    badge: "⌘K Ergonomics",
    description:
      "Navigate lists, create tasks with priority flags, toggle dark mode, and filter tags without your fingers ever leaving the home row.",
    stat: "100% Navigable",
    colSpan: "col-span-12 md:col-span-6 lg:col-span-4",
  },
  {
    icon: Flame,
    title: "Micro-Interaction Streak Engine",
    badge: "Dopamine Loop",
    description:
      "Gentle pink particle celebrations reinforce high-velocity momentum without infantilizing your screen with noisy gamification fluff.",
    stat: "Momentum First",
    colSpan: "col-span-12 md:col-span-6 lg:col-span-4",
  },
  {
    icon: RefreshCw,
    title: "Deterministic State & Reversible Actions",
    badge: "Instant Undo",
    description:
      "Accidental deletes or completions are effortlessly reversible with non-blocking toast notifications and full audit trail rollbacks.",
    stat: "Lossless State",
    colSpan: "col-span-12 md:col-span-6 lg:col-span-4",
  },
];

export function FeaturesGrid() {
  return (
    <section className="relative bg-[#F2F5FC] py-20 sm:py-28 dark:bg-[#051A4D]/60">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-16 sm:mb-20">
          <Badge variant="secondary" className="mb-3 font-semibold uppercase tracking-wider text-[11px]">
            Engineered For Focus
          </Badge>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#0B1220] sm:text-4xl dark:text-white">
            Architected for Engineers Who Value Speed and Craft
          </h2>
          <p className="mt-4 text-base sm:text-lg text-[#5B6478] dark:text-[#9BB0D3] leading-relaxed">
            Every component in Todo Studio adheres to a deliberate physical depth model, strict
            light source coherence, and WCAG AA contrast standards.
          </p>
        </div>

        {/* 12-Column Responsive Grid */}
        <div className="grid grid-cols-12 gap-6 sm:gap-8">
          {FEATURES.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card
                key={index}
                interactive
                className={cn(
                  feature.colSpan,
                  "relative flex flex-col justify-between overflow-hidden border border-[#E4E8F2] bg-white transition-all duration-200 hover:-translate-y-1 hover:shadow-lift-blue dark:border-[#132E74] dark:bg-[#082363]"
                )}
              >
                <CardHeader className="space-y-4 p-6 sm:p-7">
                  <div className="flex items-center justify-between">
                    {/* Icon Container with Deep Blue & Pink Accent Details */}
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#09318D]/10 text-[#09318D] dark:bg-[#FD91CC]/15 dark:text-[#FFA8D7]">
                      <Icon className="h-6 w-6 stroke-[2]" />
                    </div>

                    {feature.badge && (
                      <Badge variant="secondary" className="text-[10px] py-0.5 px-2 font-mono">
                        {feature.badge}
                      </Badge>
                    )}
                  </div>

                  <CardTitle className="text-lg sm:text-xl font-bold text-[#0B1220] dark:text-white">
                    {feature.title}
                  </CardTitle>

                  <CardDescription className="text-sm text-[#5B6478] dark:text-[#9BB0D3] leading-relaxed">
                    {feature.description}
                  </CardDescription>
                </CardHeader>

                {feature.stat && (
                  <CardContent className="p-6 pt-0 sm:p-7 sm:pt-0 mt-auto">
                    <div className="border-t border-[#E4E8F2]/80 dark:border-[#132E74] pt-3 flex items-center justify-between text-xs font-mono text-[#5B6478] dark:text-[#9BB0D3]">
                      <span>Spec Benchmark</span>
                      <span className="font-semibold text-[#09318D] dark:text-[#FD91CC]">
                        {feature.stat}
                      </span>
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}
