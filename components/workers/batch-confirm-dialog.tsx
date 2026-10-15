'use client';

import { Loader2, ShieldCheck, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BAR_COLOURS, SegmentBar } from '@/components/workers/segment-bar';
import { PRO_PLANS, formatPoundsLong } from '@/lib/billing/pro-plans';
import type { BatchNotice } from '@/lib/billing/pro-allowance';

/** The figures a batch confirmation shows, worked out once so the text and the button always agree. */
export function batchFigures(notice: BatchNotice, interval: 'month' | 'year' | null, chargeNowPence: number | null) {
  const yearly = interval === 'year';
  const unit = PRO_PLANS[notice.tier].extraPence[yearly ? 'year' : 'month'];
  const total = notice.extrasAfter * unit;
  if (yearly && chargeNowPence !== null) {
    return {
      yearly,
      headline: `${formatPoundsLong(chargeNowPence)} now`,
      small: 'for the rest of your year',
      then: `then ${formatPoundsLong(total)} a year`,
      total: `${notice.extrasAfter} × ${formatPoundsLong(unit)} = ${formatPoundsLong(total)} a year`,
      button: `${formatPoundsLong(chargeNowPence)} now`,
    };
  }
  if (yearly) {
    const newTotal = notice.newExtras * unit;
    return {
      yearly,
      headline: `${formatPoundsLong(newTotal)} a year`,
      small: 'charged for the months you have left',
      then: null,
      total: `${notice.extrasAfter} × ${formatPoundsLong(unit)} = ${formatPoundsLong(total)} a year`,
      button: `${formatPoundsLong(newTotal)} a year`,
    };
  }
  const newTotal = notice.newExtras * unit;
  return {
    yearly,
    headline: `+${formatPoundsLong(newTotal)}`,
    small: 'a month',
    then: null,
    total: `${notice.extrasAfter} × ${formatPoundsLong(unit)} = ${formatPoundsLong(total)} a month`,
    button: `${formatPoundsLong(newTotal)} a month`,
  };
}

/**
 * One confirmation for a whole batch: the team against the plan (on your plan, extras already there, new extras)
 * and what the batch costs. Pressing the button is the owner's agreement to the extra-worker price.
 */
export function BatchConfirmDialog({
  notice,
  interval,
  chargeNowPence,
  pending,
  onConfirm,
  onCancel,
}: {
  notice: BatchNotice | null;
  interval: 'month' | 'year' | null;
  chargeNowPence: number | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const figures = notice ? batchFigures(notice, interval, chargeNowPence) : null;
  return (
    <Dialog open={notice !== null} onOpenChange={(o) => (!o && !pending ? onCancel() : undefined)}>
      <DialogContent className="max-w-md gap-0 overflow-hidden p-0 sm:max-w-md">
        {notice && figures ? (
          <>
            <DialogHeader className="flex-row items-center gap-3 space-y-0 px-6 pb-4 pt-6 text-left">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                aria-hidden="true"
              >
                <Users className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
                  Over your {notice.tierName} plan
                </p>
                <DialogTitle className="text-lg leading-snug">Add {notice.adding} workers?</DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-3 px-6 pb-6">
              <DialogDescription className="text-sm text-muted-foreground">
                Your plan covers {notice.included} workers. After this your team is {notice.teamAfter}, so{' '}
                {notice.newExtras === 1 ? '1 more is an extra worker' : `${notice.newExtras} more are extra workers`}, billed{' '}
                {figures.yearly ? 'yearly' : 'monthly'} with your subscription.
              </DialogDescription>

              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <SegmentBar
                  segments={[
                    {
                      count: Math.min(notice.teamAfter, notice.included),
                      label: `On your plan · ${Math.min(notice.teamAfter, notice.included)}`,
                      ...BAR_COLOURS.plan,
                    },
                    {
                      count: notice.extrasBefore,
                      label: `Extras already added · ${notice.extrasBefore}`,
                      ...BAR_COLOURS.extraEarlier,
                    },
                    { count: notice.newExtras, label: `New extras · ${notice.newExtras}`, strong: true, ...BAR_COLOURS.extra },
                  ]}
                />
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Adding these workers costs</p>
                    <p className="mt-0.5 text-3xl font-semibold leading-none tracking-tight text-amber-700 tabular-nums dark:text-amber-300">
                      {figures.headline}
                      <span
                        className={
                          figures.yearly
                            ? 'mt-1 block text-sm font-medium leading-snug text-amber-800/80 dark:text-amber-200/80'
                            : 'ml-1 text-sm font-medium text-amber-800/80 dark:text-amber-200/80'
                        }
                      >
                        {figures.small}
                      </span>
                    </p>
                    {figures.then ? (
                      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">{figures.then}</p>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-amber-800/80 dark:text-amber-200/80">Your extras in total</p>
                    <p className="text-sm font-semibold text-amber-800 tabular-nums dark:text-amber-200">{figures.total}</p>
                  </div>
                </div>
              </div>

              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Nothing changes for the first {notice.included} workers.
              </p>
            </div>

            <DialogFooter className="gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:justify-end">
              <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" variant="gradient" onClick={onConfirm} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Add {notice.adding} workers for {figures.button}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
