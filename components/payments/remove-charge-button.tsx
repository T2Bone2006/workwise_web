'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { voidCustomerCharge } from '@/lib/actions/charges';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Removes (voids) an "other amount owed". Money paid towards it goes back to the balance. */
export function RemoveChargeButton({
  chargeId,
  description,
}: {
  chargeId: string;
  description: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    const result = await voidCustomerCharge({ chargeId });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success('Removed');
    setOpen(false);
    router.refresh();
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Remove
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove amount owed</DialogTitle>
            <DialogDescription>
              Remove &ldquo;{description}&rdquo;? Anything already paid towards it goes back to their balance.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Keep it
            </Button>
            <Button onClick={() => void handle()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
