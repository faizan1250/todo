import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, twoFactor } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { eq } from "drizzle-orm";
import { db } from "./db";
import * as schema from "./db/schema";

export const auth = betterAuth({
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3001",
  secret: process.env.BETTER_AUTH_SECRET ?? "dev-secret-key-change-in-production-todo-app",
  advanced: {
    database: {
      validateSchema: false,
    },
  },
  database: drizzleAdapter(db, {
    provider: "sqlite",
    schema: {
      user: schema.users,
      session: schema.sessions,
      account: schema.accounts,
      verification: schema.verifications,
      twoFactor: schema.twoFactors,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    twoFactor({
      issuer: "Todo App",
    }),
    bearer(),
  ],
  user: {
    additionalFields: {
      timezone: {
        type: "string",
        defaultValue: "UTC",
      },
      preferences: {
        type: "string",
        defaultValue: "{}",
      },
      role: {
        type: "string",
        defaultValue: "user",
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const body = ctx.body as Record<string, unknown> | undefined;
        const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : null;

        if (inviteCode) {
          const [invite] = await db
            .select()
            .from(schema.invites)
            .where(eq(schema.invites.code, inviteCode));

          if (!invite) {
            throw new APIError("BAD_REQUEST", {
              message: "Invalid invite code",
            });
          }

          if (invite.usedBy || invite.usedAt) {
            throw new APIError("BAD_REQUEST", {
              message: "This invite code has already been used",
            });
          }

          if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
            throw new APIError("BAD_REQUEST", {
              message: "This invite code has expired",
            });
          }
        }
      }
    }),
    after: createAuthMiddleware(async (ctx) => {
      if (ctx.path === "/sign-up/email") {
        const body = ctx.body as Record<string, unknown> | undefined;
        const inviteCode = typeof body?.inviteCode === "string" ? body.inviteCode.trim() : null;
        const ctxAny = ctx as unknown as { context?: { returned?: { user?: { id: string } } }; returned?: { user?: { id: string } } };
        const returned = ctxAny.context?.returned ?? ctxAny.returned;

        if (inviteCode && returned?.user?.id) {
          await db
            .update(schema.invites)
            .set({
              usedBy: returned.user.id,
              usedAt: new Date(),
            })
            .where(eq(schema.invites.code, inviteCode));
        }
      }
    }),
  },
});

export type Auth = typeof auth;
