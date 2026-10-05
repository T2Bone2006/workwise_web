'use client';

import { useCallback, useRef, useState } from 'react';
import type { PlanSummary } from '@/lib/billing/manage';
import type { PlanChoice } from '@/lib/billing/plans';
import { RestartPlanForm } from '@/components/dashboard/plan-ended';
import { CancellationBanner, CancelPlanCard } from './cancel-plan-card';
import { ChangePlanOptions } from './change-plan-options';
import { CurrentPlanCard, type PlanActionRun, type StripePlanSummary } from './current-plan-card';
import { PaymentAndInvoices } from './payment-and-invoices';
import type { ReferralData } from '@/lib/data/referral-page';
import { ReferralSummary } from './referral-summary';

function contactUrl(): string {
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://joinworkwise.com').replace(/\/$/, '');
  return `${site}/contact`;
}

export function PlanBillingSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading your plan">
      <div className="glass-card h-44 animate-pulse rounded-xl bg-muted/40" />
      <div className="glass-card h-32 animate-pulse rounded-xl bg-muted/40" />
      <div className="glass-card h-24 animate-pulse rounded-xl bg-muted/40" />
    </div>
  );
}

export function PlanBillingOwnerNotice() {
  return (
    <p className="glass-card rounded-xl border border-border/80 p-5 text-sm text-muted-foreground">
      Only the account owner can see and change the plan.
    </p>
  );
}

export function PlanBillingLoadError() {
  return (
    <p className="glass-card rounded-xl border border-border/80 p-5 text-sm text-muted-foreground">
      We couldn&apos;t load your plan. Refresh the page to try again.
    </p>
  );
}

function usePlanActions(): { pending: boolean; run: PlanActionRun } {
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const run = useCallback((task: () => Promise<void>) => {
    if (lock.current) return false;
    lock.current = true;
    setPending(true);
    void task().finally(() => {
      lock.current = false;
      setPending(false);
    });
    return true;
  }, []);
  return { pending, run };
}

function ReferralPanelSlot({ referral }: { referral: ReferralData | null }) {
  if (!referral) return null;
  return <ReferralSummary referral={referral} />;
}

/** Add Lite panel slot (step 17). Renders nothing until that step. */
function AddLitePanelSlot() {
  return null;
}

function StripePlan({ summary, referral }: { summary: StripePlanSummary; referral: ReferralData | null }) {
  const { pending, run } = usePlanActions();
  const overdue = summary.status === 'past_due';

  return (
    <div className="space-y-6">
      {summary.cancelAtPeriodEnd ? (
        <CancellationBanner endsOn={summary.currentPeriodEnd} pending={pending} run={run} />
      ) : null}
      <CurrentPlanCard summary={summary} pending={pending} run={run} />
      {overdue ? null : summary.cancelAtPeriodEnd ? (
        <section aria-labelledby="change-plan-blocked-heading">
          <h2 id="change-plan-blocked-heading" className="text-sm font-semibold">
            Change your plan
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">Undo your cancellation to change your plan.</p>
        </section>
      ) : (
        <ChangePlanOptions
          choice={summary.choice}
          periodEnd={summary.currentPeriodEnd}
          pending={pending}
          offerActive={summary.discount !== null}
          run={run}
        />
      )}
      <PaymentAndInvoices summary={summary} pending={pending} run={run} />
      <ReferralPanelSlot referral={referral} />
      <AddLitePanelSlot />
      {overdue || summary.cancelAtPeriodEnd ? null : (
        <CancelPlanCard endsOn={summary.currentPeriodEnd} pending={pending} run={run} />
      )}
    </div>
  );
}

function ContactUsCard() {
  return (
    <p className="glass-card rounded-xl border border-border/80 p-5 text-sm text-muted-foreground">
      We need to sort your plan out by hand.{' '}
      <a href={contactUrl()} className="font-medium text-foreground underline underline-offset-4">
        Contact us
      </a>{' '}
      and we&apos;ll fix it.
    </p>
  );
}

function EndedCard({ lastChoice }: { lastChoice: PlanChoice | null }) {
  return (
    <div className="glass-card space-y-4 rounded-xl border border-border/80 p-5">
      <div className="space-y-2">
        <p className="text-base font-semibold text-foreground">Your plan has ended.</p>
        <p className="text-sm text-muted-foreground">Restart your plan to keep earning free months.</p>
      </div>
      <RestartPlanForm defaultChoice={lastChoice ?? { plan: 'rounds', interval: 'month' }} />
    </div>
  );
}

export function PlanBillingTab({
  summary,
  referral = null,
}: {
  summary: Exclude<PlanSummary, { kind: 'managed' }>;
  referral?: ReferralData | null;
}) {
  if (summary.kind === 'contact_us') return <ContactUsCard />;
  if (summary.kind === 'ended') return <EndedCard lastChoice={summary.lastChoice} />;
  return <StripePlan summary={summary} referral={referral} />;
}
