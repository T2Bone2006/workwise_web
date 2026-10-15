'use client';

import { useEffect, useState, type JSX } from 'react';
import Link from 'next/link';
import { CircleCheck, CreditCard, Landmark } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { IconChip, KeyFigure, LookCard, Tag } from '@/components/look';
import type { CardPanelData } from '@/lib/data/payments/card-panel';
import { requirementLabel } from '@/lib/payments/requirement-label';
import { openStripeDashboard, startCardPaymentsSetup } from '@/lib/actions/stripe-connect';
import { fromPence, formatGbp } from '@/lib/money/pence';

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
  /** Live Stripe balance that is still on its way; fills in payouts when it lands. */
  payoutsPromise?: Promise<Pick<CardPanelData, 'payouts' | 'payoutsError'>> | null;
  compact?: boolean;
}): JSX.Element {
  const { payoutsPromise } = props;
  const [late, setLate] = useState<{
    promise: Promise<unknown>;
    result: Pick<CardPanelData, 'payouts' | 'payoutsError'>;
  } | null>(null);
  useEffect(() => {
    if (!payoutsPromise) return;
    let cancelled = false;
    void payoutsPromise.then((result) => {
      if (!cancelled) setLate({ promise: payoutsPromise, result });
    });
    return () => {
      cancelled = true;
    };
  }, [payoutsPromise]);
  const arrived = payoutsPromise != null && late?.promise === payoutsPromise ? late.result : null;
  const payoutsLoading = payoutsPromise != null && arrived == null;
  const data: CardPanelData = arrived ? { ...props.data, ...arrived } : props.data;
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
        {payoutsLoading ? (
          <span aria-hidden className="skeleton inline-block h-4 w-28 rounded-md align-middle" />
        ) : (
          <span>{nextLine ? `next payout ${nextLine}` : 'No payout scheduled'}</span>
        )}
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

  const headline =
    data.status === 'none'
      ? 'Take card payments'
      : data.status === 'in_progress'
        ? 'Finish setting up card payments'
        : data.status === 'restricted'
          ? 'Stripe needs more details'
          : 'Card payments are on';
  const tone = data.status === 'active' ? 'emerald' : data.status === 'restricted' ? 'amber' : 'rounds';

  return (
    <LookCard
      className={data.status === 'restricted' ? 'border-(--tone-amber-line) bg-(--tone-amber-soft)' : undefined}
      aside={data.status === 'active' ? <Tag tone="emerald">On</Tag> : undefined}
      title={headline}
      icon={data.status === 'active' ? CircleCheck : CreditCard}
      tone={tone}
    >
      {disputeCount > 0 ? (
        <div className="-mx-1 mb-4 space-y-3 rounded-xl border border-(--tone-rose-line) bg-(--tone-rose-soft) px-4 py-3 text-sm text-(--tone-rose-text)">
          <p className="font-medium">
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
          <Button type="button" variant="outline" size="sm" disabled={busy === 'stripe'} onClick={() => void openStripe()}>
            Open Stripe
          </Button>
        </div>
      ) : null}
      <div className="space-y-4 text-sm">
        {data.status === 'none' ? (
          <>
            <p className="text-muted-foreground">
              Customers pay by card, Apple Pay or Google Pay from your pay link and invoices. The
              money goes straight into your own Stripe account and on to your bank — usually within
              a few days. Stripe charges its standard card fee; WorkWise takes nothing.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" disabled={busy === 'setup'} onClick={() => void beginSetup()}>
                Set up card payments
              </Button>
              <span className="text-muted-foreground">
                Takes about 5 minutes. Stripe will ask for your details, your bank account and
                sometimes ID.
              </span>
            </div>
          </>
        ) : null}
        {data.status === 'in_progress' ? (
          <>
            <p className="text-muted-foreground">Stripe needs a few more details before you can take cards.</p>
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
            {payoutsLoading ? (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
                <Skeleton className="h-16 rounded-xl" />
              </div>
            ) : data.payoutsError ? (
              <p className="text-muted-foreground">Couldn&apos;t load your Stripe balance just now.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <KeyFigure label="Available" value={formatGbp(fromPence(data.payouts?.available ?? 0))} tone="emerald" />
                  <KeyFigure label="On the way" value={formatGbp(fromPence(data.payouts?.pending ?? 0))} />
                  <KeyFigure label="Next payout" value={nextLine ?? 'No payout scheduled'} />
                </div>
                {(data.payouts?.recent.length ?? 0) > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">Recent payouts</p>
                    <ul className="divide-y divide-border rounded-xl border border-border">
                      {data.payouts?.recent.slice(0, 3).map((row) => (
                        <li
                          key={`${row.arrivalDate}-${row.amount}-${row.status}`}
                          className="flex items-center gap-3 px-3 py-2"
                        >
                          <IconChip icon={Landmark} tone="slate" size="sm" />
                          <span className="flex-1">{payoutDay(row.arrivalDate)}</span>
                          <span className="font-medium tabular-nums">{formatGbp(fromPence(row.amount))}</span>
                          <Tag tone={row.status === 'paid' ? 'emerald' : row.status === 'failed' ? 'rose' : 'slate'}>
                            {payoutStatusLabel(row.status)}
                          </Tag>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
            <Button type="button" variant="outline" disabled={busy === 'stripe'} onClick={() => void openStripe()}>
              Open Stripe
            </Button>
          </>
        ) : null}
      </div>
    </LookCard>
  );
}
