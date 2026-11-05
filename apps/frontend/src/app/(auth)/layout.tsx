import * as React from "react";
import { BrandPanel } from "@/components/auth";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <BrandPanel />
      <div className="flex items-center justify-center p-6 sm:p-10">
        {children}
      </div>
    </div>
  );
}
