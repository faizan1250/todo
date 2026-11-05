"use client";

import * as React from "react";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, LocateFixed, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { searchGeocode, type GeocodeResult } from "@/lib/api";

const PlaceMap = dynamic(() => import("./PlaceMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[180px] items-center justify-center rounded-lg border border-[#E4E8F2] bg-[#F2F5FC]/60 text-xs text-[#5B6478] dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3]">
      Loading map…
    </div>
  ),
});

export interface PlacePick {
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

interface PlacePickerProps {
  initialName?: string | null;
  initialLat?: number | null;
  initialLng?: number | null;
  initialRadiusM?: number | null;
  onPick: (pick: PlacePick) => void;
  onSave: (pick: PlacePick) => void;
  isSaving?: boolean;
}

const RADIUS_STEPS = [100, 200, 500, 1000, 2000];
const DEFAULT_CENTER: [number, number] = [40.7128, -74.006];

export function PlacePicker({
  initialName,
  initialLat,
  initialLng,
  initialRadiusM,
  onPick,
  onSave,
  isSaving = false,
}: PlacePickerProps) {
  const t = copy.scheduling.places;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [name, setName] = useState(initialName || "");
  const [pin, setPin] = useState<[number, number] | null>(
    initialLat != null && initialLng != null ? [initialLat, initialLng] : null
  );
  const [radiusM, setRadiusM] = useState(initialRadiusM ?? 200);
  const [isLocating, setIsLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      searchGeocode(query)
        .then((r) => setResults(r))
        .catch(() => setResults([]))
        .finally(() => setIsSearching(false));
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [query]);

  const handleUseCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      setLocateError(t.locationDenied);
      return;
    }
    setIsLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPin([pos.coords.latitude, pos.coords.longitude]);
        setIsLocating(false);
      },
      () => {
        setLocateError(t.locationDenied);
        setIsLocating(false);
      },
      { timeout: 10000 }
    );
  };

  const pick: PlacePick | null =
    pin !== null
      ? { name: name.trim() || "Current spot", lat: pin[0], lng: pin[1], radiusM }
      : null;

  return (
    <div className="space-y-2.5">
      <div>
        <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
          {t.searchLabel}
        </label>
        <div className="relative mt-1 flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-[#5B6478] dark:text-[#9BB0D3]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            aria-label={t.searchLabel}
            className="w-full rounded border border-[#E4E8F2] bg-white py-1 pl-8 pr-2 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
          />
          {isSearching && <Loader2 className="absolute right-2.5 h-3.5 w-3.5 animate-spin text-[#5B6478]" />}
        </div>
        {results.length > 0 && (
          <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto" aria-label={t.searchLabel}>
            {results.map((r) => (
              <li key={`${r.lat},${r.lng}`}>
                <button
                  type="button"
                  onClick={() => {
                    setPin([r.lat, r.lng]);
                    setName(r.name.split(",")[0]);
                    setResults([]);
                    setQuery("");
                  }}
                  className="w-full truncate rounded px-2 py-1 text-left text-xs text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363] cursor-pointer"
                >
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <button
          type="button"
          onClick={handleUseCurrentLocation}
          disabled={isLocating}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E4E8F2] bg-white px-2.5 py-1 text-xs font-medium text-[#5B6478] transition-colors hover:bg-[#F2F5FC] disabled:opacity-50 dark:border-[#132E74] dark:bg-[#082363] dark:text-[#9BB0D3] cursor-pointer"
        >
          {isLocating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <LocateFixed className="h-3.5 w-3.5" />
          )}
          {isLocating ? t.locating : t.useCurrentLocation}
        </button>
        <p className="mt-1 text-[11px] text-[#5B6478]/80 dark:text-[#9BB0D3]/70">{t.locationPermission}</p>
        {locateError && (
          <p role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
            {locateError}
          </p>
        )}
      </div>

      {pin && (
        <>
          <PlaceMap lat={pin[0]} lng={pin[1]} radiusM={radiusM} onMove={(la, ln) => setPin([la, ln])} />
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
              {t.placeNameLabel}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.placeNameLabel}
              className="mt-1 w-full rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
            />
          </div>
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-[#5B6478] dark:text-[#9BB0D3]">
              {t.radiusLabel}: <span className="font-mono font-bold">{t.radiusValue(radiusM)}</span>
            </label>
            <div className="mt-1 flex flex-wrap gap-1">
              {RADIUS_STEPS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRadiusM(r)}
                  aria-pressed={radiusM === r}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs cursor-pointer transition-colors",
                    radiusM === r
                      ? "bg-emerald-600 font-bold text-white dark:bg-emerald-500"
                      : "bg-[#F2F5FC] text-[#5B6478] hover:bg-[#E4E8F2] dark:bg-[#082363] dark:text-[#9BB0D3]"
                  )}
                >
                  {t.radiusValue(r)}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => pick && onPick(pick)}
              disabled={!pick}
              className="flex-1 rounded-lg bg-emerald-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50 dark:bg-emerald-500 cursor-pointer"
            >
              {t.useSpot}
            </button>
            <button
              type="button"
              onClick={() => pick && onSave(pick)}
              disabled={!pick || isSaving}
              className="flex-1 rounded-lg border border-emerald-600 px-2 py-1.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-950/40 cursor-pointer"
            >
              {isSaving ? "Saving…" : t.savePlace}
            </button>
          </div>
        </>
      )}

      <p className="border-t border-[#E4E8F2] pt-2 text-[11px] leading-relaxed text-[#5B6478]/80 dark:border-[#132E74] dark:text-[#9BB0D3]/70">
        {t.webNote} {t.privacy}
      </p>
    </div>
  );
}
