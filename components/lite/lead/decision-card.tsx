'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { formatPounds } from '@/components/lite/leads/lead-card';
import { WonWhenDialog } from '@/components/lite/leads/won-when-dialog';
import { londonWhen } from '@/components/lite/conversation-transcript';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  acceptBookingAction,
  changePriceAction,
  declineBookingAction,
  setLeadStatusAction,
} from '@/lib/actions/lite/leads';
import type { BoardLead } from '@/lib/data/lite/leads-board';
import type { LeadDetail } from '@/lib/data/lite/lead-detail';
import { LEAD_STATUSES, type LeadStatus } from '@/lib/validations/lite/lead';

const ALREADY = 'That booking has already been decided.';
const LOCKED = 'Accept or decline the booking first';

const STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  won: 'Won',
  lost: 'Lost',
};

type Lead = LeadDetail['lead'];

function isStatus(value: string): value is LeadStatus {
  return (LEAD_STATUSES as readonly string[]).includes(value);
}

export function LeadStatusControl({
  lead,
  locked,
}: {
  lead: BoardLead;
  locked: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [askWhen, setAskWhen] = useState(false);
  const status = lead.status;

  async function change(value: string) {
    if (!isStatus(value) || value === status || locked) return;
    if (value === 'won') {
      setAskWhen(true);
      return;
    }
    setPending(true);
    try {
      const result = await setLeadStatusAction(lead.id, value);
      if (!result.success) {
        toast(result.error);
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const control = (
    <Select value={status} onValueChange={(value) => void change(value)} disabled={locked || pending}>
      <SelectTrigger aria-label="Status" size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEAD_STATUSES.map((item) => (
          <SelectItem key={item} value={item}>
            {STATUS_LABEL[item]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const dialog = askWhen ? (
    <WonWhenDialog open onOpenChange={setAskWhen} lead={lead} intent="mark" />
  ) : null;

  if (!locked) {
    return (
      <>
        {control}
        {dialog}
      </>
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex cursor-not-allowed">{control}</span>
          </TooltipTrigger>
          <TooltipContent>{LOCKED}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {dialog}
    </>
  );
}

function decidedLine(lead: Lead): string | null {
  if (lead.bookingStatus !== 'accepted' && lead.bookingStatus !== 'declined') return null;
  const when = lead.decidedAt ? londonWhen(lead.decidedAt) : null;
  const on = when ? ` on ${when.dayMonth} at ${when.hm}` : '';
  if (lead.bookingStatus === 'declined') return `You declined${on}.`;
  const verb = lead.decidedBy === 'auto' ? 'Auto-accepted' : 'You accepted';
  const price = typeof lead.agreedAmount === 'number' ? ` \u2013 ${formatPounds(lead.agreedAmount)}` : '';
  return `${verb}${on}${price}.`;
}

export function DecisionCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const waiting = lead.bookingStatus === 'requested';
  const line = decidedLine(lead);
  const [declining, setDeclining] = useState(false);
  const [tell, setTell] = useState(true);
  const [price, setPrice] = useState('');
  const [priceOpen, setPriceOpen] = useState(false);
  const [pending, setPending] = useState(false);

  if (!waiting && !line) return null;

  async function run(action: () => Promise<{ success: true } | { success: false; error: string }>) {
    setPending(true);
    try {
      const result = await action();
      if (!result.success) {
        toast(result.error);
        if (result.error === ALREADY) router.refresh();
        return;
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="lead-booking-heading">
      <h2
        id="lead-booking-heading"
        className={
          waiting
            ? 'inline-flex rounded-md bg-amber-500/15 px-2 py-0.5 text-sm font-semibold text-amber-900 dark:text-amber-200'
            : 'text-base font-semibold'
        }
      >
        Booking
      </h2>
      {waiting ? (
        <div className="mt-3">
          <p className="text-sm text-muted-foreground">Waiting for a yes or no.</p>
          {declining ? (
            <div className="mt-3 flex flex-col gap-2">
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
            <div className="mt-3 flex flex-wrap gap-2">
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
      ) : (
        <p className="mt-3 text-sm">{line}</p>
      )}
    </section>
  );
}
