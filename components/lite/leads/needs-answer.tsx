'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { quoteLabel, timeAgo } from '@/components/lite/leads/lead-card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { acceptBookingAction, changePriceAction, declineBookingAction } from '@/lib/actions/lite/leads';
import type { BoardLead } from '@/lib/data/lite/leads-board';

const ALREADY = 'That booking has already been decided.';

const DAY_LABEL: Record<string, string> = {
  mon: 'Mon',
  tue: 'Tue',
  wed: 'Wed',
  thu: 'Thu',
  fri: 'Fri',
  sat: 'Sat',
  any: 'Any day',
};

function daysLabel(days: string[]): string | null {
  if (days.length === 0) return null;
  if (days.includes('any')) return 'Any day';
  return days.map((day) => DAY_LABEL[day] ?? day).join(', ');
}

function Row({
  lead,
  pending,
  onDone,
  onBusy,
}: {
  lead: BoardLead;
  pending: boolean;
  onDone: (id: string) => void;
  onBusy: (id: string | null) => void;
}) {
  const [declining, setDeclining] = useState(false);
  const [tell, setTell] = useState(true);
  const [price, setPrice] = useState('');
  const [priceOpen, setPriceOpen] = useState(false);
  const offered = quoteLabel(lead.quote);
  const days = daysLabel(lead.preferredDays);

  async function run(action: () => Promise<{ success: true } | { success: false; error: string }>) {
    onBusy(lead.id);
    try {
      const result = await action();
      if (!result.success) {
        toast(result.error);
        if (result.error === ALREADY) onDone(lead.id);
        return;
      }
      onDone(lead.id);
    } finally {
      onBusy(null);
    }
  }

  return (
    <li className="rounded-xl bg-card px-4 py-4 ring-1 ring-amber-500/50">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold" title={lead.name}>
            {lead.name}
          </p>
          {lead.jobSummary ? <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{lead.jobSummary}</p> : null}
          <p className="mt-2 text-sm">
            {offered ? <span className="font-semibold tabular-nums">{offered}</span> : null}
            {offered ? <span className="text-muted-foreground"> · </span> : null}
            <span className="text-muted-foreground">asked {timeAgo(lead.createdAt)}</span>
          </p>
          {days ? <p className="mt-0.5 text-sm text-muted-foreground">Days that suit: {days}</p> : null}
        </div>
        {declining ? (
          <div className="flex shrink-0 flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={tell} onCheckedChange={(value) => setTell(value === true)} />
              Let {lead.firstName} know
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => void run(() => declineBookingAction(lead.id, tell))}
              >
                Decline
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setDeclining(false)}>
                Back
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button type="button" size="sm" disabled={pending} onClick={() => void run(() => acceptBookingAction(lead.id))}>
              Accept
            </Button>
            {lead.quote?.kind === 'firm' ? (
              <Popover open={priceOpen} onOpenChange={setPriceOpen}>
                <PopoverTrigger asChild>
                  <Button type="button" size="sm" variant="outline" disabled={pending}>
                    Change price
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56">
                  <form
                    className="space-y-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const amount = Number(price.trim());
                      void run(async () => {
                        const result = await changePriceAction(lead.id, amount);
                        if (result.success) setPriceOpen(false);
                        return result;
                      });
                    }}
                  >
                    <label className="block text-xs font-medium" htmlFor={`price-${lead.id}`}>
                      New price
                    </label>
                    <div className="flex items-center gap-1">
                      <span className="text-sm text-muted-foreground">£</span>
                      <Input
                        id={`price-${lead.id}`}
                        inputMode="decimal"
                        value={price}
                        onChange={(event) => setPrice(event.target.value)}
                        placeholder="85"
                      />
                    </div>
                    <Button type="submit" size="sm" disabled={pending}>
                      Save
                    </Button>
                  </form>
                </PopoverContent>
              </Popover>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setTell(true);
                setDeclining(true);
              }}
            >
              Decline
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

export function NeedsAnswer({ leads }: { leads: BoardLead[] }) {
  const router = useRouter();
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const visible = leads.filter((lead) => !hidden.has(lead.id));
  if (visible.length === 0) return null;

  return (
    <section aria-labelledby="needs-answer-heading">
      <h2 id="needs-answer-heading" className="text-base font-semibold">
        Needs your answer
      </h2>
      <p className="mt-0.5 text-sm text-muted-foreground">
        {visible.length === 1 ? 'One person is waiting for a yes or no.' : `${visible.length} people are waiting for a yes or no.`}
      </p>
      <ul className="mt-3 space-y-2">
        {visible.map((lead) => (
          <Row
            key={lead.id}
            lead={lead}
            pending={pendingId === lead.id}
            onBusy={setPendingId}
            onDone={(id) => {
              setHidden((current) => new Set(current).add(id));
              router.refresh();
            }}
          />
        ))}
      </ul>
    </section>
  );
}
