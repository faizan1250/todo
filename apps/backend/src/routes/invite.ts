import { Elysia, t } from "elysia";
import { eq } from "drizzle-orm";
import { db } from "../db";
import * as schema from "../db/schema";

async function handleValidateInvite(codeRaw: string, status: (code: number, response?: unknown) => unknown) {
  const code = codeRaw.trim();

  const [invite] = await db
    .select()
    .from(schema.invites)
    .where(eq(schema.invites.code, code));

  if (!invite) {
    return status(404, {
      valid: false,
      reason: "Invite code not found",
      remainingUses: 0,
    });
  }

  if (invite.usedBy || invite.usedAt) {
    return status(400, {
      valid: false,
      reason: "Invite code has already been used",
      remainingUses: 0,
    });
  }

  if (invite.expiresAt && new Date(invite.expiresAt).getTime() <= Date.now()) {
    return status(400, {
      valid: false,
      reason: "Invite code has expired",
      remainingUses: 0,
    });
  }

  return {
    valid: true,
    remainingUses: 1,
    expiresAt: new Date(invite.expiresAt).toISOString(),
  };
}

export const inviteRoutes = new Elysia({ name: "routes-invite" })
  .post(
    "/api/invite/validate",
    async ({ body, status }) => {
      return handleValidateInvite(body.code, status);
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
      }),
    }
  )
  .post(
    "/invite/validate",
    async ({ body, status }) => {
      return handleValidateInvite(body.code, status);
    },
    {
      body: t.Object({
        code: t.String({ minLength: 1 }),
      }),
    }
  );
