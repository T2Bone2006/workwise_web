'use client';

import { useEffect } from 'react';
import type { Look } from './use-look';

/**
 * Puts data-look="new" on <html> so dialogs, sheets and toasts rendered in
 * portals (outside the shell's wrapper) get the new look too. Removed again
 * when the dashboard unmounts, e.g. on the way to the log-in page.
 */
export function LookAttribute({ look }: { look: Look }): null {
  useEffect(() => {
    if (look !== 'new') return;
    const html = document.documentElement;
    html.dataset.look = 'new';
    return () => {
      delete html.dataset.look;
    };
  }, [look]);
  return null;
}
