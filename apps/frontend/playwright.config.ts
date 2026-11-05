import { defineConfig } from "@playwright/test";
import * as os from "node:os";
import * as path from "node:path";

// Shared SQLite file for the e2e backend, kept outside the repo so test
// runs never touch the dev database (`sqlite.db`).
const e2eDbFile = path.join(os.tmpdir(), "todo-playwright-e2e.db");

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "webkit", use: { browserName: "webkit" } }],
  webServer: [
    {
      // Fresh-ish backend DB per run: the file lives in the OS temp dir and
      // each suite uses unique user emails, so reruns cannot collide.
      command: "bun src/index.ts",
      cwd: "../backend",
      port: 3001,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: "3001",
        DB_FILE: e2eDbFile,
        BETTER_AUTH_SECRET: "playwright-e2e-secret",
        BETTER_AUTH_URL: "http://localhost:3001",
        FRONTEND_URL: "http://localhost:3000",
        NODE_ENV: "test",
      },
    },
    {
      command: "bun run dev",
      cwd: ".",
      port: 3000,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: {
        PORT: "3000",
        NEXT_PUBLIC_API_URL: "http://localhost:3001",
      },
    },
  ],
});
