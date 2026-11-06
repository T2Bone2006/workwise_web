'use client';

import { useSyncExternalStore } from 'react';
import { EyeOff } from 'lucide-react';
import { isIgnoringMe, setIgnoreMe } from '@/lib/consent';
import { cn } from '@/lib/utils';

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * "Don't count this browser": sets a cookie on the whole joinworkwise.com domain, so the marketing site and the sign-up
 * pages both stop counting (and stop telling Facebook) for this browser. Has to be switched on once per browser or phone.
 */
export function IgnoreMeToggle() {
  const ignoring = useSyncExternalStore(subscribe, isIgnoringMe, () => false);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border p-3.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <EyeOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">{ignoring ? "This browser isn't being counted" : 'This browser is being counted'}</p>
          <p className="text-xs text-muted-foreground">
            {ignoring
              ? 'Your own clicking around on the website and sign-up pages stays out of these numbers.'
              : "Switch this on and your own clicking around won't show up here. Do it once on each laptop or phone you use."}
          </p>
        </div>
      </div>
      <button
        type="button"
        aria-pressed={ignoring}
        onClick={() => {
          setIgnoreMe(!ignoring);
          for (const listener of listeners) listener();
        }}
        className={cn(
          'inline-flex h-9 shrink-0 items-center rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
          ignoring ? 'border-border bg-card hover:bg-muted' : 'border-transparent bg-primary text-primary-foreground hover:opacity-90',
        )}
      >
        {ignoring ? 'Count me again' : "Don't count me"}
      </button>
    </div>
  );
}
