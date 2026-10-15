'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { LookCard } from '@/components/look';
import { WonWhenDialog } from '@/components/lite/leads/won-when-dialog';
import { formatJobDay, formatJobTime } from '@/lib/lite/job-when';
import { Button } from '@/components/ui/button';
import type { BoardLead } from '@/lib/data/lite/leads-board';

export function BookedForEditor({ lead }: { lead: BoardLead }) {
  const [open, setOpen] = useState(false);
  const when = lead.bookedForDate
    ? [formatJobDay(lead.bookedForDate), lead.bookedForTime ? formatJobTime(lead.bookedForTime) : null]
        .filter((part): part is string => part != null)
        .join(' · ')
    : null;

  return (
    <LookCard title="When's the job?" icon={CalendarDays} tone="indigo">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className={when ? 'text-lg font-semibold tracking-tight' : 'text-sm text-muted-foreground'}>
          {when ?? 'No day picked yet.'}
        </p>
        <Button type="button" size="sm" variant={when ? 'outline' : 'default'} onClick={() => setOpen(true)}>
          {when ? 'Change the day' : 'Pick a day'}
        </Button>
      </div>
      <WonWhenDialog open={open} onOpenChange={setOpen} lead={lead} intent="edit" />
    </LookCard>
  );
}
