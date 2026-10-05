'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Route, Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Tag } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cancelPendingChangeAction, openCardUpdate } from '@/lib/actions/billing';
import { formatPence, PLANS, priceLabel, type PlanChoice } from '@/lib/billing/plans';
import type { PlanSummary } from '@/lib/billing/manage';

export type StripePlanSummary = Extract<PlanSummary, { kind: 'stripe' }>;

export type PlanActionRun = (task: () => Promise<void>) => boolean;

/** Server actions that redirect (the card form) reject with this. Navigation already started. */
export function isNextRedirect(err: unknown): boolean {
  if (typeof err !== 'object' || err === null || !('digest' in err)) return false;
  const digest = (err as { digest: unknown }).digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT');
}

/** Same zone as the founding-offer date already written on the summary. */
const BILLING_ZONE = 'UTC';

/** `14 Nov`, with the year only when it isn't this year. */
export function formatBillDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: BILLING_ZONE });
  const sameYear = year.format(date) === year.format(new Date());
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: BILLING_ZONE,
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(date);
}

function ProductChips({ products }: { products: ReadonlyArray<'rounds' | 'lite'> }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {products.map((product) => {
        const Icon = product === 'rounds' ? Route : Sparkles;
        return (
          <li key={product}>
            <Tag tone={product === 'rounds' ? 'rounds' : 'lite'} className="gap-1.5 px-2.5 py-1">
              <Icon className="size-3.5" aria-hidden />
              {product === 'rounds' ? 'Rounds' : 'Lite'}
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

function pendingPhrase(current: PlanChoice, next: PlanChoice): string {
  if (current.plan !== next.plan && current.interval === next.interval) return PLANS[next.plan].label;
  if (current.plan === next.plan) return next.interval === 'year' ? 'yearly' : 'monthly';
  return `${PLANS[next.plan].label}, ${priceLabel(next)}`;
}

export function CurrentPlanCard({
  summary,
  pending,
  run,
}: {
  summary: StripePlanSummary;
  pending: boolean;
  run: PlanActionRun;
}) {
  const router = useRouter();
  const [cardError, setCardError] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  const [updatingCard, setUpdatingCard] = useState(false);
  const [cancellingChange, setCancellingChange] = useState(false);
  const plan = PLANS[summary.choice.plan];
  const overdue = summary.status === 'past_due';
  const ending = summary.cancelAtPeriodEnd;
  const ends = formatBillDate(summary.currentPeriodEnd);
  const nextWhen = summary.nextBill ? formatBillDate(summary.nextBill.date) : '';

  const updateCard = () => {
    if (pending) return;
    setCardError(null);
    setUpdatingCard(true);
    const started = run(async () => {
      try {
        const result = await openCardUpdate();
        if (!result.ok) setCardError(result.error);
      } catch (err) {
        if (!isNextRedirect(err)) setCardError('Could not open the card form. Please try again.');
      } finally {
        setUpdatingCard(false);
      }
    });
    if (!started) setUpdatingCard(false);
  };

  const cancelChange = () => {
    if (pending) return;
    setChangeError(null);
    setCancellingChange(true);
    const started = run(async () => {
      try {
        const result = await cancelPendingChangeAction();
        if (!result.ok) {
          setChangeError(result.error);
          return;
        }
        toast.success('Change cancelled');
        router.refresh();
      } finally {
        setCancellingChange(false);
      }
    });
    if (!started) setCancellingChange(false);
  };

  return (
    <section aria-labelledby="your-plan-heading">
      <h2 id="your-plan-heading" className="text-sm font-semibold">
        Your plan
      </h2>
      <Card className="glass-card mt-3 gap-0 border-border/80 py-0">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xl font-semibold tracking-tight">{plan.label}</p>
              <ProductChips products={plan.products} />
              <p className="mt-3 text-sm text-muted-foreground">{summary.priceLabel}</p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              {overdue ? (
                <Tag tone="amber" className="px-2.5 py-1">Payment overdue</Tag>
              ) : ending ? (
                <Tag tone="slate" className="px-2.5 py-1">{ends ? `Ends ${ends}` : 'Ends soon'}</Tag>
              ) : (
                <Tag tone="emerald" className="px-2.5 py-1">Active</Tag>
              )}
              {overdue ? (
                <Button
                  type="button"
                  className="w-full sm:w-auto"
                  disabled={pending}
                  onClick={updateCard}
                >
                  {updatingCard ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  Update card
                </Button>
              ) : null}
              {cardError ? (
                <p role="alert" className="text-sm text-destructive">
                  {cardError}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 rounded-xl bg-muted/50 p-4">
            {ending ? (
              <>
                <p className="text-xs text-muted-foreground">No more bills</p>
                <p className="mt-1 text-lg font-semibold">
                  {ends ? `Your plan ends on ${ends}.` : 'Your plan ends at the end of this period.'}
                </p>
              </>
            ) : summary.nextBill ? (
              <>
                <p className="text-xs text-muted-foreground">Next bill</p>
                <p className="mt-1 text-[28px] leading-tight font-semibold tabular-nums tracking-tight text-(--tone-rounds-solid)">
                  {formatPence(summary.nextBill.amountPence)}
                </p>
                {nextWhen ? <p className="mt-1 text-sm text-muted-foreground">on {nextWhen}</p> : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Next bill isn&apos;t available right now.</p>
            )}
          </div>

          {summary.discount || summary.creditPence > 0 || summary.pendingChange ? (
            <ul className="mt-4 space-y-2 text-sm">
              {summary.discount ? <li className="text-muted-foreground">{summary.discount.label}</li> : null}
              {summary.creditPence > 0 ? (
                <li className="text-muted-foreground">
                  {formatPence(summary.creditPence)} credit: comes off your next bill
                </li>
              ) : null}
              {summary.pendingChange && !ending ? (
                <li>
                  <p className="text-foreground">
                    Changing to {pendingPhrase(summary.choice, summary.pendingChange.choice)} on{' '}
                    {formatBillDate(summary.pendingChange.effectiveDate) || 'your renewal date'}
                    {overdue ? null : (
                      <>
                        <span aria-hidden> · </span>
                        <button
                          type="button"
                          className="font-medium underline underline-offset-4 disabled:opacity-50"
                          disabled={pending}
                          onClick={cancelChange}
                        >
                          {cancellingChange ? 'Cancelling…' : 'Cancel this change'}
                        </button>
                      </>
                    )}
                  </p>
                  {changeError ? (
                    <p role="alert" className="mt-1 text-sm text-destructive">
                      {changeError}
                    </p>
                  ) : null}
                </li>
              ) : null}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
