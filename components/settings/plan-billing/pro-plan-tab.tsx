'use client';

import Link from 'next/link';
import { ArrowRight, CreditCard, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BAR_COLOURS, SegmentBar } from '@/components/workers/segment-bar';
import { PRO_PLANS, formatPoundsLong as formatPence } from '@/lib/billing/pro-plans';
import { teamNote } from '@/lib/billing/pro-plan-core';
import type { ProPlanSummary } from '@/lib/billing/pro-plan';
import { cn } from '@/lib/utils';
import { formatBillDate } from './current-plan-card';
import { SectionHeading, accentCardClass } from './section-accent';
import { PaymentAndInvoices } from './payment-and-invoices';
import { CancellationBanner, CancelPlanCard } from './cancel-plan-card';
import { ProUpgrade } from './pro-upgrade';
import { ProYearlySwitch } from './pro-yearly';
import { cancelProPlanAction, undoProCancelAction } from '@/lib/actions/billing';
import { usePlanActions } from './plan-billing-tab';

type Summary = Extract<ProPlanSummary, { kind: 'pro' }>;

function contactUrl(): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinworkwise.com').replace(/\/$/, '');
  return `${site}/contact`;
}

/** Plain Tailwind pills (not the new-look tones) so this reads the same on the classic and new dashboard. */
function Pill({ tone, children }: { tone: 'green' | 'amber' | 'blue' | 'grey'; children: React.ReactNode }) {
  const tones = {
    green: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    amber: 'bg-amber-500/15 text-amber-800 dark:text-amber-200',
    blue: 'bg-primary/10 text-primary',
    grey: 'bg-muted text-muted-foreground',
  } as const;
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', tones[tone])}>
      {children}
    </span>
  );
}

function StatusPill({ summary }: { summary: Summary }) {
  const ends = formatBillDate(summary.currentPeriodEnd);
  if (summary.status === 'past_due') return <Pill tone="amber">Payment overdue</Pill>;
  if (summary.cancelAtPeriodEnd) return <Pill tone="grey">{ends ? `Ends ${ends}` : 'Ends soon'}</Pill>;
  if (summary.status === 'trialing') {
    const trialEnds = formatBillDate(summary.trialEndsAt);
    return <Pill tone="blue">{trialEnds ? `Free trial · ends ${trialEnds}` : 'Free trial'}</Pill>;
  }
  return <Pill tone="green">Active</Pill>;
}

