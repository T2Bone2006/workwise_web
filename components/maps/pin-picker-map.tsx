'use client';

import { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export type LatLng = { lat: number; lng: number };
export type MapView = LatLng & { zoom: number };

const PIN = { color: '#ffffff', weight: 3, fillColor: '#0c66e4', fillOpacity: 1 };

function Clicks({ onPin }: { onPin: (spot: LatLng) => void }) {
  useMapEvents({ click: (event) => onPin({ lat: event.latlng.lat, lng: event.latlng.lng }) });
  return null;
}

/** Moves the map when `view` changes, and re-measures it (it opens inside an animating dialog). */
function Follow({ view }: { view: MapView }) {
  const map = useMap();
  useEffect(() => {
    const timer = setTimeout(() => {
      map.invalidateSize();
      map.setView([view.lat, view.lng], view.zoom);
    }, 120);
    return () => clearTimeout(timer);
  }, [map, view]);
  return null;
}

/** A street map you tap to drop (or move) one pin. Loaded only on the client. */
export function PinPickerMap({
  view,
  pin,
  onPin,
}: {
  view: MapView;
  pin: LatLng | null;
  onPin: (spot: LatLng) => void;
}) {
  return (
    <MapContainer
      center={[view.lat, view.lng]}
      zoom={view.zoom}
      style={{ height: '100%', width: '100%' }}
      scrollWheelZoom
      className="h-full w-full"
    >
      <TileLayer
        attribution="Tiles &copy; Esri"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
      <Follow view={view} />
      <Clicks onPin={onPin} />
      {pin ? <CircleMarker center={[pin.lat, pin.lng]} radius={11} pathOptions={PIN} /> : null}
    </MapContainer>
  );
}
