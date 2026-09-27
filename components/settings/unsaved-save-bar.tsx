'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const LEAVE_MESSAGE = 'Not saved. Leave without saving?';

export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest('a');
      if (!anchor || anchor.target === '_blank') return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('#')) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', warn);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);
}

/** Shown only while the form is dirty. After a save, "Saved" stays briefly, then fades. */
export function UnsavedSaveBar({
  dirty,
  saving,
  savedAt,
}: {
  dirty: boolean;
  saving: boolean;
  savedAt: number;
}) {
  useUnsavedGuard(dirty);
  const [holdFor, setHoldFor] = useState(0);
  const [holdSaved, setHoldSaved] = useState(false);
  const [fading, setFading] = useState(false);

  if (savedAt !== 0 && savedAt !== holdFor) {
    setHoldFor(savedAt);
    setHoldSaved(true);
    setFading(false);
  }

  useEffect(() => {
    if (savedAt === 0) return;
    const fade = window.setTimeout(() => setFading(true), 1200);
    const hide = window.setTimeout(() => {
      setHoldSaved(false);
      setFading(false);
    }, 1700);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(hide);
    };
  }, [savedAt]);

  if (!dirty && !holdSaved) return null;

  return (
    <div
      className={cn(
        'sticky bottom-4 z-10 flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-lg transition-opacity duration-500',
        fading && !dirty && 'pointer-events-none opacity-0',
      )}
    >
      <p className={dirty ? 'font-medium text-amber-600' : 'text-sm text-muted-foreground'}>
        {dirty ? 'Not saved' : 'Saved'}
      </p>
      <Button type="submit" variant="gradient" size="lg" disabled={saving || !dirty}>
        {saving && <Loader2 className="size-4 animate-spin" />}
        Save
      </Button>
    </div>
  );
}
