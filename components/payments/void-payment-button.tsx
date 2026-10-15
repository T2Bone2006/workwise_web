'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { voidPayment } from '@/lib/actions/payments';
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

export function VoidPaymentButton({
  paymentId,
  amount,
  methodLabel,
}: {
  paymentId: string;
  amount: number;
  methodLabel: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    const result = await voidPayment({ paymentId, reason });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Payment cancelled');
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Cancel payment
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel this payment?</DialogTitle>
            <DialogDescription>
              This {formatGbp(amount)} {methodLabel} payment won&apos;t count, and the visits will show as unpaid again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor={`void-reason-${paymentId}`}>Reason (optional)</Label>
            <Input
              id={`void-reason-${paymentId}`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button onClick={() => void handle()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Cancel payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
