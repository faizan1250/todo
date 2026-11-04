import { describe, expect, it } from "bun:test";
import { app } from "../src/index";
import { db, users, invites } from "../src/db";
import { eq } from "drizzle-orm";

describe("Phase 1 Backend: Auth, Invites & Profile", () => {
  // Helper to create an invite code creator and an invite
  async function createTestInvite(options?: { expired?: boolean; used?: boolean }) {
    const creatorId = "creator-" + Bun.randomUUIDv7();
    await db.insert(users).values({
      id: creatorId,
      name: "Creator " + creatorId.slice(-6),
      email: `${creatorId}@example.com`,
    });

    const code = "INV-" + Bun.randomUUIDv7();
    const expiresAt = options?.expired
      ? new Date(Date.now() - 3600000) // 1 hour ago
      : new Date(Date.now() + 86400000); // 24 hours from now

    await db.insert(invites).values({
      code,
      createdBy: creatorId,
      expiresAt,
      usedBy: options?.used ? creatorId : null,
      usedAt: options?.used ? new Date() : null,
    });

    return { creatorId, code, expiresAt };
  }

  describe("POST /api/invite/validate", () => {
    it("returns 404 for non-existent invite code", async () => {
      const res = await app.handle(
        new Request("http://localhost:3001/api/invite/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: "DOES-NOT-EXIST" }),
        })
      );

      expect(res.status).toBe(404);
      const data = (await res.json()) as { valid: boolean; reason: string; remainingUses: number };
      expect(data.valid).toBe(false);
      expect(data.reason).toBe("Invite code not found");
      expect(data.remainingUses).toBe(0);
    });

    it("returns 200 with remaining uses for active valid invite code", async () => {
      const { code } = await createTestInvite();

      const res = await app.handle(
        new Request("http://localhost:3001/api/invite/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { valid: boolean; remainingUses: number; expiresAt: string };
      expect(data.valid).toBe(true);
      expect(data.remainingUses).toBe(1);
      expect(typeof data.expiresAt).toBe("string");
    });

    it("returns 400 for expired invite code", async () => {
      const { code } = await createTestInvite({ expired: true });

      const res = await app.handle(
        new Request("http://localhost:3001/api/invite/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { valid: boolean; reason: string; remainingUses: number };
      expect(data.valid).toBe(false);
      expect(data.reason).toBe("Invite code has expired");
      expect(data.remainingUses).toBe(0);
    });

    it("returns 400 for already used invite code", async () => {
      const { code } = await createTestInvite({ used: true });

      const res = await app.handle(
        new Request("http://localhost:3001/api/invite/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code }),
        })
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { valid: boolean; reason: string; remainingUses: number };
      expect(data.valid).toBe(false);
      expect(data.reason).toBe("Invite code has already been used");
      expect(data.remainingUses).toBe(0);
    });
  });

  describe("Sign-up open registration, optional invite handling & sign-in", () => {
    it("succeeds sign-up without invite code (open registration)", async () => {
      const email = `noinvite-${Date.now()}@example.com`;
      const res = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password: "password123",
            name: "No Invite User",
          }),
        })
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        token: string;
        user: { id: string; email: string; name: string };
      };
      expect(data.user.email).toBe(email);
      expect(data.user.name).toBe("No Invite User");
    });

    it("rejects sign-up with invalid invite code", async () => {
      const res = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `badinvite-${Date.now()}@example.com`,
            password: "password123",
            name: "Bad Invite User",
            inviteCode: "INVALID-CODE",
          }),
        })
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { message: string };
      expect(data.message).toBe("Invalid invite code");
    });

    it("rejects sign-up with expired invite code", async () => {
      const { code } = await createTestInvite({ expired: true });

      const res = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `expired-${Date.now()}@example.com`,
            password: "password123",
            name: "Expired Invite User",
            inviteCode: code,
          }),
        })
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { message: string };
      expect(data.message).toBe("This invite code has expired");
    });

    it("succeeds sign-up with valid invite and marks invite code as used", async () => {
      const { code } = await createTestInvite();
      const email = `valid-${Date.now()}@example.com`;

      const res = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password: "password123",
            name: "Valid User",
            inviteCode: code,
          }),
        })
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        token: string;
        user: { id: string; email: string; name: string };
      };
      expect(body.user.email).toBe(email);
      expect(body.user.name).toBe("Valid User");

      // Verify invite record is updated in SQLite
      const [updatedInvite] = await db
        .select()
        .from(invites)
        .where(eq(invites.code, code));
      expect(updatedInvite.usedBy).toBe(body.user.id);
      expect(updatedInvite.usedAt).not.toBeNull();

      // Ensure that reusing this code is now rejected
      const resReuse = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `reuse-${Date.now()}@example.com`,
            password: "password123",
            name: "Reuse User",
            inviteCode: code,
          }),
        })
      );

      expect(resReuse.status).toBe(400);
      const reuseData = (await resReuse.json()) as { message: string };
      expect(reuseData.message).toBe("This invite code has already been used");
    });

    it("sign-in returns session cookie and set-auth-token header", async () => {
      const { code } = await createTestInvite();
      const email = `signin-${Date.now()}@example.com`;
      const password = "securePassword123!";

      // Sign up
      const signupRes = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name: "Sign In User",
            inviteCode: code,
          }),
        })
      );
      expect(signupRes.status).toBe(200);

      // Sign in
      const signinRes = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
          }),
        })
      );

      expect(signinRes.status).toBe(200);

      const cookieHeader = signinRes.headers.get("set-cookie");
      const bearerHeader = signinRes.headers.get("set-auth-token");

      expect(cookieHeader).not.toBeNull();
      expect(cookieHeader).toContain("better-auth.session_token");
      expect(bearerHeader).not.toBeNull();
      expect(typeof bearerHeader).toBe("string");
    });

    it("accepts cross-origin auth requests with trusted Origin header http://localhost:3000", async () => {
      const email = `origin-trusted-${Date.now()}@example.com`;
      const res = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://localhost:3000",
          },
          body: JSON.stringify({
            email,
            password: "password123",
            name: "Trusted Origin User",
          }),
        })
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as {
        token: string;
        user: { id: string; email: string; name: string };
      };
      expect(data.user.email).toBe(email);
      expect(data.user.name).toBe("Trusted Origin User");
      expect(res.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    });

    it("rejects cross-origin auth requests from untrusted origins with 403 INVALID_ORIGIN", async () => {
      const email = `origin-untrusted-${Date.now()}@example.com`;
      const res = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "http://untrusted-attacker.com",
          },
          body: JSON.stringify({
            email,
            password: "password123",
            name: "Untrusted User",
          }),
        })
      );

      expect(res.status).toBe(403);
      const data = (await res.json()) as { message?: string; code?: string };
      expect(data.code).toBe("INVALID_ORIGIN");
    });
  });

  describe("Protected /me routes (GET and PATCH)", () => {
    it("GET /me rejects unauthenticated request with 401", async () => {
      const res = await app.handle(new Request("http://localhost:3001/me"));
      expect(res.status).toBe(401);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Unauthorized");
    });

    it("GET /me rejects invalid bearer token with 401", async () => {
      const res = await app.handle(
        new Request("http://localhost:3001/me", {
          headers: {
            Authorization: "Bearer invalid-token-xyz",
          },
        })
      );
      expect(res.status).toBe(401);
    });

    it("GET /me succeeds with session cookie and returns user profile", async () => {
      const { code } = await createTestInvite();
      const email = `cookie-me-${Date.now()}@example.com`;
      const password = "password123";

      const signupRes = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name: "Cookie User",
            inviteCode: code,
          }),
        })
      );
      expect(signupRes.status).toBe(200);
      const cookie = signupRes.headers.get("set-cookie");
      expect(cookie).not.toBeNull();

      const meRes = await app.handle(
        new Request("http://localhost:3001/me", {
          headers: {
            Cookie: cookie!,
          },
        })
      );

      expect(meRes.status).toBe(200);
      const profile = (await meRes.json()) as {
        id: string;
        name: string;
        email: string;
        timezone: string;
        preferences: Record<string, unknown>;
        twoFactorEnabled: boolean;
      };

      expect(profile.email).toBe(email);
      expect(profile.name).toBe("Cookie User");
      expect(profile.timezone).toBe("UTC");
      expect(typeof profile.preferences).toBe("object");
      expect(profile.twoFactorEnabled).toBe(false);
    });

    it("GET /me succeeds with Bearer token", async () => {
      const { code } = await createTestInvite();
      const email = `bearer-me-${Date.now()}@example.com`;
      const password = "password123";

      const signupRes = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name: "Bearer User",
            inviteCode: code,
          }),
        })
      );
      expect(signupRes.status).toBe(200);

      const signinRes = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
      );
      expect(signinRes.status).toBe(200);
      const token = signinRes.headers.get("set-auth-token");
      expect(token).not.toBeNull();

      const meRes = await app.handle(
        new Request("http://localhost:3001/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
      );

      expect(meRes.status).toBe(200);
      const profile = (await meRes.json()) as {
        id: string;
        name: string;
        email: string;
        timezone: string;
      };
      expect(profile.email).toBe(email);
      expect(profile.name).toBe("Bearer User");
    });

    it("PATCH /me updates name, timezone, and preferences", async () => {
      const { code } = await createTestInvite();
      const email = `patch-me-${Date.now()}@example.com`;
      const password = "password123";

      const signupRes = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-up/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            name: "Original Name",
            inviteCode: code,
          }),
        })
      );
      expect(signupRes.status).toBe(200);

      const signinRes = await app.handle(
        new Request("http://localhost:3001/api/auth/sign-in/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        })
      );
      const token = signinRes.headers.get("set-auth-token");
      expect(token).not.toBeNull();

      // Perform PATCH /me
      const patchRes = await app.handle(
        new Request("http://localhost:3001/me", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            name: "Updated Name",
            timezone: "America/New_York",
            preferences: {
              theme: "dark",
              accent: "#3b82f6",
              dailyDigestTime: "09:00",
            },
          }),
        })
      );

      expect(patchRes.status).toBe(200);
      const patchedProfile = (await patchRes.json()) as {
        name: string;
        timezone: string;
        preferences: { theme: string; accent: string; dailyDigestTime: string };
      };

      expect(patchedProfile.name).toBe("Updated Name");
      expect(patchedProfile.timezone).toBe("America/New_York");
      expect(patchedProfile.preferences.theme).toBe("dark");
      expect(patchedProfile.preferences.accent).toBe("#3b82f6");
      expect(patchedProfile.preferences.dailyDigestTime).toBe("09:00");

      // Verify GET /me returns the updated profile
      const verifyRes = await app.handle(
        new Request("http://localhost:3001/me", {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        })
      );

      expect(verifyRes.status).toBe(200);
      const verifiedProfile = (await verifyRes.json()) as {
        name: string;
        timezone: string;
        preferences: { theme: string; accent: string; dailyDigestTime: string };
      };

      expect(verifiedProfile.name).toBe("Updated Name");
      expect(verifiedProfile.timezone).toBe("America/New_York");
      expect(verifiedProfile.preferences.theme).toBe("dark");
    });
  });
});
