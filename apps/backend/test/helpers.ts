import { app } from "../src/index";

export async function createAuthUser(namePrefix = "User") {
  const email = `${namePrefix.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  const password = "Password123!";
  const name = `${namePrefix} ${Date.now()}`;

  const signupRes = await app.handle(
    new Request("http://localhost:3001/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    })
  );

  if (signupRes.status !== 200) {
    throw new Error(`Failed to create test user: ${signupRes.status} ${await signupRes.text()}`);
  }

  const data = (await signupRes.json()) as {
    token: string;
    user: { id: string; email: string; name: string };
  };
  const token = signupRes.headers.get("set-auth-token") || data.token;

  return {
    token,
    user: data.user,
    authHeaders: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  };
}
