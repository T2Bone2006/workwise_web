'use client';

import * as React from 'react';
import { Loader2, MapPin } from 'lucide-react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const DEBOUNCE_MS = 300;
const MIN_CHARS = 3;

/**
 * Chrome's saved-address menu ignores autocomplete="off" and classifies a
 * field from the words address, postcode and street in its label, placeholder
 * or name. That menu is drawn over the box. A zero-width non-joiner keeps the
 * word looking the same and stops the match.
 */
export function unhookChromeAddressFill(text: string): string {
  return text.replace(
    /addresses|address|postcodes|postcode|streets|street|postal|zip/gi,
    (word) => `${word[0]}\u200c${word.slice(1)}`,
  );
}

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
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
}

/**
 * Address text input backed by Google Places (New) Autocomplete. Suggestions
 * appear only while the user is typing; a prefilled or just-selected address
 * does not open the list. Picking one fills the address and postcode fields
 * via `onAddressSelect`. Falls back to a plain text input (no suggestions, no
 * error shown) if the lookup fails — job creation must never be blocked by
 * Places being unavailable.
 */
export function AddressAutocompleteInput({
  value,
  onValueChange,
  onAddressSelect,
  placeholder,
  className,
  disabled,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: AddressAutocompleteInputProps) {
  const [sessionToken, setSessionToken] = React.useState('');
  const [suggestions, setSuggestions] = React.useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [resolving, setResolving] = React.useState(false);
  // Null until the user types. A prefilled value, or one just written by a
  // selection, must not start a search.
  const [typed, setTyped] = React.useState<string | null>(null);
  const requestIdRef = React.useRef(0);
  const focusedRef = React.useRef(false);
  const fieldName = React.useId().replace(/:/g, '');

  React.useEffect(() => {
    setSessionToken(crypto.randomUUID());
  }, []);

  React.useEffect(() => {
    if (typed === null || !sessionToken || typed.trim().length < MIN_CHARS) {
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
          body: JSON.stringify({ input: typed, sessionToken }),
        });
        if (requestId !== requestIdRef.current) return; // stale response
        const data = await res.json();
        const results: PlaceSuggestion[] = Array.isArray(data.suggestions) ? data.suggestions : [];
        setSuggestions(results);
        setOpen(focusedRef.current && results.length > 0);
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
  }, [typed, sessionToken]);

  async function handleSelect(suggestion: PlaceSuggestion) {
    requestIdRef.current += 1;
    setOpen(false);
    setTyped(null);
    setSuggestions([]);
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
      // A session ends once a place is selected — start a fresh one for the
      // next lookup so billing groups correctly.
      setSessionToken(crypto.randomUUID());
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            id={id}
            name={`line${fieldName}`}
            value={value}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            onChange={(e) => {
              onValueChange(e.target.value);
              setTyped(e.target.value);
            }}
            onFocus={() => {
              focusedRef.current = true;
              if (typed !== null && suggestions.length > 0) setOpen(true);
            }}
            onBlur={() => {
              focusedRef.current = false;
              setOpen(false);
            }}
            placeholder={placeholder ? unhookChromeAddressFill(placeholder) : undefined}
            className={cn(
              'backdrop-blur-none dark:backdrop-blur-none',
              className,
            )}
            disabled={disabled}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
          />
          {(loading || resolving) && (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
          )}
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-1"
        side="bottom"
        sideOffset={6}
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <ul className="max-h-64 overflow-y-auto">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
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
