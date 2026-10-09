'use client';

import { useEffect } from 'react';
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapCard } from '@/lib/assistant/shared';

const STATUS_FILL: Record<MapCard['stops'][number]['status'], string> = {
  to_do: '#0C66E4',
  done: '#059669',
  skipped: '#94A3B8',
  other: '#94A3B8',
};

function numberIcon(order: number, status: MapCard['stops'][number]['status']) {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: `<span style="display:flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:9999px;background:${STATUS_FILL[status]};color:#fff;font:600 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(10,26,46,.35)">${order}</span>`,
  });
}

function dotIcon(status: MapCard['stops'][number]['status']) {
  return L.divIcon({
    className: '',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    html: `<span style="display:block;width:16px;height:16px;border-radius:9999px;background:${STATUS_FILL[status]};border:2px solid #fff;box-shadow:0 1px 3px rgba(10,26,46,.35)"></span>`,
  });
}

function Fit({ stops }: { stops: MapCard['stops'] }) {
  const map = useMap();
  useEffect(() => {
    if (stops.length === 1) {
      map.setView([stops[0]!.lat, stops[0]!.lng], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(stops.map((s) => [s.lat, s.lng])), { padding: [28, 28] });
  }, [map, stops]);
  return null;
}

/** A day's stops in round order: numbered pins joined by a line. */
export default function RouteMap({ stops, numbered = true }: { stops: MapCard['stops']; numbered?: boolean }) {
  const first = stops[0];
  if (!first) return null;
  return (
    <div className="relative isolate z-0 h-[300px] w-full overflow-hidden rounded-xl border border-border">
      <MapContainer center={[first.lat, first.lng]} zoom={14} scrollWheelZoom={false} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          attribution="Tiles &copy; Esri"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
        />
        <Fit stops={stops} />
        {numbered ? (
          <Polyline positions={stops.map((s) => [s.lat, s.lng])} pathOptions={{ color: '#0C66E4', weight: 2, opacity: 0.45, dashArray: '4 6' }} />
        ) : null}
        {stops.map((s) => (
          <Marker key={s.id} position={[s.lat, s.lng]} icon={numbered ? numberIcon(s.order, s.status) : dotIcon(s.status)}>
            <Popup>
              <div className="text-sm">
                <p className="font-medium">
                  {numbered ? `${s.order}. ` : ''}
                  {s.customer}
                </p>
                <p className="text-muted-foreground">{s.address}</p>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
