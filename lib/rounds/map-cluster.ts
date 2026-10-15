import type { MapPlace } from '@/lib/rounds/map-areas';

export type PlaceGroup = {
  key: string;
  /** Where to draw it: the middle of its members. */
  lat: number;
  lng: number;
  members: MapPlace[];
};

const TILE_SIZE = 256;
const MAX_LAT = 85.0511;

/** Where a point sits on the world map at this zoom, in screen pixels. */
function worldPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * 2 ** zoom;
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * Pins closer than about `cellPx` on screen share a bubble with a count.
 * Singles stay as pins. Same input and zoom always give the same groups.
 */
export function groupPlaces(places: MapPlace[], zoom: number, cellPx = 44): PlaceGroup[] {
  const cells = new Map<string, MapPlace[]>();
  for (const place of places) {
    const { x, y } = worldPixel(place.lat, place.lng, zoom);
    const key = `${Math.floor(x / cellPx)}:${Math.floor(y / cellPx)}`;
    const list = cells.get(key);
    if (list) list.push(place);
    else cells.set(key, [place]);
  }
  return [...cells.entries()].map(([key, members]) => ({
    key: members.length === 1 ? members[0]!.id : `${key}@${members.length}`,
    lat: members.reduce((sum, m) => sum + m.lat, 0) / members.length,
    lng: members.reduce((sum, m) => sum + m.lng, 0) / members.length,
    members,
  }));
}
