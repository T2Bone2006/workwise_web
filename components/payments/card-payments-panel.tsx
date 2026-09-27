'use client';

import { useState, type JSX } from 'react';
import Link from 'next/link';
import { CircleCheck, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CardPanelData } from '@/lib/data/payments/card-panel';
import { requirementLabel } from '@/lib/payments/requirement-label';
import { openStripeDashboard, startCardPaymentsSetup } from '@/lib/actions/stripe-connect';
import { fromPence, formatGbp } from '@/lib/money/pence';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function payoutDay(ymd: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return ymd;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = WEEKDAYS[date.getUTCDay()] ?? '';
  const monthName = MONTHS[month - 1] ?? '';
  return `${weekday} ${day} ${monthName}`;
}

function disputeDay(iso: string): string {
  const ymd = iso.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!match) return iso;
  const month = MONTHS[Number(match[2]) - 1] ?? '';
  return `${Number(match[3])} ${month}`;
}

function payoutStatusLabel(status: string): string {
  if (status === 'in_transit') return 'On the way';
  if (status === 'paid') return 'Paid';
  if (status === 'pending') return 'Pending';
  if (status === 'failed') return 'Failed';
  if (status === 'canceled') return 'Canceled';
  return status;
}

function uniqueLabels(keys: string[]): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const key of keys) {
    const label = requirementLabel(key);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

export function CardPaymentsPanel(props: {
  data: CardPanelData;
  compact?: boolean;
}): JSX.Element {
  const { data } = props;
  const compact = props.compact === true && data.status === 'active' && data.disputes.length === 0;
  const [busy, setBusy] = useState<'setup' | 'stripe' | null>(null);

  async function beginSetup() {
    setBusy('setup');
    const result = await startCardPaymentsSetup();
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    window.location.href = result.url;
  }

  async function openStripe() {
    setBusy('stripe');
    const result = await openStripeDashboard();
    setBusy(null);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    window.open(result.url, '_blank', 'noopener,noreferrer');
  }

  const disputeCount = data.disputes.length;
  const next = data.payouts?.nextPayout ?? null;
  const nextLine = next
    ? `${formatGbp(fromPence(next.amount))} on ${payoutDay(next.arrivalDate)}`
    : null;

  if (compact) {
    return (
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
          <CircleCheck className="size-4" />
          Card payments are on
        </span>
        <span className="text-muted-foreground">·</span>
        <span>{nextLine ? `next payout ${nextLine}` : 'No payout scheduled'}</span>
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          className="font-medium text-primary hover:underline disabled:opacity-50"
          disabled={busy === 'stripe'}
          onClick={() => void openStripe()}
        >
          Open Stripe
        </button>
      </p>
    );
  }

  return (
    <Card
      className={cn(
        'glass-card border-border/80',
        data.status === 'restricted' && 'border-amber-500/40 bg-amber-500/5',
      )}
    >
      {disputeCount > 0 ? (
        <div className="space-y-3 border-b border-red-500/30 bg-red-500/10 px-6 py-4 text-sm text-red-800 dark:text-red-200">
          <p>
            {disputeCount} disputed card payment{disputeCount === 1 ? '' : 's'}. Respond in Stripe
            before the deadline or the money goes back to the customer.
          </p>
          <ul className="space-y-1">
            {data.disputes.map((row) => (
              <li key={row.paymentId}>
                <Link href={`/customers/${row.customerId}`} className="font-medium underline-offset-4 hover:underline">
                  {row.customerName}
                </Link>
                {' · '}
                {formatGbp(row.amount)}
                {' · '}
                {disputeDay(row.disputedAt)}
                {row.disputeStatus ? ` · ${row.disputeStatus}` : null}
              </li>
            ))}
          </ul>
          <Button type="button" variant="outline" disabled={busy === 'stripe'} onClick={() => void openStripe()}>
            Open Stripe
          </Button>
        </div>
      ) : null}
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          {data.status === 'active' ? (
            <CircleCheck className="size-5 text-emerald-600" />
          ) : (
            <CreditCard className="size-5" />
          )}
          {data.status === 'none' ? 'Take card payments' : null}
          {data.status === 'in_progress' ? 'Finish setting up card payments' : null}
          {data.status === 'restricted' ? 'Stripe needs more details' : null}
          {data.status === 'active' ? 'Card payments are on' : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {data.status === 'none' ? (
          <>
            <p>
              Customers pay by card, Apple Pay or Google Pay from your pay link and invoices. The
              money goes straight into your own Stripe account and on to your bank — usually within
              a few days. Stripe charges its standard card fee; WorkWise takes nothing.
            </p>
            <Button type="button" disabled={busy === 'setup'} onClick={() => void beginSetup()}>
              Set up card payments
            </Button>
            <p className="text-muted-foreground">
              Takes about 5 minutes. Stripe will ask for your details, your bank account and
              sometimes ID.
            </p>
          </>
        ) : null}
        {data.status === 'in_progress' ? (
          <>
            <p>Stripe needs a few more details before you can take cards.</p>
            <Button type="button" disabled={busy === 'setup'} onClick={() => void beginSetup()}>
              Finish setting up
            </Button>
          </>
        ) : null}
        {data.status === 'restricted' ? (
          <>
            <ul className="list-disc space-y-1 pl-5">
              {uniqueLabels(data.requirementsDue).map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <Button type="button" disabled={busy === 'setup'} onClick={() => void beginSetup()}>
              Update details in Stripe
            </Button>
          </>
        ) : null}
        {data.status === 'active' ? (
          <>
            {data.payoutsError ? (
              <p>Couldn&apos;t load your Stripe balance just now.</p>
            ) : (
              <>
                <p className="flex flex-wrap gap-x-4 gap-y-1">
                  <span>
                    <span className="text-muted-foreground">Available </span>
                    <span className="font-semibold tabular-nums">
                      {formatGbp(fromPence(data.payouts?.available ?? 0))}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">On the way </span>
                    <span className="font-semibold tabular-nums">
                      {formatGbp(fromPence(data.payouts?.pending ?? 0))}
                    </span>
                  </span>
                  <span>
                    <span className="text-muted-foreground">Next payout </span>
                    <span className="font-semibold">{nextLine ?? 'No payout scheduled'}</span>
                  </span>
                </p>
                {(data.payouts?.recent.length ?? 0) > 0 ? (
                  <div className="space-y-1">
                    <p className="font-medium">Recent payouts</p>
                    <ul>
                      {data.payouts?.recent.slice(0, 3).map((row) => (
                        <li key={`${row.arrivalDate}-${row.amount}-${row.status}`}>
                          {payoutDay(row.arrivalDate)} · {formatGbp(fromPence(row.amount))} ·{' '}
                          {payoutStatusLabel(row.status)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
            <Button type="button" disabled={busy === 'stripe'} onClick={() => void openStripe()}>
              Open Stripe
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
