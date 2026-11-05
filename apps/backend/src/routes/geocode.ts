import { Elysia, t } from "elysia";
import { authMacro } from "../plugins/auth-macro";

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
}

interface CacheEntry {
  expiresAt: number;
  results: GeocodeResult[];
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 200;
const PHOTON_URL = "https://photon.komoot.io/api/";
const USER_AGENT = "TodoApp/1.0 (geocode-proxy)";
const RESULT_LIMIT = 5;

const cache = new Map<string, CacheEntry>();

export function clearGeocodeCache(): void {
  cache.clear();
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase();
}

function getCached(key: string): GeocodeResult[] | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.results;
}

function setCached(key: string, results: GeocodeResult[]): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, results });
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

export function mapPhotonResponse(payload: unknown): GeocodeResult[] {
  if (typeof payload !== "object" || payload === null) return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  const out: GeocodeResult[] = [];
  for (const f of features) {
    const feature = f as PhotonFeature;
    const coords = feature.geometry?.coordinates;
    const props = feature.properties;
    if (
      !Array.isArray(coords) ||
      typeof coords[0] !== "number" ||
      typeof coords[1] !== "number" ||
      !props ||
      typeof props.name !== "string" ||
      !props.name
    ) {
      continue;
    }
    const extras = [props.city, props.country].filter(
      (p): p is string => typeof p === "string" && p.length > 0 && p !== props.name
    );
    out.push({ name: [props.name, ...extras].join(", "), lat: coords[1], lng: coords[0] });
    if (out.length >= RESULT_LIMIT) break;
  }
  return out;
}

export const geocodeRoutes = new Elysia({ prefix: "/api/v1/geocode" })
  .use(authMacro)
  .get(
    "/",
    async ({ query: { q }, status }) => {
      const raw = (q ?? "").trim();
      if (raw.length < 2) {
        return status(400, { error: "Query must be at least 2 characters" });
      }
      if (raw.length > 200) {
        return status(400, { error: "Query too long" });
      }
      const key = normalizeQuery(raw);
      const cached = getCached(key);
      if (cached) return cached;

      let payload: unknown;
      try {
        const res = await fetch(
          `${PHOTON_URL}?q=${encodeURIComponent(raw)}&limit=${RESULT_LIMIT}`,
          {
            headers: {
              Accept: "application/json",
              "User-Agent": USER_AGENT,
            },
          }
        );
        if (!res.ok) {
          return status(502, { error: "Place search is unavailable right now" });
        }
        payload = await res.json();
      } catch {
        return status(502, { error: "Place search is unavailable right now" });
      }

      const results = mapPhotonResponse(payload);
      setCached(key, results);
      return results;
    },
    {
      auth: true,
      query: t.Object({
        q: t.Optional(t.String()),
      }),
    }
  );
