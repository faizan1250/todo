import { describe, it, expect, mock, afterEach } from "bun:test";
import {
  validateInviteCode,
  getCurrentProfile,
  updateCurrentProfile,
  ApiError,
} from "../src/lib/api";
import { authClient, signIn, signUp, signOut, useSession } from "../src/lib/auth-client";

describe("Frontend Auth Integration", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("auth-client initialization", () => {
    it("exports initialized Better Auth client methods", () => {
      expect(Boolean(authClient)).toBe(true);
      expect(typeof signIn).toBe("function");
      expect(typeof signIn.email).toBe("function");
      expect(typeof signUp).toBe("function");
      expect(typeof signUp.email).toBe("function");
      expect(typeof signOut).toBe("function");
      expect(typeof useSession).toBe("function");
    });

    it("has twoFactor plugin configured on authClient", () => {
      expect(authClient.twoFactor).toBeDefined();
      expect(typeof authClient.twoFactor.verifyTotp).toBe("function");
    });
  });

  describe("validateInviteCode()", () => {
    it("returns invalid immediately for empty or whitespace code without network call", async () => {
      const fetchMock = mock();
      globalThis.fetch = fetchMock;

      const res1 = await validateInviteCode("");
      expect(res1.valid).toBe(false);
      expect(res1.reason).toBe("Invite code is required");
      expect(res1.remainingUses).toBe(0);

      const res2 = await validateInviteCode("   ");
      expect(res2.valid).toBe(false);
      expect(res2.remainingUses).toBe(0);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("calls POST /api/invite/validate with trimmed code and returns valid payload", async () => {
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/api/invite/validate");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.code).toBe("BETA-TEST-2026");

        return new Response(
          JSON.stringify({
            valid: true,
            remainingUses: 1,
            expiresAt: "2026-12-31T00:00:00.000Z",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await validateInviteCode("  BETA-TEST-2026  ");
      expect(result.valid).toBe(true);
      expect(result.remainingUses).toBe(1);
      expect(result.expiresAt).toBe("2026-12-31T00:00:00.000Z");
    });

    it("handles 404/400 invalid invite responses gracefully", async () => {
      globalThis.fetch = mock(async () => {
        return new Response(
          JSON.stringify({
            valid: false,
            reason: "Invite code not found",
            remainingUses: 0,
          }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      });

      const result = await validateInviteCode("INVALID-CODE");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Invite code not found");
      expect(result.remainingUses).toBe(0);
    });

    it("catches network errors and returns safe fallback object", async () => {
      globalThis.fetch = mock(async () => {
        throw new Error("Network connection dropped");
      });

      const result = await validateInviteCode("FAIL-NET");
      expect(result.valid).toBe(false);
      expect(result.reason).toBe("Network connection dropped");
      expect(result.remainingUses).toBe(0);
    });
  });

  describe("getCurrentProfile()", () => {
    it("returns null when unauthenticated (401 response)", async () => {
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/me");
        expect(init?.credentials).toBe("include");
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
        });
      });

      const profile = await getCurrentProfile();
      expect(profile).toBeNull();
    });

    it("returns parsed user profile when authenticated (200 response)", async () => {
      const mockProfile = {
        id: "usr_123",
        name: "Faizan Khan",
        email: "faizan@example.com",
        emailVerified: true,
        image: null,
        twoFactorEnabled: false,
        role: "admin",
        timezone: "America/New_York",
        locale: "en-US",
        weekStartsOn: 1,
        preferences: { theme: "system" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      };

      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify(mockProfile), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const profile = await getCurrentProfile();
      expect(profile).not.toBeNull();
      expect(profile?.id).toBe("usr_123");
      expect(profile?.email).toBe("faizan@example.com");
      expect(profile?.role).toBe("admin");
      expect(profile?.timezone).toBe("America/New_York");
    });

    it("throws ApiError for unexpected 500 error", async () => {
      globalThis.fetch = mock(async () => {
        return new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        });
      });

      expect(getCurrentProfile()).rejects.toThrow(ApiError);
    });
  });

  describe("updateCurrentProfile()", () => {
    it("sends PATCH /me with credentials and updates profile", async () => {
      const updatedProfile = {
        id: "usr_123",
        name: "Faizan K.",
        email: "faizan@example.com",
        emailVerified: true,
        image: null,
        twoFactorEnabled: true,
        role: "admin",
        timezone: "Europe/London",
        locale: "en-GB",
        weekStartsOn: 1,
        preferences: { theme: "dark" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      };

      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/me");
        expect(init?.method).toBe("PATCH");
        expect(init?.credentials).toBe("include");
        const body = JSON.parse(init?.body as string);
        expect(body.name).toBe("Faizan K.");
        expect(body.timezone).toBe("Europe/London");

        return new Response(JSON.stringify(updatedProfile), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const res = await updateCurrentProfile({
        name: "Faizan K.",
        timezone: "Europe/London",
      });

      expect(res.name).toBe("Faizan K.");
      expect(res.timezone).toBe("Europe/London");
      expect(res.twoFactorEnabled).toBe(true);
    });

    it("throws ApiError with server error message when update fails", async () => {
      globalThis.fetch = mock(async () => {
        return new Response(JSON.stringify({ error: "Invalid timezone" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      });

      expect(
        updateCurrentProfile({ timezone: "Invalid/Zone" })
      ).rejects.toThrow("Invalid timezone");
    });
  });
});
