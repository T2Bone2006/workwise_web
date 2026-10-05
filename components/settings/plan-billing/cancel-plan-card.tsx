'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cancelPlanAction, undoCancelAction } from '@/lib/actions/billing';
import { formatBillDate, type PlanActionRun } from './current-plan-card';
import { BillingDialog } from './change-plan-dialog';

export function CancellationBanner({
  endsOn,
  pending,
  run,
}: {
  endsOn: string;
  pending: boolean;
  run: PlanActionRun;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const when = formatBillDate(endsOn);

  const undo = () => {
    if (pending) return;
    setError(null);
    setUndoing(true);
    const started = run(async () => {
      try {
        const result = await undoCancelAction();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast.success('Cancellation undone');
        router.refresh();
      } finally {
        setUndoing(false);
      }
    });
    if (!started) setUndoing(false);
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-muted/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm font-medium">{when ? `Your plan ends on ${when}.` : 'Your plan is ending.'}</p>
      <div className="flex flex-col items-start gap-2 sm:items-end">
        <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={undo}>
          {undoing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Undo
        </Button>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function CancelPlanCard({
  endsOn,
  pending,
  run,
}: {
  endsOn: string;
  pending: boolean;
  run: PlanActionRun;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const when = formatBillDate(endsOn);
  const stay = when
    ? `Your plan stays on until ${when}.`
    : 'Your plan stays on until the end of the period you have paid for.';
  const description = `${stay} After that, reminders, texts and Direct Debit collections stop and you won't be charged again. Your customers and history are kept, so you can restart any time.`;

  const confirm = () => {
    if (pending) return;
    setError(null);
    setCancelling(true);
    const started = run(async () => {
      try {
        const result = await cancelPlanAction();
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setOpen(false);
        router.refresh();
      } finally {
        setCancelling(false);
      }
    });
    if (!started) setCancelling(false);
  };

  return (
    <section aria-labelledby="cancel-plan-heading" className="border-t border-border/60 pt-6">
      <h2 id="cancel-plan-heading" className="sr-only">
        Cancel plan
      </h2>
      <Button
        type="button"
        variant="ghost"
        className="text-muted-foreground"
        disabled={pending}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        Cancel plan
      </Button>
      <BillingDialog
        open={open}
        title="Cancel plan"
        description={description}
        pending={pending}
        onClose={() => {
          if (!cancelling) setOpen(false);
        }}
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="gradient" className="w-full sm:w-auto" disabled={pending} onClick={() => setOpen(false)}>
            Keep my plan
          </Button>
          <Button type="button" variant="outline" className="w-full sm:w-auto" disabled={pending} onClick={confirm}>
            {cancelling ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Cancel plan
          </Button>
        </div>
        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </BillingDialog>
    </section>
  );
}
