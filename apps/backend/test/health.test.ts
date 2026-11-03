import { describe, expect, it } from "bun:test";
import { app } from "../src/index";

describe("GET /health", () => {
  it("returns 200 and healthy status payload", async () => {
    const res = await app.handle(new Request("http://localhost:3001/health"));

    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it("includes CORS header for authorized frontend origin", async () => {
    const res = await app.handle(
      new Request("http://localhost:3001/health", {
        headers: {
          Origin: "http://localhost:3000",
        },
      })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000"
    );
  });

  it("handles preflight OPTIONS request for frontend origin", async () => {
    const res = await app.handle(
      new Request("http://localhost:3001/health", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:3000",
          "Access-Control-Request-Method": "GET",
        },
      })
    );

    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3000"
    );
  });

  it("returns 404 for non-existent route", async () => {
    const res = await app.handle(new Request("http://localhost:3001/non-existent"));
    expect(res.status).toBe(404);
  });
});
