import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", error, disabled, ...props }, ref) => {
    return (
      <input
        type={type}
        disabled={disabled}
        aria-invalid={error ? "true" : undefined}
        ref={ref}
        className={cn(
          "flex h-10 w-full rounded-[10px] border border-[#E4E8F2] bg-white px-3.5 py-2 text-sm text-[#0B1220] shadow-2xs transition-colors duration-150",
          "placeholder:text-[#5B6478]/70",
          "focus:border-[#09318D] focus:outline-none focus:ring-2 focus:ring-[#FD91CC] focus:ring-offset-1 focus:ring-offset-white",
          "disabled:cursor-not-allowed disabled:bg-[#F2F5FC] disabled:opacity-50 disabled:text-[#5B6478]",
          "dark:border-[#16367F] dark:bg-[#072366]/50 dark:text-[#F8FAFC] dark:placeholder:text-[#9BB0D3]/60 dark:focus:ring-offset-[#051A4D] dark:focus:border-[#2563EB] dark:disabled:bg-[#061B4A]",
          error &&
            "border-red-500 focus:border-red-600 focus:ring-red-300 dark:border-red-500 dark:focus:ring-red-900/50",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";