function YourPlan({ summary }: { summary: Summary }) {
  const yearly = summary.interval === 'year';
  const period = yearly ? 'a year' : 'a month';
  const planLine = summary.lines[0];
  const extraLine = summary.lines.find((l) => l.label === 'Extra workers') ?? null;
  const ending = summary.cancelAtPeriodEnd;
  const ends = formatBillDate(summary.currentPeriodEnd);
  const nextWhen = summary.nextBill ? formatBillDate(summary.nextBill.date) : '';

  return (
    <section aria-labelledby="your-plan-heading">
      <SectionHeading id="your-plan-heading" icon={CreditCard} tone="blue">
        Your plan
      </SectionHeading>
      <Card className={cn('glass-card mt-3 gap-0 border-border/80 py-0', accentCardClass('blue'))}>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xl font-semibold tracking-tight">{summary.tierName}</p>
              <p className="mt-2">
                <Pill tone="blue">
                  <Users className="size-3.5" aria-hidden />
                  Pro
                </Pill>
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                {formatPence(planLine.totalPence)} {period} · {summary.included} workers included
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <StatusPill summary={summary} />
              {summary.status === 'past_due' ? (
                <p className="text-sm text-muted-foreground sm:text-right">Update your card below to clear it.</p>
              ) : null}
            </div>
          </div>

          <div className="mt-5 grid gap-4 rounded-xl bg-muted/50 p-4 sm:grid-cols-[1fr_auto] sm:gap-8">
            <div>
              <p className="text-xs text-muted-foreground">What you pay each {yearly ? 'year' : 'month'}</p>
              <dl className="mt-2 space-y-1.5 text-sm">
                {summary.lines.map((line) => (
                  <div key={line.label} className="flex items-baseline justify-between gap-6">
                    <dt className="text-foreground">
                      {line.label}
                      {line === extraLine ? (
                        <span className="ml-1.5 text-muted-foreground">
                          {line.quantity} × {formatPence(line.unitPence)}
                        </span>
                      ) : null}
                    </dt>
                    <dd className={cn('font-medium tabular-nums', line === extraLine && 'text-amber-700 dark:text-amber-300')}>
                      {formatPence(line.totalPence)}
                    </dd>
                  </div>
                ))}
                {extraLine ? null : (
                  <div className="flex items-baseline justify-between gap-6 text-muted-foreground">
                    <dt>Extra workers</dt>
                    <dd>None</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-6 border-t border-border/70 pt-2">
                  <dt className="font-semibold">{yearly ? 'Yearly' : 'Monthly'} total</dt>
                  <dd className="font-semibold tabular-nums">{formatPence(summary.monthlyPence)}</dd>
                </div>
              </dl>
            </div>
            <div className="sm:border-l sm:border-border/70 sm:pl-8 sm:text-right">
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
                  <p className="mt-1 text-[28px] leading-tight font-semibold tabular-nums tracking-tight text-primary">
                    {formatPence(summary.nextBill.amountPence)}
                  </p>
                  {nextWhen ? <p className="mt-1 text-sm text-muted-foreground">on {nextWhen}</p> : null}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {yearly ? 'Includes any changes you make before then' : 'Includes any part-month changes'}
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Next bill isn&apos;t available right now.</p>
              )}
            </div>
          </div>

          {summary.discount || summary.creditPence > 0 ? (
            <ul className="mt-4 space-y-2 text-sm">
              {summary.discount ? <li className="text-muted-foreground">{summary.discount.label}</li> : null}
              {summary.creditPence > 0 ? (
                <li className="text-muted-foreground">
                  {formatPence(summary.creditPence)} credit: comes off your next bill
                </li>
              ) : null}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

function YourTeam({ summary }: { summary: Summary }) {
  const spare = Math.max(0, summary.included - summary.used);
  const withinPlan = Math.min(summary.used, summary.included);
  return (
    <section aria-labelledby="your-team-heading">
      <SectionHeading id="your-team-heading" icon={Users} tone="violet">
        Your team
      </SectionHeading>
      <Card className={cn('glass-card mt-3 gap-0 border-border/80 py-0', accentCardClass('violet'))}>
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums">{summary.used}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {summary.used === 1 ? 'worker' : 'workers'} on your team · {summary.included} included in {summary.tierName}
              </p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/workers">
                Manage workers
                <ArrowRight className="size-4" aria-hidden />
              </Link>
            </Button>
          </div>

          <SegmentBar
            segments={[
              { count: withinPlan, label: `On your plan · ${withinPlan}`, ...BAR_COLOURS.plan },
              { count: spare, label: `Room for ${spare} more at no extra cost`, ...BAR_COLOURS.spare },
              {
                count: summary.over,
                label: `Extra workers · ${summary.over}`,
                strong: true,
                ...BAR_COLOURS.extra,
              },
            ]}
          />

          <p className="text-sm text-muted-foreground">
            {teamNote({
              over: summary.over,
              included: summary.included,
              unitPence: PRO_PLANS[summary.tier].extraPence[summary.interval],
              interval: summary.interval,
            })}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

const PRO_CANCEL_TEXT = (endsOn: string) => {
  const when = formatBillDate(endsOn);
  const stay = when ? `Your plan stays on until ${when}.` : 'Your plan stays on until the end of the period you have paid for.';
  return `${stay} After that you won't be charged again and you'll see a page to restart your plan instead of the dashboard. Your workers, customers and jobs are kept, so you can restart any time. No refund for the time left.`;
};

export function ProPlanTab({ summary }: { summary: Summary }) {
  const { pending, run } = usePlanActions();
  const overdue = summary.status === 'past_due';
  return (
    <div className="space-y-6">
      {summary.cancelAtPeriodEnd ? (
        <CancellationBanner endsOn={summary.currentPeriodEnd} pending={pending} run={run} undo={undoProCancelAction} />
      ) : null}
      <YourPlan summary={summary} />
      <YourTeam summary={summary} />
      <ProYearlySwitch summary={summary} pending={pending} run={run} />
      <ProUpgrade summary={summary} pending={pending} run={run} />
      <PaymentAndInvoices summary={summary} pending={pending} run={run} />
      <p className="glass-card rounded-xl border border-border/80 p-5 text-sm text-muted-foreground">
        To go to a smaller plan or back to monthly billing, contact us and we&apos;ll do it for you.{' '}
        <a href={contactUrl()} className="font-medium text-foreground underline underline-offset-4">
          Contact us
        </a>
        .
      </p>
      {overdue || summary.cancelAtPeriodEnd ? null : (
        <CancelPlanCard
          endsOn={summary.currentPeriodEnd}
          pending={pending}
          run={run}
          cancel={cancelProPlanAction}
          description={PRO_CANCEL_TEXT(summary.currentPeriodEnd)}
        />
      )}
    </div>
  );
}
