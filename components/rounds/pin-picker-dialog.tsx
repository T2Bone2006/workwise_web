'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { Loader2, LocateFixed } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AddressAutocompleteInput } from '@/components/ui/address-autocomplete-input';
import type { LatLng, MapView } from '@/components/maps/pin-picker-map';

const PinPickerMap = dynamic(
  () => import('@/components/maps/pin-picker-map').then((mod) => mod.PinPickerMap),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-muted" aria-hidden="true" /> },
);

/** The middle of Britain, for when nothing is known yet. */
const UK_VIEW: MapView = { lat: 54.0, lng: -2.5, zoom: 6 };

export type PickedPin = { lat: number; lng: number; address: string; postcode: string };

/** What a postcode typed so far tells us: where to open the map. */
async function viewForPostcode(postcode: string): Promise<MapView | null> {
  const compact = postcode.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}\d{1,2}[A-Z]?\d[A-Z]{2}$/.test(compact)) return null;
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${compact}`);
    if (!response.ok) return null;
    const data = await response.json();
    const { latitude, longitude } = data?.result ?? {};
    return typeof latitude === 'number' && typeof longitude === 'number'
      ? { lat: latitude, lng: longitude, zoom: 17 }
      : null;
  } catch {
    return null;
  }
}

/**
 * "Not sure of the address?" Tap the map where the job is. The address and
 * postcode are worked out from the spot (and can be edited afterwards).
 * Search for a street or use your location to get the map close first.
 */
export function PinPickerDialog({
  open,
  onOpenChange,
  postcode,
  start,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** A postcode already typed in the form; the map opens there. */
  postcode?: string;
  /** A pin already dropped for this form; the map opens on it. */
  start?: LatLng | null;
  onPick: (pin: PickedPin) => void;
}) {
  const [view, setView] = useState<MapView>(UK_VIEW);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const opened = useRef(false);

  useEffect(() => {
    if (!open) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;
    setSearch('');
    setPin(start ?? null);
    if (start) {
      setView({ ...start, zoom: 18 });
      return;
    }
    setView(UK_VIEW);
    if (postcode) void viewForPostcode(postcode).then((found) => found && setView(found));
  }, [open, postcode, start]);

  function goToMyLocation() {
    if (!navigator.geolocation) {
      toast.error("This browser can't share your location.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false);
        setView({ lat: position.coords.latitude, lng: position.coords.longitude, zoom: 17 });
      },
      () => {
        setLocating(false);
        toast.error("Couldn't get your location. Search for a street instead.");
      },
      { timeout: 10_000 },
    );
  }

  async function usePin() {
    if (!pin) return;
    setSaving(true);
    try {
      const response = await fetch('/api/pin-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pin),
      });
      const data = await response.json();
      if (!response.ok) {
        toast.error(data?.error ?? "Couldn't look that spot up.");
        return;
      }
      onPick({ ...pin, address: data.address, postcode: data.postcode });
      onOpenChange(false);
    } catch {
      toast.error("Couldn't look that spot up. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Drop a pin where the job is</DialogTitle>
          <DialogDescription>
            Tap the map to place the pin. Zoom in for the right house. We fill in the address and
            postcode for you.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <AddressAutocompleteInput
              value={search}
              onValueChange={setSearch}
              onAddressSelect={(details) => {
                setSearch([details.address, details.postcode].filter(Boolean).join(', '));
                if (details.lat != null && details.lng != null) {
                  setView({ lat: details.lat, lng: details.lng, zoom: 18 });
                }
              }}
              placeholder="Search a street or area to jump there…"
              disabled={saving}
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={goToMyLocation}
            disabled={saving || locating}
            aria-label="Use my location"
          >
            {locating ? <Loader2 className="size-4 animate-spin" /> : <LocateFixed className="size-4" />}
          </Button>
        </div>

        <div className="relative z-0 isolate h-[340px] w-full overflow-hidden rounded-lg border bg-muted">
          <PinPickerMap view={view} pin={pin} onPin={setPin} />
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={usePin} disabled={!pin || saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {pin ? 'Use this spot' : 'Tap the map first'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
