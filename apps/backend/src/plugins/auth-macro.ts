import { Elysia } from "elysia";
import { auth } from "../auth";

export const authMacro = new Elysia({ name: "auth-macro" }).macro({
  auth: {
    async resolve({ request: { headers }, status }) {
      const sessionData = await auth.api.getSession({ headers });

      if (!sessionData) {
        return status(401, { error: "Unauthorized" });
      }

      return {
        user: sessionData.user,
        session: sessionData.session,
      };
    },
  },
});
