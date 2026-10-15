'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarCheck, Check, Loader2, PiggyBank } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { previewProYearlyAction, switchProToYearlyAction } from '@/lib/actions/billing';
import type { ProYearlyPreview } from '@/lib/billing/pro-manage';
import type { ProPlanSummary } from '@/lib/billing/pro-plan';
import { yearlyBlockLines, yearlyDialogLines } from '@/lib/billing/pro-yearly-copy';
import { BillingDialog } from './change-plan-dialog';
import type { PlanActionRun } from './current-plan-card';

type Summary = Extract<ProPlanSummary, { kind: 'pro' }>;

function YearlyDialog({ pending, run, onClose }: { pending: boolean; run: PlanActionRun; onClose: () => void }) {
  const router = useRouter();
  // One nonce per opening: a double click can't charge twice (the server uses it as the idempotency key).
  const nonce = useRef(crypto.randomUUID());
  const [preview, setPreview] = useState<Extract<ProYearlyPreview, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionUrl, setActionUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewProYearlyAction()
      .then((result) => {
        if (cancelled) return;
        setLoading(false);
        if (!result.ok) setError(result.error);
        else setPreview(result);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError("Couldn't check the price. Nothing was charged. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const confirm = () => {
    if (!preview || pending) return;
    setError(null);
    setConfirming(true);
    const started = run(async () => {
      try {
        const result = await switchProToYearlyAction({ expectedTodayPence: preview.todayPence, nonce: nonce.current });
        if (!result.ok) {
          setError(result.error);
          return;
        }
        if ('needsAction' in result) {
          setActionUrl(result.needsAction.hostedInvoiceUrl);
          return;
        }
        toast.success('Switched to yearly');
        onClose();
        router.refresh();
      } catch {
        setError("Couldn't switch your plan. Nothing was charged. Please try again.");
      } finally {
        setConfirming(false);
      }
    });
    if (!started) setConfirming(false);
  };

  const lines = preview ? yearlyDialogLines(preview) : null;

  return (
    <BillingDialog open title="Switch to yearly?" pending={pending} onClose={onClose}>
      {loading ? (
        <div aria-hidden className="space-y-2">
          <div className="h-8 w-44 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
        </div>
      ) : null}

      {lines && !actionUrl ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-emerald-50 p-4 dark:bg-emerald-500/10">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{lines.todayLine}</p>
            {lines.creditLine ? <p className="mt-1 text-sm text-muted-foreground">{lines.creditLine}</p> : null}
          </div>
          <p className="text-sm">{lines.yearLine}</p>
          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{lines.savesLine}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={onClose}>
              Not now
            </Button>
            <Button type="button" variant="gradient" className="w-full sm:w-auto" disabled={pending} onClick={confirm}>
              {confirming ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {lines.button}
            </Button>
          </div>
        </div>
      ) : null}

      {actionUrl ? (
        <div className="space-y-3">
          <p className="text-sm">Your bank needs you to confirm this payment.</p>
          <Button asChild variant="gradient" className="w-full sm:w-auto">
            <a href={actionUrl} target="_blank" rel="noopener noreferrer">
              Confirm payment
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">Come back and refresh this page when you&apos;ve confirmed it.</p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!loading && !preview && !actionUrl ? (
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      ) : null}
    </BillingDialog>
  );
}

/** "Pay yearly and get 2 months free": shown to monthly plans only. A bright block with the real saving for this team. */
export function ProYearlySwitch({ summary, pending, run }: { summary: Summary; pending: boolean; run: PlanActionRun }) {
  const [open, setOpen] = useState(false);
  if (!summary.canSwitchToYearly) return null;

  const extras = summary.lines.find((l) => l.label === 'Extra workers')?.quantity ?? 0;
  const block = yearlyBlockLines({ tier: summary.tier, extras });

  return (
    <section aria-labelledby="yearly-heading">
      <h2 id="yearly-heading" className="text-sm font-semibold">
        Save with yearly
      </h2>
      <div className="relative mt-3 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 p-5 text-white shadow-lg sm:p-6">
        <div aria-hidden className="pointer-events-none absolute -right-14 -top-14 size-52 rounded-full bg-white/15" />
        <div aria-hidden className="pointer-events-none absolute -bottom-20 left-1/3 size-48 rounded-full bg-amber-300/25" />
        <div className="relative grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
              <CalendarCheck className="size-3.5" aria-hidden />
              Billed once a year
            </span>
            <p className="mt-4 text-2xl font-bold tracking-tight">{block.headline}</p>
            <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
              <span className="text-4xl font-extrabold tracking-tight tabular-nums">{block.yearlyLabel}</span>
              <span className="text-sm text-white/85">{block.comparison}</span>
            </p>
            <p className="mt-2 text-sm text-white/85">{block.detail}</p>
            <p className="mt-3 flex items-start gap-2 text-sm text-white/95">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-white text-emerald-800">
                <Check className="size-3" aria-hidden />
              </span>
              Your year starts the day you switch, and we take back what you haven&apos;t used this month.
            </p>
          </div>
          <div className="flex flex-col items-start gap-3 sm:items-end">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-300 px-4 py-1.5 text-base font-extrabold text-slate-900 shadow-sm">
              <PiggyBank className="size-4" aria-hidden />
              {block.savesLabel}
            </span>
            <Button
              type="button"
              className="w-full bg-white font-semibold text-emerald-800 shadow-sm hover:bg-emerald-50 sm:w-auto"
              disabled={pending}
              onClick={() => setOpen(true)}
            >
              Switch to yearly
            </Button>
          </div>
        </div>
      </div>
      {open ? <YearlyDialog pending={pending} run={run} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}
