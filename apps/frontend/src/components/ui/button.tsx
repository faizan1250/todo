import * as React from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "accent";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "default",
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-medium select-none transition-all duration-150 rounded-lg cursor-pointer disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FD91CC] focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-[#051A4D]";

    const sizeStyles = {
      default: "h-10 px-4 py-2 text-sm gap-2",
      sm: "h-8 px-3 text-xs gap-1.5",
      lg: "h-12 px-6 text-base gap-2.5",
      icon: "h-10 w-10 p-0",
    };

    const variantStyles = {
      // Primary: Solid Deep Blue (#09318D) with split-border light model depth
      primary:
        "btn-primary-depth text-white shadow-xs font-semibold hover:brightness-105 active:translate-y-[0.5px]",

      // Secondary / Outline: Calm Tier 1 neutral edge, subordinate to primary
      secondary:
        "bg-[#F2F5FC] text-[#09318D] border border-[#E4E8F2] shadow-2xs hover:bg-[#E8EFFB] hover:border-[#D1DCF0] active:translate-y-[0.5px] dark:bg-[#082363] dark:text-[#F8FAFC] dark:border-[#16367F] dark:hover:bg-[#0C2F82]",

      outline:
        "bg-white border border-[#E4E8F2] text-[#0B1220] shadow-2xs hover:bg-[#F2F5FC] hover:border-[#CBD5E1] active:translate-y-[0.5px] dark:bg-transparent dark:border-[#16367F] dark:text-[#F8FAFC] dark:hover:bg-[#082363]",

      // Ghost: Tier 0 flush control
      ghost:
        "bg-transparent text-[#5B6478] hover:text-[#0B1220] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:text-[#FFFFFF] dark:hover:bg-[#082363]",

      // Accent: Bubblegum Pink (#FD91CC) CTA with high-contrast Deep Blue text (#051A4D)
      accent:
        "btn-accent-pink font-semibold shadow-xs hover:brightness-105 active:translate-y-[0.5px]",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)}
        {...props}
      >
        {isLoading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
