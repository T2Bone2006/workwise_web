'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { changePlanAction, previewPlanChangeAction } from '@/lib/actions/billing';
import { formatPence, type PlanChoice } from '@/lib/billing/plans';
import { formatBillDate, type PlanActionRun } from './current-plan-card';
import type { PlanOffer } from './change-plan-options';

type ReadyPreview = Extract<Awaited<ReturnType<typeof previewPlanChangeAction>>, { ok: true }>;

function isReadyPreview(value: unknown): value is ReadyPreview {
  if (!value || typeof value !== 'object') return false;
  if (!('ok' in value) || value.ok !== true) return false;
  if (!('kind' in value) || (value.kind !== 'up_now' && value.kind !== 'down_at_renewal')) return false;
  if (!('todayPence' in value) || typeof value.todayPence !== 'number') return false;
  if (!('thenLabel' in value) || typeof value.thenLabel !== 'string') return false;
  if (!('effectiveDate' in value) || typeof value.effectiveDate !== 'string') return false;
  if (!('target' in value) || !value.target || typeof value.target !== 'object') return false;
  return true;
}

function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const apply = () => setNarrow(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);
  return narrow;
}

function switchingOff(from: PlanChoice, to: PlanChoice): 'Lite' | 'Rounds' | null {
  if (from.plan !== 'both') return null;
  if (to.plan === 'rounds') return 'Lite';
  if (to.plan === 'lite') return 'Rounds';
  return null;
}

function downCopy(preview: ReadyPreview, from: PlanChoice): string {
  const when = formatBillDate(preview.effectiveDate);
  const fromWhen = when ? `From ${when}` : 'From your next renewal';
  const dropped = switchingOff(from, preview.target);
  if (dropped) {
    return `Nothing to pay now. ${fromWhen} you'll pay ${preview.thenLabel}, and ${dropped} switches off that day.`;
  }
  return `Nothing to pay now. ${fromWhen} you'll pay ${preview.thenLabel}.`;
}

function upCopy(preview: ReadyPreview, from: PlanChoice, periodEnd: string): string {
  const renews = 'renewsOn' in preview && typeof preview.renewsOn === 'string' ? formatBillDate(preview.renewsOn) : '';
  if (from.interval !== preview.target.interval && renews) {
    return `That covers your plan until ${renews}. Then ${preview.thenLabel} from ${renews}.`;
  }
  const period = from.interval === 'month' ? 'month' : 'year';
  const when = formatBillDate(periodEnd);
  const then = when ? ` Then ${preview.thenLabel} from ${when}.` : ` Then ${preview.thenLabel}.`;
  return `That's the difference for the rest of this ${period}.${then}`;
}

function successText(from: PlanChoice, preview: ReadyPreview, applied: 'now' | 'at_renewal'): string {
  if (applied === 'at_renewal') {
    const when = formatBillDate(preview.effectiveDate);
    return when ? `Change booked for ${when}` : 'Change booked';
  }
  if (from.plan !== 'both' && preview.target.plan === 'both') {
    return from.plan === 'lite' ? 'Rounds added' : 'Lite added';
  }
  if (from.interval === 'month' && preview.target.interval === 'year') return 'Switched to yearly';
  return 'Plan updated';
}

function PreviewSkeleton() {
  return (
    <div>
      <div className="space-y-2" aria-hidden>
        <div className="h-8 w-44 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded-md bg-muted" />
      </div>
      <span className="sr-only">Checking the amount</span>
    </div>
  );
}

export function BillingDialog({
  open,
  title,
  description,
  pending,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  description?: string;
  pending: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const narrow = useNarrow();
  const onOpenChange = (next: boolean) => {
    if (!next && !pending) onClose();
  };

  if (narrow) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-2xl px-5 pt-6 pb-6">
          <SheetHeader className="p-0 pr-8 text-left">
            <SheetTitle>{title}</SheetTitle>
            {description ? <SheetDescription className="text-foreground">{description}</SheetDescription> : null}
          </SheetHeader>
          <div className="mt-4">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-left sm:text-left">
          <DialogTitle>{title}</DialogTitle>
          {description ? (
            <DialogDescription className="text-left text-foreground">{description}</DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export function ChangePlanDialog({
  offer,
  nonce,
  current,
  periodEnd,
  pending,
  run,
  onClose,
}: {
  offer: PlanOffer;
  nonce: string;
  current: PlanChoice;
  periodEnd: string;
  pending: boolean;
  run: PlanActionRun;
  onClose: () => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<ReadyPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [needsActionUrl, setNeedsActionUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewPlanChangeAction(offer.target)
      .then((result) => {
        if (cancelled) return;
        setLoading(false);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setPreview(result);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setError("Couldn't check the price. Nothing was charged. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [offer.target, nonce]);

  const confirm = () => {
    if (!preview || pending) return;
    setError(null);
    setConfirming(true);
    const expected = preview.todayPence;
    const started = run(async () => {
      try {
        const result = await changePlanAction(offer.target, expected, nonce);
        if (result.ok && 'needsAction' in result) {
          setNeedsActionUrl(result.needsAction.hostedInvoiceUrl);
          return;
        }
        if (result.ok && 'applied' in result) {
          toast.success(successText(current, preview, result.applied));
          onClose();
          router.refresh();
          return;
        }
        const returnedPreview = !result.ok && 'preview' in result ? result.preview : undefined;
        if (!result.ok && result.error.includes('amount has changed') && isReadyPreview(returnedPreview)) {
          setPreview(returnedPreview);
          setError(result.error);
          return;
        }
        if (!result.ok) setError(result.error);
      } catch {
        setError("Couldn't change your plan. Nothing was charged. Please try again.");
      } finally {
        setConfirming(false);
      }
    });
    if (!started) setConfirming(false);
  };

  const sentence = preview
    ? preview.kind === 'up_now'
      ? upCopy(preview, current, periodEnd)
      : downCopy(preview, current)
    : null;

  return (
    <BillingDialog open title={offer.title} pending={pending} onClose={onClose}>
      <div className="space-y-4" aria-busy={loading || confirming}>
        {loading ? <PreviewSkeleton /> : null}
        {preview?.kind === 'up_now' ? (
          <p className="text-2xl font-semibold tabular-nums tracking-tight">
            Pay {formatPence(preview.todayPence)} now
          </p>
        ) : null}
        {sentence ? (
          <p className={preview?.kind === 'up_now' ? 'text-sm text-muted-foreground' : 'text-base'}>{sentence}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {needsActionUrl ? (
          <div className="space-y-3">
            <p className="text-sm">Your bank wants to confirm this payment.</p>
            <Button
              type="button"
              variant="gradient"
              className="w-full sm:w-auto"
              onClick={() => window.open(needsActionUrl, '_blank', 'noopener,noreferrer')}
            >
              Confirm with your bank
            </Button>
            <p className="text-sm text-muted-foreground">Your plan changes as soon as it&apos;s paid.</p>
          </div>
        ) : preview && !loading ? (
          <Button
            type="button"
            variant="gradient"
            className="w-full sm:w-auto"
            disabled={pending || confirming}
            onClick={confirm}
          >
            {confirming ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {preview.kind === 'up_now' ? `Confirm and pay ${formatPence(preview.todayPence)}` : 'Confirm change'}
          </Button>
        ) : null}
      </div>
    </BillingDialog>
  );
}
