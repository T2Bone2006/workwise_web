'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { bookLeadAsOneOffAction } from '@/lib/actions/lite/lead-to-rounds';
import type { LeadDetail } from '@/lib/data/lite/lead-detail';
import { addDays, todayInLondon } from '@/lib/rounds/dates';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

function defaultDate(booked: string | null): string {
  if (booked && /^\d{4}-\d{2}-\d{2}$/.test(booked)) return booked;
  return addDays(todayInLondon(), 1);
}

function formatDayMonth(ymd: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

export function RoundsActions({
  lead,
  customerName,
}: {
  lead: LeadDetail['lead'];
  customerName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [date, setDate] = useState(defaultDate(lead.bookedForDate));
  const [time, setTime] = useState(lead.bookedForTime ?? '');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState(lead.postcode ?? '');
  const [price, setPrice] = useState(lead.agreedAmount != null ? String(lead.agreedAmount) : '');
  const [duration, setDuration] = useState('60');
  const [title, setTitle] = useState((lead.jobSummary ?? '').slice(0, 120));

  const converted = lead.convertedCustomerId != null || lead.convertedJobId != null;
  const visitWhen = lead.bookedForDate ? formatDayMonth(lead.bookedForDate) : null;

  async function book() {
    if (price.trim() === '') {
      toast('Enter a price.');
      return;
    }
    const amount = Number(price);
    if (!Number.isFinite(amount)) {
      toast('Enter a price.');
      return;
    }
    setPending(true);
    try {
      const result = await bookLeadAsOneOffAction({
        leadId: lead.id,
        date,
        time: time.trim() === '' ? null : time,
        address: address.trim(),
        postcode: postcode.trim(),
        price: amount,
        durationMinutes: Number(duration) || 60,
        title: title.trim(),
      });
      if (!result.success) {
        toast(result.error);
        return;
      }
      if (result.warning) toast.warning(result.warning);
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (converted) {
    return (
      <section className="glass-card space-y-2 rounded-xl p-4" aria-label="On your round">
        {lead.convertedCustomerId ? (
          <Link
            href={`/customers/${lead.convertedCustomerId}`}
            className="text-sm font-medium text-emerald-700 dark:text-emerald-300"
          >
            {customerName ? `On your round: ${customerName}` : 'On your round'}
          </Link>
        ) : null}
        {lead.convertedJobId ? (
          <Link
            href={lead.bookedForDate ? `/calendar?date=${lead.bookedForDate}` : '/calendar'}
            className="block text-sm font-medium text-emerald-700 dark:text-emerald-300"
          >
            {visitWhen ? `One-off visit on ${visitWhen}` : 'One-off visit'}
          </Link>
        ) : null}
      </section>
    );
  }

  return (
    <section className="glass-card space-y-3 rounded-xl p-4">
      <p className="inline-flex rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
        Put it on your round
      </p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="min-w-0 flex-1 space-y-1">
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/customers/new?fromLead=${lead.id}`}>Add to my round</Link>
          </Button>
          <p className="text-sm text-muted-foreground">
            For repeat work — add them as a customer and set their service.
          </p>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
            Book a one-off visit
          </Button>
          <p className="text-sm text-muted-foreground">For a single job — it goes on your calendar.</p>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Book a one-off visit</DialogTitle>
          </DialogHeader>
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void book();
            }}
          >
            <label className="block text-sm font-medium">
              Date
              <Input className="mt-1" type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
            </label>
            <label className="block text-sm font-medium">
              Time
              <Input className="mt-1" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
            <label className="block text-sm font-medium">
              First line of address
              <Input
                className="mt-1"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                autoComplete="address-line1"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Postcode
              <Input
                className="mt-1 uppercase"
                value={postcode}
                onChange={(event) => setPostcode(event.target.value)}
                autoComplete="postal-code"
                required
              />
            </label>
            <label className="block text-sm font-medium">
              Price (£)
              <Input
                className="mt-1"
                inputMode="decimal"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              How long (minutes)
              <Input
                className="mt-1"
                type="number"
                min={5}
                max={600}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
                required
              />
            </label>
            <label className="block text-sm font-medium">
              What
              <Input className="mt-1" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} required />
            </label>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Booking…' : 'Book it'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
