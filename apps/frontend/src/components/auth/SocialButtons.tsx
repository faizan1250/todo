"use client";

import * as React from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui";
import { toast } from "sonner";

export interface SocialButtonsProps {
  callbackURL?: string;
}

export function SocialButtons({ callbackURL = "/" }: SocialButtonsProps) {
  const [loading, setLoading] = React.useState<string | null>(null);

  const handle = async (provider: "google" | "apple") => {
    setLoading(provider);
    try {
      await authClient.signIn.social({ provider, callbackURL });
    } catch {
      toast.error("Could not sign in. Try again.");
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <Button
        type="button"
        variant="outline"
        isLoading={loading === "google"}
        onClick={() => handle("google")}
      >
        Google
      </Button>
      <Button
        type="button"
        variant="outline"
        isLoading={loading === "apple"}
        onClick={() => handle("apple")}
      >
        Apple
      </Button>
    </div>
  );
}
