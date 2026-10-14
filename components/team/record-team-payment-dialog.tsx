'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { recordPaymentAction } from '@/lib/actions/team-pay';
import { formatGbp } from '@/lib/money/pence';
import { DIALOG_SHEET } from './team-ui';

/**
 * Note down what you've paid someone. The app never pays anyone. The request id is made when the dialog opens, so a
 * double click or a retry records one payment. Mount it only while open so each opening gets a fresh one.
 */
export function RecordTeamPaymentDialog({
  personId,
  name,
  owedPence,
  today,
  open,
  onOpenChange,
}: {
  personId: string;
  name: string;
  owedPence: number;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [requestId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(owedPence > 0 ? String(owedPence / 100) : '');
  const [paidOn, setPaidOn] = useState(today);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await recordPaymentAction({ personId, amount, paidOn, note, clientMutationId: requestId });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    floatingMessage({ title: `Recorded ${formatGbp(Number(amount))} paid to ${name}`, tone: 'success' });
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className={DIALOG_SHEET}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Record a payment to {name}</DialogTitle>
            <DialogDescription>This is a note of what you&apos;ve paid. It also appears in Expenses as wages.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="pay-amount">Amount</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="pl-7" autoFocus />
              </div>
              {owedPence > 0 ? <p className="text-xs text-muted-foreground">{formatGbp(owedPence / 100)} owed for the period you&apos;re looking at</p> : null}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pay-date">Date paid</Label>
              <Input id="pay-date" type="date" value={paidOn} max={today} onChange={(e) => setPaidOn(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="pay-note">Note (optional)</Label>
            <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Bank transfer" autoComplete="off" />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
