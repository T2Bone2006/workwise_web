'use client';

import { useEffect } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';

export type CustomerPlace = {
  id: string;
  title: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
};

const PIN = {
  color: '#0369a1',
  weight: 2,
  fillColor: '#0c66e4',
  fillOpacity: 0.9,
};

function FitPlaces({ places, padding }: { places: CustomerPlace[]; padding: number }) {
  const map = useMap();
  useEffect(() => {
    if (places.length === 0) return;
    if (places.length === 1) {
      map.setView([places[0]!.lat, places[0]!.lng], 15);
      return;
    }
    const bounds = L.latLngBounds(places.map((place) => [place.lat, place.lng]));
    map.fitBounds(bounds, { padding: [padding, padding] });
  }, [map, places, padding]);
  return null;
}

/** `compact` is the short, wide strip in the customer header: no zoom buttons, tighter fit. */
export function CustomerPlacesMap({
  places,
  compact = false,
  className,
}: {
  places: CustomerPlace[];
  compact?: boolean;
  className?: string;
}) {
  const first = places[0];
  if (!first) return null;

  return (
    <div
      className={cn(
        'relative z-0 isolate w-full min-w-0 overflow-hidden rounded-lg border border-sky-200/80 bg-sky-50 dark:border-sky-900/50 dark:bg-sky-950/20',
        compact ? 'h-28' : 'h-[280px]',
        className,
      )}
    >
      <MapContainer
        center={[first.lat, first.lng]}
        zoom={14}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={false}
        zoomControl={!compact}
        className="h-full w-full"
      >
        <TileLayer
          attribution='Tiles &copy; Esri'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          maxZoom={16}
        />
        <FitPlaces places={places} padding={compact ? 18 : 36} />
        {places.map((place) => (
          <CircleMarker
            key={place.id}
            center={[place.lat, place.lng]}
            radius={11}
            pathOptions={PIN}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-medium">{place.title}</p>
                <p className="text-muted-foreground">{place.address}</p>
                <p className="text-muted-foreground">{place.postcode}</p>
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
