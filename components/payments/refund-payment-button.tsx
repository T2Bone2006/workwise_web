'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { refundPaymentAction } from '@/lib/actions/direct-debit';
import { formatGbp } from '@/lib/money/pence';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Refund all or part of a Direct Debit / Pay by Bank payment. GoCardless sends the money back to the customer's bank. */
export function RefundPaymentButton({
  paymentId,
  left,
  customerName,
}: {
  paymentId: string;
  /** What can still be refunded. */
  left: number;
  customerName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(left.toFixed(2));
  const [pending, setPending] = useState(false);

  const value = Number(amount);
  const valid = Number.isFinite(value) && value >= 0.01 && value <= left + 0.001;

  const handle = async () => {
    setPending(true);
    const result = await refundPaymentAction({ paymentId, amount: Math.round(value * 100) / 100 });
    setPending(false);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`${formatGbp(result.refunded)} refunded`);
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setAmount(left.toFixed(2));
          setOpen(true);
        }}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        Refund
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Refund {customerName}?</DialogTitle>
            <DialogDescription>
              GoCardless sends the money back to their bank, and it can take a few days to arrive. We&apos;ll
              let them know. You can refund up to {formatGbp(left, { always2dp: true })}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`refund-amount-${paymentId}`}>Amount (£)</Label>
            <Input
              id={`refund-amount-${paymentId}`}
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Don&apos;t refund
            </Button>
            <Button onClick={() => void handle()} disabled={pending || !valid}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Refund {valid ? formatGbp(value, { always2dp: true }) : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
