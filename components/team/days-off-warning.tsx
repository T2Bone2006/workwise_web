'use client';

import { useState } from 'react';
import { CalendarOff } from 'lucide-react';
import { Notice } from '@/components/look';
import { Button } from '@/components/ui/button';
import type { LanePerson } from '@/lib/rounds/lanes';
import type { OffWarning } from '@/lib/team/off-warning';
import { GiveRoundDialog, type OffRange } from './give-round-dialog';
import { PushBackDialog } from './push-back-dialog';

/** The two ways to fix a day off that still has stops: give the round to someone, or push it back. */
export function OffFixActions({
  warning,
  people,
  daysOff,
  onDone,
}: {
  warning: OffWarning;
  people: ReadonlyArray<LanePerson>;
  daysOff: ReadonlyArray<OffRange>;
  /** Called after either dialog closes, so a parent can close itself. */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState<'give' | 'push' | null>(null);
  const close = () => {
    setOpen(null);
    onDone?.();
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={() => setOpen('give')}>
          Give round to…
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen('push')}>
          Push back
        </Button>
      </div>
      {open === 'give' ? <GiveRoundDialog warning={warning} people={people} daysOff={daysOff} onClose={close} /> : null}
      {open === 'push' ? <PushBackDialog warning={warning} onClose={close} /> : null}
    </>
  );
}

/** Amber banner on the calendar: someone is off but still has stops. One per person; gone once nothing is left on their days off. */
export function DaysOffWarning({
  warnings,
  people,
  daysOff,
}: {
  warnings: ReadonlyArray<OffWarning>;
  people: ReadonlyArray<LanePerson>;
  daysOff: ReadonlyArray<OffRange>;
}) {
  if (warnings.length === 0) return null;
  return (
    <div className="grid gap-3" role="region" aria-label="Days off with stops">
      {warnings.map((w) => (
        <Notice key={w.workerId} tone="amber" icon={CalendarOff} title={w.text} action={<OffFixActions warning={w} people={people} daysOff={daysOff} />}>
          Nothing has moved yet. Pick how to fix it.
        </Notice>
      ))}
    </div>
  );
}
