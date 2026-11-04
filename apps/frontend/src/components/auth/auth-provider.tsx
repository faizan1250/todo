"use client";

import * as React from "react";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { authClient } from "@/lib/auth-client";
import { getCurrentProfile, type UserProfile } from "@/lib/api";
import { AuthModal } from "./auth-modal";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  emailVerified?: boolean;
  role?: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  [key: string]: unknown;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string | Date;
  token?: string;
  [key: string]: unknown;
}

export interface AuthContextType {
  session: AuthSession | null;
  user: AuthUser | null;
  profile: UserProfile | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshSession: () => Promise<void>;
  logout: () => Promise<void>;
  openAuthModal: (mode?: "sign-in" | "sign-up") => void;
  closeAuthModal: () => void;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const sessionHook = authClient.useSession();
  const [profile, setProfile] = useState<UserProfile | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"sign-in" | "sign-up">("sign-in");

  const userId = sessionHook.data?.user?.id;

  useEffect(() => {
    let isCurrent = true;
    if (userId) {
      getCurrentProfile()
        .then((data) => {
          if (isCurrent) {
            setProfile(data);
          }
        })
        .catch(() => {
          if (isCurrent) {
            setProfile(null);
          }
        });
    }

    return () => {
      isCurrent = false;
    };
  }, [userId]);

  const refreshSession = useCallback(async () => {
    try {
      await sessionHook.refetch?.();
      const prof = await getCurrentProfile();
      setProfile(prof);
    } catch {
      // keep existing or null
    }
  }, [sessionHook]);

  const logout = useCallback(async () => {
    try {
      await authClient.signOut();
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      setProfile(null);
    }
  }, []);

  const openAuthModal = useCallback((mode: "sign-in" | "sign-up" = "sign-in") => {
    setModalMode(mode);
    setIsModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  const handleAuthSuccess = useCallback(async () => {
    setIsModalOpen(false);
    await refreshSession();
  }, [refreshSession]);

  const rawUser = sessionHook.data?.user;
  const rawSession = sessionHook.data?.session;

  const user: AuthUser | null = rawUser ? (rawUser as unknown as AuthUser) : null;
  const session: AuthSession | null = rawSession
    ? (rawSession as unknown as AuthSession)
    : null;
  const effectiveProfile = rawUser ? profile : null;

  const value: AuthContextType = {
    session,
    user,
    profile: effectiveProfile,
    isLoading: sessionHook.isPending,
    isAuthenticated: !!user,
    refreshSession,
    logout,
    openAuthModal,
    closeAuthModal,
    setProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
      <AuthModal
        isOpen={isModalOpen}
        onClose={closeAuthModal}
        defaultMode={modalMode}
        onSuccess={handleAuthSuccess}
      />
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
