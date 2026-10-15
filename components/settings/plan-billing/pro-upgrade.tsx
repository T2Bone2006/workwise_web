'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Check, Loader2, Sparkles, TrendingDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { previewProUpgradeAction, upgradeProTierAction } from '@/lib/actions/billing';
import type { ProUpgradePreview } from '@/lib/billing/pro-manage';
import type { ProPlanSummary } from '@/lib/billing/pro-plan';
import { PRO_PLANS, formatPoundsLong, type ProTier } from '@/lib/billing/pro-plans';
import { upgradeCardLines, upgradeDialogLines } from '@/lib/billing/pro-upgrade-copy';
import { cn } from '@/lib/utils';
import { BillingDialog } from './change-plan-dialog';
import type { PlanActionRun } from './current-plan-card';

type Summary = Extract<ProPlanSummary, { kind: 'pro' }>;

const REASON_TEXT: Record<NonNullable<Summary['upgradeBlockedReason']>, string> = {
  ending: 'Undo your cancellation to change your plan.',
  overdue: 'Update your card first, then you can change your plan.',
  waiting: 'Your last change is still waiting for your bank to confirm the payment.',
  custom: 'Your plan has a custom set-up, so contact us to change it.',
};

/** One solid colour per tier, so each upgrade reads as its own offer. */
const TIER_LOOK: Record<ProTier, { block: string; glow: string }> = {
  starter: { block: 'bg-gradient-to-br from-sky-500 to-blue-600', glow: 'bg-cyan-300/25' },
  growth: { block: 'bg-gradient-to-br from-blue-600 via-blue-600 to-indigo-700', glow: 'bg-sky-300/25' },
  pro: { block: 'bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600', glow: 'bg-amber-300/30' },
};

function UpgradeDialog({
  target,
  pending,
  run,
  onClose,
}: {
  target: ProTier;
  pending: boolean;
  run: PlanActionRun;
  onClose: () => void;
}) {
  const router = useRouter();
  // One nonce per opening: a double click can't charge twice (the server uses it as the idempotency key).
  const nonce = useRef(crypto.randomUUID());
  const [preview, setPreview] = useState<Extract<ProUpgradePreview, { ok: true }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionUrl, setActionUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewProUpgradeAction(target)
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
  }, [target]);

  const confirm = () => {
    if (!preview || pending) return;
    setError(null);
    setConfirming(true);
    const started = run(async () => {
      try {
        const result = await upgradeProTierAction({ target, expectedTodayPence: preview.todayPence, nonce: nonce.current });
        if (!result.ok) {
          if (result.preview?.ok) setPreview(result.preview);
          setError(result.error);
          return;
        }
        if ('needsAction' in result) {
          setActionUrl(result.needsAction.hostedInvoiceUrl);
          return;
        }
        toast.success(`You're on ${PRO_PLANS[target].name}`);
        onClose();
        router.refresh();
      } catch {
        setError("Couldn't change your plan. Nothing was charged. Please try again.");
      } finally {
        setConfirming(false);
      }
    });
    if (!started) setConfirming(false);
  };

  const lines = preview
    ? upgradeDialogLines({
        target,
        todayPence: preview.todayPence,
        thenLabel: preview.thenLabel,
        renewsOn: preview.renewsOn,
        overAfter: preview.overAfter,
        includedAfter: preview.includedAfter,
      })
    : null;

  return (
    <BillingDialog open title={`Upgrade to ${PRO_PLANS[target].name}?`} pending={pending} onClose={onClose}>
      {loading ? (
        <div aria-hidden className="space-y-2">
          <div className="h-8 w-44 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
        </div>
      ) : null}

      {lines && !actionUrl ? (
        <div className="space-y-3">
          <div className="rounded-xl bg-muted/50 p-4">
            <p className="text-2xl font-semibold tracking-tight tabular-nums">{lines.todayLine}</p>
            <p className="mt-1 text-sm text-muted-foreground">{lines.thenLine}</p>
          </div>
          <p className="text-sm text-muted-foreground">{lines.extrasLine}</p>
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

/** "Need more room?": the tiers above this one, what they change, and one button each. */
export function ProUpgrade({ summary, pending, run }: { summary: Summary; pending: boolean; run: PlanActionRun }) {
  const [target, setTarget] = useState<ProTier | null>(null);

  if (summary.tier === 'pro') return null; // nothing above Pro
  const reason = summary.upgradeBlockedReason;

  return (
    <section aria-labelledby="upgrade-heading">
      <h2 id="upgrade-heading" className="text-sm font-semibold">
        Need more room?
      </h2>
      {summary.canUpgradeTo.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{reason ? REASON_TEXT[reason] : 'Contact us to change your plan.'}</p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {summary.canUpgradeTo.map((tier) => {
            const lines = upgradeCardLines({ from: summary.tier, to: tier, interval: summary.interval, team: summary.used });
            const yearly = summary.interval === 'year';
            const biggest = tier === 'pro';
            const look = TIER_LOOK[tier];
            return (
              <div
                key={tier}
                className={cn('relative flex flex-col overflow-hidden rounded-2xl p-5 text-white shadow-lg sm:p-6', look.block)}
              >
                <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 size-44 rounded-full bg-white/15" />
                <div aria-hidden className={cn('pointer-events-none absolute -bottom-16 -left-10 size-40 rounded-full', look.glow)} />
                <div className="relative flex h-full flex-col">
                  <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur-sm">
                    <Sparkles className="size-3.5" aria-hidden />
                    {biggest ? 'Room for the whole crew' : 'Next step up'}
                  </span>
                  <p className="mt-4 text-2xl font-bold tracking-tight">{lines.roomLine}</p>
                  <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                    <span className="text-4xl font-extrabold tracking-tight tabular-nums">
                      {formatPoundsLong(PRO_PLANS[tier].pence[summary.interval])}
                    </span>
                    <span className="text-sm text-white/80">
                      {yearly ? 'a year' : 'a month'} on {lines.title}
                    </span>
                  </p>
                  <p
                    className={cn(
                      'mt-3 inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-[13px] font-bold',
                      lines.deltaTone === 'save' ? 'bg-emerald-300 text-emerald-950' : 'bg-white/20 text-white',
                    )}
                  >
                    {lines.deltaTone === 'save' ? <TrendingDown className="size-3.5" aria-hidden /> : null}
                    {lines.deltaLine}
                  </p>
                  <ul className="mt-4 space-y-2 text-sm">
                    {[
                      lines.includedLine,
                      `Extra workers drop to ${lines.extraAfterLabel} each (now ${lines.extraNowLabel})`,
                      lines.hasExtrasEffect ? lines.effectLine : null,
                    ]
                      .filter((text): text is string => Boolean(text))
                      .map((text) => (
                        <li key={text} className="flex items-start gap-2">
                          <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-white text-slate-900">
                            <Check className="size-3" aria-hidden />
                          </span>
                          <span className="text-white/95">{text}</span>
                        </li>
                      ))}
                  </ul>
                  <Button
                    type="button"
                    className="mt-5 w-full gap-1.5 bg-amber-300 font-semibold text-slate-900 shadow-sm hover:bg-amber-200"
                    disabled={pending}
                    onClick={() => setTarget(tier)}
                  >
                    Upgrade to {lines.title}
                    <ArrowUpRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {target ? (
        <UpgradeDialog key={target} target={target} pending={pending} run={run} onClose={() => setTarget(null)} />
      ) : null}
    </section>
  );
}
