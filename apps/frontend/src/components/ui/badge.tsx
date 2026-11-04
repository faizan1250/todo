import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "accent" | "outline";
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const baseStyles =
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide transition-colors";

    const variantStyles = {
      // Default: Deep Blue solid badge with crisp contrast
      default:
        "bg-[#09318D] text-white shadow-2xs border border-[#051A4D] dark:bg-[#0D41B4] dark:text-white dark:border-[#07256C]",

      // Secondary: Soft blue-50 tinted chip
      secondary:
        "bg-[#F2F5FC] text-[#051A4D] border border-[#D5E1F7] dark:bg-[#092B7D]/60 dark:text-[#D9E6FF] dark:border-[#173F94]",

      // Accent: Bubblegum pink tinted chip with deep blue text for WCAG AAA compliance (never pink text on white)
      accent:
        "bg-[#FFE8F5] text-[#051A4D] border border-[#FD91CC]/60 dark:bg-[#FD91CC]/15 dark:text-[#FFAED8] dark:border-[#FD91CC]/40",

      // Outline: Neutral subtle border
      outline:
        "border border-[#E4E8F2] text-[#5B6478] bg-white/60 dark:border-[#16367F] dark:text-[#9BB0D3] dark:bg-transparent",
    };

    return (
      <span
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], className)}
        {...props}
      />
    );
  }
);

Badge.displayName = "Badge";
