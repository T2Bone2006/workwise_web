'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Trash2, UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deactivateCustomer,
  deleteCustomer,
} from '@/lib/actions/customers';

interface CustomerDeleteButtonProps {
  customerId: string;
  customerName: string;
  useDeactivate: boolean;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function CustomerDeleteButton({
  customerId,
  customerName,
  useDeactivate,
  variant = 'outline',
  size = 'sm',
}: CustomerDeleteButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const handleConfirm = async () => {
    setIsPending(true);
    const result = useDeactivate
      ? await deactivateCustomer(customerId)
      : await deleteCustomer(customerId);
    setIsPending(false);
    setOpen(false);
    if (result.success) {
      toast.success(useDeactivate ? 'Customer deactivated' : 'Customer deleted');
      router.push('/customers');
      router.refresh();
    } else {
      toast.error(
        result.error ??
          (useDeactivate ? 'Failed to deactivate customer' : 'Failed to delete customer')
      );
    }
  };

  const ActionIcon = useDeactivate ? UserMinus : Trash2;
  const actionLabel = useDeactivate ? 'Deactivate' : 'Delete';
  const confirmLabel = useDeactivate ? 'Deactivate' : 'Delete';

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={
          variant === 'outline'
            ? 'text-destructive hover:bg-destructive/10 hover:text-destructive'
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        <ActionIcon className="mr-2 size-4" />
        {actionLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {useDeactivate ? 'Deactivate customer' : 'Delete customer'}
            </DialogTitle>
            <DialogDescription>
              {useDeactivate ? (
                <>
                  This will deactivate this customer. Their job history will be preserved. You
                  can reactivate them at any time.
                </>
              ) : (
                <>Are you sure you want to delete {customerName}? This action cannot be undone.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirm}
              disabled={isPending}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
