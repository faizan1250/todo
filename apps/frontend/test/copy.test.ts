import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BANNED = [
  "api",
  "token",
  "jwt",
  "oauth",
  "endpoint",
  "payload",
  "schema",
  "database",
  "sql",
  "mutation",
  "query",
  "cache",
  "webhook",
  "sdk",
  "cli",
  "json",
  "http",
  "url",
  "uri",
  "backend",
  "frontend",
  "server",
  "request",
  "response",
  "parameter",
  "variable",
  "function",
  "class",
  "module",
  "component",
  "props",
  "render",
  "compile",
  "deploy",
  "repository",
  "git",
  "commit",
  "branch",
  "merge",
  "npm",
  "bun",
  "node",
  "typescript",
  "javascript",
  "react",
  "next",
  "elysia",
  "session",
  "credentials",
  "validation",
];

describe("copy dictionary", () => {
  it("contains no banned technical words", () => {
    const path = join(process.cwd(), "src", "lib", "copy.ts");
    const content = readFileSync(path, "utf8").toLowerCase();
    for (const word of BANNED) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      expect(re.test(content)).toBe(false);
    }
  });

  it("exports a copy object with auth, onboarding, and account sections", async () => {
    const mod = await import("../src/lib/copy");
    expect(mod.copy.auth).toBeDefined();
    expect(mod.copy.onboarding).toBeDefined();
    expect(mod.copy.account).toBeDefined();
  });
});