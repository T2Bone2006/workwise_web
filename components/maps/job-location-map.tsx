'use client';

import { useEffect } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle,
  Popup,
  Polyline,
  useMap,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { cn } from '@/lib/utils';

interface JobLocationMapProps {
  jobLocation: {
    address: string;
    postcode: string;
    lat: number;
    lng: number;
  };
  workerLocation?: {
    name: string;
    postcode: string;
    lat: number;
    lng: number;
  };
  distance?: number;
}

function FitBounds({
  jobLat,
  jobLng,
  workerLat,
  workerLng,
}: {
  jobLat: number;
  jobLng: number;
  workerLat?: number;
  workerLng?: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (workerLat != null && workerLng != null) {
      const bounds = L.latLngBounds(
        [jobLat, jobLng],
        [workerLat, workerLng]
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, jobLat, jobLng, workerLat, workerLng]);

  return null;
}

const JOB_MARKER = {
  color: '#b91c1c',
  weight: 2,
  fillColor: '#dc2626',
  fillOpacity: 0.85,
};

const WORKER_MARKER = {
  color: '#4338ca',
  weight: 2,
  fillColor: '#4f46e5',
  fillOpacity: 0.85,
};

export function JobLocationMap({
  jobLocation,
  workerLocation,
  distance,
}: JobLocationMapProps) {
  const polylinePositions: [number, number][] =
    workerLocation != null
      ? [
          [jobLocation.lat, jobLocation.lng],
          [workerLocation.lat, workerLocation.lng],
        ]
      : [];

  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border/80 bg-card',
        'shadow-[var(--shadow-soft)] dark:border-white/[0.06]'
      )}
    >
      <div className="relative h-[400px] bg-muted/20">
        <MapContainer
          center={[jobLocation.lat, jobLocation.lng]}
          zoom={workerLocation ? 12 : 14}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom={true}
          className="rounded-lg"
        >
          <TileLayer
            attribution='&copy; <a href="https://carto.com/attributions">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
          />

          <CircleMarker
            center={[jobLocation.lat, jobLocation.lng]}
            radius={12}
            pathOptions={JOB_MARKER}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-medium text-foreground">Job</p>
                <p className="text-muted-foreground">{jobLocation.address}</p>
                <p className="text-muted-foreground">{jobLocation.postcode}</p>
              </div>
            </Popup>
          </CircleMarker>

          <Circle
            center={[jobLocation.lat, jobLocation.lng]}
            radius={500}
            pathOptions={{
              color: '#dc2626',
              weight: 1.5,
              fillColor: '#dc2626',
              fillOpacity: 0.12,
              dashArray: '6, 6',
            }}
          />

          {workerLocation != null && (
            <>
              <CircleMarker
                center={[workerLocation.lat, workerLocation.lng]}
                radius={12}
                pathOptions={WORKER_MARKER}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium text-foreground">Worker</p>
                    <p className="text-muted-foreground">{workerLocation.name}</p>
                    <p className="text-muted-foreground">{workerLocation.postcode}</p>
                    {distance != null && (
                      <p className="mt-1 font-medium text-primary">
                        {distance.toFixed(1)} km away
                      </p>
                    )}
                  </div>
                </Popup>
              </CircleMarker>

              {polylinePositions.length === 2 && (
                <Polyline
                  positions={polylinePositions}
                  pathOptions={{
                    color: '#4f46e5',
                    weight: 2,
                    opacity: 0.6,
                    dashArray: '8, 8',
                  }}
                />
              )}

              <FitBounds
                jobLat={jobLocation.lat}
                jobLng={jobLocation.lng}
                workerLat={workerLocation.lat}
                workerLng={workerLocation.lng}
              />
            </>
          )}
        </MapContainer>

        <div
          className={cn(
            'absolute bottom-3 right-3 z-[1000] flex gap-4 rounded-md border border-border/80 bg-card/95 px-3 py-2 text-xs backdrop-blur-sm',
            'shadow-[var(--shadow-soft)]'
          )}
        >
          <span className="flex items-center gap-2 text-muted-foreground">
            <span
              className="h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm dark:border-gray-900"
              style={{ backgroundColor: '#dc2626' }}
            />
            Job
          </span>
          {workerLocation != null && (
            <span className="flex items-center gap-2 text-muted-foreground">
              <span
                className="h-2.5 w-2.5 rounded-full border-2 border-white shadow-sm dark:border-gray-900"
                style={{ backgroundColor: '#4f46e5' }}
              />
              Worker
            </span>
          )}
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-dashed border-red-500/70 bg-transparent" />
            Service area
          </span>
        </div>
      </div>
    </div>
  );
}
