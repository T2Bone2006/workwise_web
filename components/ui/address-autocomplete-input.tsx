'use client';

import * as React from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

type PlaceSuggestion = {
  placeId: string;
  text: string;
};

interface AddressAutocompleteInputProps {
  value: string;
  onValueChange: (value: string) => void;
  onAddressSelect: (details: { address: string; postcode: string }) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Address text input backed by Google Places (New) Autocomplete. Suggestions
 * appear as the user types; picking one fills the address and postcode
 * fields via `onAddressSelect`. Falls back to a plain text input (no
 * suggestions, no error shown) if the lookup fails — job creation must never
 * be blocked by Places being unavailable.
 */
export function AddressAutocompleteInput({
  value,
  onValueChange,
  onAddressSelect,
  placeholder,
  className,
  disabled,
}: AddressAutocompleteInputProps) {
  const [sessionToken, setSessionToken] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  const requestIdRef = React.useRef(0);

  React.useEffect(() => {
    setSessionToken(crypto.randomUUID());
  }, []);

  React.useEffect(() => {
    if (!sessionToken || value.trim().length < MIN_CHARS) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/address-autocomplete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input: value, sessionToken }),
        });
        if (requestId !== requestIdRef.current) return; // stale response
        const data = await res.json();
        const results: PlaceSuggestion[] = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(results);
        setOpen(results.length > 0);
      } catch {
        if (requestId === requestIdRef.current) {
          setSuggestions([]);
          setOpen(false);
        }
      } finally {
        if (requestId === requestIdRef.current) setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, sessionToken]);

  async function handleSelect(suggestion: PlaceSuggestion) {
    setOpen(false);
    setResolving(true);
    try {
      const res = await fetch('/api/address-details', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ placeId: suggestion.placeId, sessionToken }),
      });
      if (res.ok) {
        const details = await res.json();
        onAddressSelect({
          address: details.address ?? suggestion.text,
          postcode: details.postcode ?? '',
        });
      } else {
        // Details lookup failed — still fill in the suggestion text so the
        // user isn't left with nothing after picking a result.
        onValueChange(suggestion.text);
      }
    } catch {
      onValueChange(suggestion.text);
    } finally {
      setResolving(false);
      setSuggestions([]);
      // A session ends once a place is selected — start a fresh one for the
      // next lookup so billing groups correctly.
      setSessionToken(crypto.randomUUID());
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="relative">
          <Input
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onFocus={() => {
              if (suggestions.length > 0) setOpen(true);
            }}
            placeholder={placeholder}
            className={className}
            disabled={disabled}
            autoComplete="off"
          />
          {(loading || resolving) && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-1"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <ul className="max-h-64 overflow-y-auto">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onClick={() => void handleSelect(s)}
                className={cn(
                  'flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm',
                  'hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="line-clamp-2">{s.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
