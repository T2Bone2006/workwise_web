/** An exact spot dropped on the map, or null when the form did not send one. */
export function pinOf(values: { pin_lat?: number | null; pin_lng?: number | null }) {
  return values.pin_lat != null && values.pin_lng != null
    ? { lat: values.pin_lat, lng: values.pin_lng }
    : null;
}

/** Two positions are the same spot to about a metre. */
export function samePin(
  a: { lat: number | null; lng: number | null },
  b: { lat: number; lng: number },
): boolean {
  return a.lat != null && a.lng != null && Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lng - b.lng) < 1e-5;
}
