'use client';

import { Loader2, ShieldCheck, UserPlus } from 'lucide-react';
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
import type { ExtraWorkerNotice } from '@/lib/billing/pro-allowance';
import { formatPoundsLong } from '@/lib/billing/pro-plans';

/** The words and figures the dialog shows, worked out once so the text and the button always agree. */
export function noticeFigures(n: ExtraWorkerNotice) {
  const yearly = n.interval === 'year';
  const unit = n.perWorkerPence;
  if (!yearly) {
    const pounds = n.extraWorkerPounds;
    return {
      yearly,
      billed: 'monthly',
      headline: `+£${pounds}`,
      small: 'a month',
      then: null as string | null,
      total: `${n.extrasAfter} × £${pounds} = £${n.extrasAfter * pounds}`,
      button: `£${pounds} a month`,
      credit: null as string | null,
    };
  }
  const total = `${n.extrasAfter} × ${formatPoundsLong(unit)} = ${formatPoundsLong(n.extrasAfter * unit)} a year`;
  const credit = 'Remove a worker later and the unused part comes back as credit on your account.';
  if (typeof n.chargeNowPence === 'number') {
    return {
      yearly,
      billed: 'yearly',
      headline: `${formatPoundsLong(n.chargeNowPence)} now`,
      small: 'for the rest of your year',
      then: `then ${formatPoundsLong(unit)} a year`,
      total,
      button: `${formatPoundsLong(n.chargeNowPence)} now`,
      credit,
    };
  }
  return {
    yearly,
    billed: 'yearly',
    headline: `${formatPoundsLong(unit)} a year`,
    small: 'charged for the months you have left',
    then: null as string | null,
    total,
    button: `${formatPoundsLong(unit)} a year`,
    credit,
  };
}

/** The team against the plan: workers the plan includes, extras already added, and the one being added. */
function PlanBar({ notice }: { notice: ExtraWorkerNotice }) {
  const earlierExtras = notice.extrasAfter - 1;
  return (
    <SegmentBar
      segments={[
        { count: notice.included, label: `Included in your plan · ${notice.included}`, ...BAR_COLOURS.plan },
        { count: earlierExtras, label: `Extras already added · ${earlierExtras}`, ...BAR_COLOURS.extraEarlier },
        { count: 1, label: 'This worker', strong: true, ...BAR_COLOURS.extra },
      ]}
    />
  );
}

/**
 * Shown when adding a worker would go past the plan's included workers. Pressing
 * the button is the account holder's agreement to the extra-worker price, so it
 * says plainly what this worker costs and what the extras come to in total.
 */
export function ExtraWorkerConfirmDialog({
  notice,
  pending,
  onConfirm,
  onCancel,
}: {
  notice: ExtraWorkerNotice | null;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const figures = notice ? noticeFigures(notice) : null;
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
                <UserPlus className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
                  Over your {notice.tierName} plan
                </p>
                <DialogTitle className="text-lg leading-snug">
                  Add worker number {notice.workerNumber}?
                </DialogTitle>
              </div>
            </DialogHeader>

            <div className="space-y-3 px-6 pb-6">
              <DialogDescription className="text-sm text-muted-foreground">
                Your plan covers {notice.included} workers. Anyone after that is an extra worker,
                billed {figures.billed} with your subscription.
              </DialogDescription>

              <div className="rounded-2xl border border-border bg-muted/30 p-4">
                <PlanBar notice={notice} />
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                      Adding this worker costs
                    </p>
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
                    <p className="text-xs text-amber-800/80 dark:text-amber-200/80">
                      Your extras in total
                    </p>
                    <p className="text-sm font-semibold text-amber-800 tabular-nums dark:text-amber-200">
                      {figures.total}
                    </p>
                  </div>
                </div>
              </div>

              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                Nothing changes for the first {notice.included} workers.
              </p>
              {figures.credit ? <p className="text-xs text-muted-foreground">{figures.credit}</p> : null}
            </div>

            <DialogFooter className="gap-2 border-t border-border bg-muted/30 px-6 py-4 sm:justify-end">
              <Button type="button" variant="outline" onClick={onCancel} disabled={pending}>
                Cancel
              </Button>
              <Button type="button" variant="gradient" onClick={onConfirm} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Add for {figures.button}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
