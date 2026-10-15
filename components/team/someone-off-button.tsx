'use client';

import { useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LanePerson } from '@/lib/rounds/lanes';
import { DaysOffDialog, type ExistingDayOff } from './days-off-dialog';

/** "Someone's off" in the calendar header: opens Days off for you or any lead. */
export function SomeoneOffButton({
  people,
  existing,
  today,
}: {
  people: ReadonlyArray<LanePerson>;
  existing: ReadonlyArray<ExistingDayOff>;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  if (people.length === 0) return null;
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        <CalendarOff /> Someone&apos;s off
      </Button>
      {open ? <DaysOffDialog people={people} existing={existing} today={today} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
