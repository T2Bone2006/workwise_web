'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { setVisitWaived } from '@/lib/actions/payments';
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

export function WaiveVisitButton({
  jobId,
  customerName,
  amount,
  waived,
}: {
  jobId: string;
  customerName: string;
  amount: number;
  waived: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    const result = await setVisitWaived({ jobId, waived: !waived });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(waived ? 'Waive undone' : 'Visit waived');
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        {waived ? 'Undo waive' : 'Waive'}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{waived ? 'Undo waive' : 'Waive visit'}</DialogTitle>
            <DialogDescription>
              {waived
                ? `Put this ${formatGbp(amount)} visit back on ${customerName}'s account?`
                : `Let ${customerName} off this ${formatGbp(amount)} visit?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void handle()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {waived ? 'Undo waive' : 'Waive'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
