import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  plugins: [twoFactorClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
