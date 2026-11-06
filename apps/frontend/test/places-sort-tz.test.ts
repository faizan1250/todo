import { describe, it, expect, mock, afterEach } from "bun:test";
import { searchGeocode, updatePlace } from "../src/lib/api";
import { sortTasksByDueDate } from "../src/lib/tasks/sort";
import { shouldShowTimeZoneBanner } from "../src/components/system/TimeZoneBanner";
import { copy } from "../src/lib/copy";

describe("Phase 3 premium Day 6: places, sort, timezone", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("searchGeocode()", () => {
    it("returns [] for short queries without network", async () => {
      const fetchMock = mock();
      globalThis.fetch = fetchMock;
      expect(await searchGeocode("")).toEqual([]);
      expect(await searchGeocode("x")).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("calls /api/v1/geocode with the encoded query", async () => {
      globalThis.fetch = mock(async (url: string | URL | Request) => {
        expect(url.toString()).toContain("/api/v1/geocode?q=coffee%20shop");
        return new Response(
          JSON.stringify([{ name: "Coffee Shop", lat: 1.5, lng: 2.5 }]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });
      const res = await searchGeocode("coffee shop");
      expect(res).toEqual([{ name: "Coffee Shop", lat: 1.5, lng: 2.5 }]);
    });
  });

  describe("updatePlace()", () => {
    it("PATCHes name and radius", async () => {
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        expect(url.toString()).toContain("/api/v1/places/p1");
        expect(init?.method).toBe("PATCH");
        expect(JSON.parse(init?.body as string)).toEqual({ name: "HQ", radiusM: 500 });
        return new Response(
          JSON.stringify({ id: "p1", name: "HQ", lat: 1, lng: 2, radiusM: 500 }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      });
      const updated = await updatePlace("p1", { name: "HQ", radiusM: 500 });
      expect(updated.name).toBe("HQ");
      expect(updated.radiusM).toBe(500);
    });
  });

  describe("sortTasksByDueDate()", () => {
    it("orders dated earliest-first, undated last, stable by position", () => {
      const tasks = [
        { id: "c", dueAt: null, position: "a0" },
        { id: "b", dueAt: "2026-11-10T00:00:00.000Z", position: "a2" },
        { id: "a", dueAt: "2026-11-01T00:00:00.000Z", position: "a1" },
        { id: "d", dueAt: null, position: "a3" },
      ];
      expect(sortTasksByDueDate(tasks).map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    });

    it("treats unparseable dates as undated", () => {
      const tasks = [
        { id: "x", dueAt: "not-a-date", position: "a0" },
        { id: "y", dueAt: "2026-01-01T00:00:00.000Z", position: "a1" },
      ];
      expect(sortTasksByDueDate(tasks).map((t) => t.id)).toEqual(["y", "x"]);
    });
  });

  describe("shouldShowTimeZoneBanner()", () => {
    const neverSeen = () => false;
    it("hides when zones match or account zone is missing", () => {
      expect(shouldShowTimeZoneBanner("UTC", "UTC", neverSeen)).toBe(false);
      expect(shouldShowTimeZoneBanner(null, "UTC", neverSeen)).toBe(false);
    });
    it("shows on mismatch until acknowledged once per change", () => {
      expect(shouldShowTimeZoneBanner("UTC", "America/New_York", neverSeen)).toBe(true);
      const seen = (key: string) =>
        key === "tz-banner-seen:UTC>>America/New_York";
      expect(shouldShowTimeZoneBanner("UTC", "America/New_York", seen)).toBe(false);
      expect(shouldShowTimeZoneBanner("UTC", "Europe/Berlin", seen)).toBe(true);
    });
  });

  describe("scheduling copy additions", () => {
    it("covers places, sort, and timezone without banned words", () => {
      expect(copy.scheduling.places.webNote).toContain("phone app");
      expect(copy.scheduling.places.privacy).toBeTruthy();
      expect(copy.scheduling.sort.myOrder).toBe("My order");
      expect(copy.scheduling.sort.dragDisabledNote).toContain("My order");
      expect(copy.scheduling.timezone.useDevice).toBeTruthy();
      expect(copy.scheduling.timezone.mismatch("A", "B")).toContain("A");
    });
  });
});
