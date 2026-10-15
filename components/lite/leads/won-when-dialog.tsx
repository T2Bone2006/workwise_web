'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addDays, format, startOfDay, subDays } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { setBookedForAction, setLeadStatusAction } from '@/lib/actions/lite/leads';
import type { BoardLead } from '@/lib/data/lite/leads-board';
import { formatJobTime } from '@/lib/lite/job-when';

const NONE = 'none';

/** Half-hours a tradie would actually book. Odd saved times are added when opened. */
function timeChoices(current: string): { value: string; label: string }[] {
  const choices: { value: string; label: string }[] = [];
  for (let hour = 6; hour <= 20; hour += 1) {
    for (const minute of [0, 30]) {
      if (hour === 20 && minute === 30) continue;
      const value = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      choices.push({ value, label: formatJobTime(value) });
    }
  }
  if (current && !choices.some((choice) => choice.value === current)) {
    choices.unshift({ value: current, label: formatJobTime(current) });
  }
  return choices;
}

export function WonWhenDialog({
  open,
  onOpenChange,
  lead,
  intent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: BoardLead;
  intent: 'mark' | 'edit';
}) {
  const router = useRouter();
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState('');
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate(lead.bookedForDate ? new Date(`${lead.bookedForDate}T00:00:00`) : undefined);
    setTime(lead.bookedForTime ?? '');
  }, [open, lead.bookedForDate, lead.bookedForTime]);

  const today = startOfDay(new Date());
  const choices = timeChoices(time);

  async function save(picked: Date | null) {
    setPending(true);
    try {
      if (intent === 'mark' && lead.status !== 'won') {
        const status = await setLeadStatusAction(lead.id, 'won');
        if (!status.success) {
          toast(status.error);
          return;
        }
      }
      const ymd = picked ? format(picked, 'yyyy-MM-dd') : null;
      const hm = ymd && time ? time : null;
      const booked = await setBookedForAction(lead.id, ymd, hm);
      if (!booked.success) {
        toast(booked.error);
        router.refresh();
        return;
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>When&apos;s the job?</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {lead.firstName}
            {lead.jobSummary ? ` · ${lead.jobSummary}` : ''}
          </DialogDescription>
        </DialogHeader>
        <p className="text-base font-semibold">{date ? format(date, 'EEEE d MMMM') : 'Pick a day'}</p>
        <Calendar
          mode="single"
          selected={date}
          onSelect={(next) => {
            if (next) setDate(next);
          }}
          disabled={{ before: subDays(today, 30), after: addDays(today, 365) }}
          className="mx-auto rounded-lg border p-2"
        />
        <label className="block text-sm font-medium">
          What time?
          <Select value={time || NONE} onValueChange={(value) => setTime(value === NONE ? '' : value)} disabled={pending}>
            <SelectTrigger className="mt-1 w-full" aria-label="What time?">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>No set time</SelectItem>
              {choices.map((choice) => (
                <SelectItem key={choice.value} value={choice.value}>
                  {choice.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <DialogFooter className="flex-col sm:flex-col">
          <Button type="button" className="w-full" disabled={pending || !date} onClick={() => { if (date) void save(date); }}>
            {intent === 'mark' ? 'Mark as won' : 'Save'}
          </Button>
          {intent === 'mark' ? (
            <Button type="button" variant="ghost" className="w-full" disabled={pending} onClick={() => void save(null)}>
              Not sure of the day yet
            </Button>
          ) : lead.bookedForDate ? (
            <Button type="button" variant="ghost" className="w-full" disabled={pending} onClick={() => void save(null)}>
              Clear the day
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
