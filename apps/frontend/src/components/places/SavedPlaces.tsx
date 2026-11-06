"use client";

import * as React from "react";
import { useState } from "react";
import { Check, Loader2, MapPin, Pencil, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { copy } from "@/lib/copy";
import { deletePlace, updatePlace, type BackendPlace } from "@/lib/api";

interface SavedPlacesModalProps {
  isOpen: boolean;
  onClose: () => void;
  places: BackendPlace[];
  onChanged: (places: BackendPlace[]) => void;
  onSelect?: (place: BackendPlace) => void;
}

export function SavedPlacesModal({ isOpen, onClose, places, onChanged, onSelect }: SavedPlacesModalProps) {
  const t = copy.scheduling.places;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editRadius, setEditRadius] = useState(200);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const startEdit = (place: BackendPlace) => {
    setEditingId(place.id);
    setEditName(place.name);
    setEditRadius(place.radiusM);
    setError(null);
  };

  const handleSaveEdit = async (place: BackendPlace) => {
    const trimmed = editName.trim();
    if (!trimmed) return;
    setIsBusy(true);
    setError(null);
    try {
      const updated = await updatePlace(place.id, { name: trimmed, radiusM: editRadius });
      onChanged(places.map((p) => (p.id === place.id ? updated : p)));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async (place: BackendPlace) => {
    if (!window.confirm(t.removePlaceConfirm(place.name))) return;
    setIsBusy(true);
    setError(null);
    try {
      await deletePlace(place.id);
      onChanged(places.filter((p) => p.id !== place.id));
      if (editingId === place.id) setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save. Try again.");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.managePlaces}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-150"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md max-h-[85vh] flex flex-col rounded-2xl border border-[#CAD5E8] dark:border-[#16367F] bg-white dark:bg-[#051A4D] shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#E4E8F2] dark:border-[#132E74] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400">
              <MapPin className="h-5 w-5" />
            </div>
            <h2 className="text-base font-bold text-[#0B1220] dark:text-white">{t.managePlaces}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363] cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {error && (
            <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {error}
            </p>
          )}
          {places.length === 0 && (
            <p className="py-6 text-center text-xs italic text-[#5B6478]/70 dark:text-[#9BB0D3]/60">
              {t.noSavedPlaces}
            </p>
          )}
          {places.map((place) => {
            const isEditing = editingId === place.id;
            return (
              <div
                key={place.id}
                className="rounded-xl border border-[#E4E8F2] p-2.5 dark:border-[#132E74]"
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label={t.renamePlace}
                      maxLength={100}
                      className="w-full rounded border border-[#E4E8F2] bg-white px-2 py-1 text-xs text-[#0B1220] focus:outline-none focus:ring-1 focus:ring-[#FD91CC] dark:border-[#132E74] dark:bg-[#082363] dark:text-white"
                    />
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-[#5B6478] dark:text-[#9BB0D3]">{t.radiusLabel}:</span>
                      {[100, 200, 500, 1000].map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setEditRadius(r)}
                          aria-pressed={editRadius === r}
                          className={cn(
                            "rounded px-2 py-0.5 font-mono text-[11px] cursor-pointer",
                            editRadius === r
                              ? "bg-emerald-600 font-bold text-white"
                              : "bg-[#F2F5FC] text-[#5B6478] dark:bg-[#082363] dark:text-[#9BB0D3]"
                          )}
                        >
                          {t.radiusValue(r)}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSaveEdit(place)}
                        disabled={isBusy || !editName.trim()}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50 cursor-pointer"
                      >
                        {isBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        {t.saved}
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg border border-[#E4E8F2] px-2 py-1 text-xs text-[#5B6478] dark:border-[#132E74] dark:text-[#9BB0D3] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-[#0B1220] dark:text-white">{place.name}</p>
                      <p className="font-mono text-[10px] text-[#5B6478]/70 dark:text-[#9BB0D3]/60">
                        {place.lat.toFixed(4)}, {place.lng.toFixed(4)} • {t.radiusValue(place.radiusM)}
                      </p>
                    </div>
                    {onSelect && (
                      <button
                        type="button"
                        onClick={() => {
                          onSelect(place);
                          onClose();
                        }}
                        className="rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        {t.usePlace}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => startEdit(place)}
                      aria-label={`Rename ${place.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#5B6478] hover:bg-[#F2F5FC] dark:text-[#9BB0D3] dark:hover:bg-[#082363] cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(place)}
                      disabled={isBusy}
                      aria-label={`${t.removePlace} ${place.name}`}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[#5B6478] hover:bg-rose-50 hover:text-rose-600 dark:text-[#9BB0D3] dark:hover:bg-rose-950/40 dark:hover:text-rose-400 cursor-pointer disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="border-t border-[#E4E8F2] px-5 py-3 text-[11px] leading-relaxed text-[#5B6478]/80 dark:border-[#132E74] dark:text-[#9BB0D3]/70">
          {t.webNote} {t.privacy}
        </p>
      </div>
    </div>
  );
}
