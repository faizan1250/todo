"use client";

import * as React from "react";
import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FaqItem {
  question: string;
  answer: string;
  category: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    category: "Access & Registration",
    question: "Do I need an invite code to access Todo Studio?",
    answer:
      "No! Todo Studio has open registration. You can sign up with just your name, email, and password by clicking 'Get Started Free' on the hero bar to unlock your workspace immediately. Invite codes remain optionally supported for special organizational onboarding.",
  },
  {
    category: "Architecture & Security",
    question: "How is security and session isolation implemented?",
    answer:
      "Authentication is built on Better Auth with HttpOnly, Secure, SameSite cookies, hardened CSRF protection, and two-factor authentication (2FA). Backend endpoints are hosted on ElysiaJS running on Bun, with strict schema validation on all payloads and constant-time invite hash verification.",
  },
  {
    category: "Ergonomics",
    question: "What keyboard shortcuts and command palette functions are supported?",
    answer:
      "Press Cmd+K (or Ctrl+K on Linux/Windows) anywhere in the application to open the Command Palette. From there, you can jump between lists ('Today', 'Upcoming', 'Backlog'), filter by tags or folders, spawn new tasks, and toggle light/dark modes. Inside task lists, use Up/Down arrow keys, Enter to inspect details, and Space to toggle task completion.",
  },
  {
    category: "Data Portability",
    question: "Can I export or backup my task data?",
    answer:
      "Yes. All sprint milestones, task trees, and checklist sub-items can be exported to clean JSON or Markdown checklists anytime. Your data belongs to you—there is zero vendor lock-in or proprietary binary storage format.",
  },
  {
    category: "Design System",
    question: "How does the theming system handle dark mode?",
    answer:
      "Todo Studio's dark mode is engineered around deep blue tokens (#051A4D / --blue-950) instead of generic washed-out black or slate defaults. Contrast ratios strictly exceed WCAG AA standards (4.5:1 for body copy and 5.5:1 for bubblegum pink highlights on dark blue surfaces).",
  },
];

export function FaqSection() {
  const [openIndices, setOpenIndices] = useState<number[]>([0]); // first item open by default

  const toggleIndex = (index: number) => {
    setOpenIndices((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]
    );
  };

  return (
    <section className="relative bg-white py-20 sm:py-28 dark:bg-[#051A4D]">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        {/* Section Heading */}
        <div className="text-center mb-14 sm:mb-18">
          <Badge variant="secondary" className="mb-3 font-semibold uppercase tracking-wider text-[11px]">
            Frequently Asked Questions
          </Badge>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#0B1220] sm:text-4xl dark:text-white">
            Everything You Need to Know
          </h2>
          <p className="mt-3 text-base text-[#5B6478] dark:text-[#9BB0D3]">
            Straightforward answers about registration, security, keyboard shortcuts, and data ownership.
          </p>
        </div>

        {/* Accordion Container */}
        <div className="space-y-3.5">
          {FAQ_ITEMS.map((item, index) => {
            const isOpen = openIndices.includes(index);
            const contentId = `faq-content-${index}`;
            const headerId = `faq-header-${index}`;

            return (
              <div
                key={index}
                className={cn(
                  "rounded-xl border transition-all duration-200 overflow-hidden",
                  isOpen
                    ? "border-[#09318D]/30 bg-[#F2F5FC]/60 shadow-sm dark:border-[#FD91CC]/30 dark:bg-[#082363]/80"
                    : "border-[#E4E8F2] bg-white hover:border-[#CBD5E1] dark:border-[#132E74] dark:bg-[#082363]/40 dark:hover:border-[#1F459E]"
                )}
              >
                <button
                  type="button"
                  id={headerId}
                  aria-expanded={isOpen}
                  aria-controls={contentId}
                  onClick={() => toggleIndex(index)}
                  className="flex w-full items-center justify-between gap-4 p-5 sm:p-6 text-left cursor-pointer focus-ring-pink"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-sm sm:text-base text-[#0B1220] dark:text-white">
                      {item.question}
                    </span>
                  </div>

                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#E4E8F2] bg-white text-[#5B6478] transition-transform duration-200 dark:border-[#132E74] dark:bg-[#051A4D] dark:text-[#9BB0D3]",
                      isOpen && "rotate-180 bg-[#09318D] text-white dark:bg-[#FD91CC] dark:text-[#051A4D]"
                    )}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </button>

                {isOpen && (
                  <div
                    id={contentId}
                    role="region"
                    aria-labelledby={headerId}
                    className="border-t border-[#E4E8F2]/60 px-5 pb-5 pt-3 sm:px-6 sm:pb-6 dark:border-[#132E74]/60"
                  >
                    <p className="text-sm text-[#5B6478] dark:text-[#9BB0D3] leading-relaxed">
                      {item.answer}
                    </p>
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-[#09318D] dark:text-[#FD91CC] font-medium">
                      <HelpCircle className="h-3.5 w-3.5" />
                      <span>Category: {item.category}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
