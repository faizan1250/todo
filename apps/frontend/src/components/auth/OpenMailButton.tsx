"use client";

import * as React from "react";
import { Button } from "@/components/ui";
import { Mail } from "lucide-react";

export function OpenMailButton({ email }: { email: string }) {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  let url = `mailto:${email}`;
  let label = "Open your email";
  if (domain.includes("gmail")) {
    url = "https://mail.google.com";
    label = "Open Gmail";
  } else if (domain.includes("outlook") || domain.includes("hotmail") || domain.includes("live")) {
    url = "https://outlook.live.com";
    label = "Open Outlook";
  }

  return (
    <Button variant="primary" size="lg" className="w-full" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
      <Mail className="h-4 w-4" />
      {label}
    </Button>
  );
}
