'use client';

import { Inbox } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStoredFlag } from '@/components/rounds/use-stored-flag';

/** Remembered in this browser, so the "No date yet" column stays open or shut as you left it. */
export const NO_DATE_KEY = 'ww-pro-calendar-no-date';

/** Shows or hides the column of jobs with no date, which you drag from to put them on a day. */
export function NoDateToggle({ count }: { count: number }) {
  const [open, setOpen] = useStoredFlag(NO_DATE_KEY, false);
  if (count === 0) return null;
  return (
    <Button type="button" variant={open ? 'secondary' : 'outline'} size="sm" aria-pressed={open} onClick={() => setOpen(!open)}>
      <Inbox className="size-4" />
      {open ? 'Hide' : 'Show'} no date yet ({count})
    </Button>
  );
}
