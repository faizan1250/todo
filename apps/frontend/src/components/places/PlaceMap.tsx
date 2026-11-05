"use client";

import * as React from "react";
import { useMemo } from "react";
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const pinIcon = L.divIcon({
  className: "",
  html: `<span style="display:block;width:18px;height:18px;border-radius:9999px;background:#059669;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ClickToMove({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

interface PlaceMapProps {
  lat: number;
  lng: number;
  radiusM: number;
  onMove: (lat: number, lng: number) => void;
}

export default function PlaceMap({ lat, lng, radiusM, onMove }: PlaceMapProps) {
  const center = useMemo((): [number, number] => [lat, lng], [lat, lng]);
  const markerRef = React.useRef<L.Marker | null>(null);

  return (
    <div className="overflow-hidden rounded-lg border border-[#E4E8F2] dark:border-[#132E74]">
      <MapContainer
        center={center}
        zoom={15}
        scrollWheelZoom={false}
        style={{ height: 180, width: "100%" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickToMove onPick={onMove} />
        <Marker
          position={center}
          icon={pinIcon}
          draggable
          ref={markerRef}
          eventHandlers={{
            dragend() {
              const m = markerRef.current;
              if (!m) return;
              const p = m.getLatLng();
              onMove(p.lat, p.lng);
            },
          }}
        />
        <Circle center={center} radius={radiusM} pathOptions={{ color: "#059669", weight: 1.5, fillOpacity: 0.12 }} />
      </MapContainer>
    </div>
  );
}
