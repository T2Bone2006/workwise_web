'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * An on/off choice remembered in this browser (a per-viewer convenience, so it
 * never matters if storage is blocked). Renders `initial` on the server and
 * until the browser has been asked, so there is no flash or mismatch.
 */
export function useStoredFlag(key: string, initial: boolean): [boolean, (next: boolean) => void] {
  const event = `ww-flag:${key}`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      window.addEventListener('storage', onChange);
      window.addEventListener(event, onChange);
      return () => {
        window.removeEventListener('storage', onChange);
        window.removeEventListener(event, onChange);
      };
    },
    [event],
  );
  const read = useCallback(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored === null ? initial : stored === '1';
    } catch {
      return initial;
    }
  }, [key, initial]);
  const value = useSyncExternalStore(subscribe, read, () => initial);
  const set = useCallback(
    (next: boolean) => {
      try {
        window.localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* storage blocked: the choice just won't be remembered */
      }
      window.dispatchEvent(new Event(event));
    },
    [key, event],
  );
  return [value, set];
}

/** True while the screen matches the media query (false on the server). */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
