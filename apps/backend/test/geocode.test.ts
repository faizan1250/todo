import { describe, expect, it, afterEach, mock } from "bun:test";
import { app } from "../src/index";
import { createAuthUser } from "./helpers";
import { clearGeocodeCache } from "../src/routes/geocode";

const PHOTON_PAYLOAD = {
  features: [
    {
      geometry: { coordinates: [-73.9857, 40.7484] },
      properties: { name: "Empire State Building", city: "New York", country: "United States" },
    },
    {
      geometry: { coordinates: [0, 0] },
      properties: { name: "" },
    },
    {
      geometry: {},
      properties: { name: "No Coords" },
    },
  ],
};

describe("GET /api/v1/geocode", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearGeocodeCache();
  });

  it("requires authentication", async () => {
    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/geocode?q=paris")
    );
    expect(res.status).toBe(401);
  });

  it("rejects missing or short queries", async () => {
    const { authHeaders } = await createAuthUser("GeocodeAuth");

    const missing = await app.handle(
      new Request("http://localhost:3001/api/v1/geocode", {
        headers: authHeaders,
      })
    );
    expect(missing.status).toBe(400);

    const short = await app.handle(
      new Request("http://localhost:3001/api/v1/geocode?q=a", {
        headers: authHeaders,
      })
    );
    expect(short.status).toBe(400);
  });

  it("proxies Photon and returns [{ name, lat, lng }]", async () => {
    const { authHeaders } = await createAuthUser("GeocodeUser");
    const fetchMock = mock(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      expect(urlStr.startsWith("https://photon.komoot.io/api/")).toBe(true);
      expect(urlStr).toContain("q=empire");
      return new Response(JSON.stringify(PHOTON_PAYLOAD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/geocode?q=empire", {
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ name: string; lat: number; lng: number }>;
    expect(body).toHaveLength(1);
    expect(body[0]).toEqual({
      name: "Empire State Building, New York, United States",
      lat: 40.7484,
      lng: -73.9857,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves repeats from the in-memory cache", async () => {
    const { authHeaders } = await createAuthUser("GeocodeCache");
    const fetchMock = mock(async () => {
      return new Response(JSON.stringify(PHOTON_PAYLOAD), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const first = await app.handle(
      new Request("http://localhost:3001/api/v1/geocode?q=Empire", {
        headers: authHeaders,
      })
    );
    expect(first.status).toBe(200);

    const second = await app.handle(
      new Request("http://localhost:3001/api/v1/geocode?q=  empire ", {
        headers: authHeaders,
      })
    );
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when the upstream search fails", async () => {
    const { authHeaders } = await createAuthUser("GeocodeDown");
    globalThis.fetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const res = await app.handle(
      new Request("http://localhost:3001/api/v1/geocode?q=berlin", {
        headers: authHeaders,
      })
    );
    expect(res.status).toBe(502);
  });
});
