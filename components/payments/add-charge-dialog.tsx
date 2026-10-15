'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { addCustomerCharge } from '@/lib/actions/charges';
import { formatGbp, parseMoneyInput } from '@/lib/money/pence';
import { todayInLondon } from '@/lib/rounds/dates';
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

/** "Add amount owed" on the dashboard money card (Phase 4 D12). Mount with a fresh key per open. */
export function AddChargeDialog({
  customerId,
  customerName,
  open,
  onOpenChange,
}: {
  customerId: string;
  customerName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const today = todayInLondon();
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    if (description.trim() === '') {
      setError('Add a short description.');
      return;
    }
    const parsed = parseMoneyInput(amount);
    if (parsed == null || parsed <= 0) {
      setError('Enter an amount over £0.');
      return;
    }
    if (!date) {
      setError('Enter a date.');
      return;
    }
    if (date > today) {
      setError("The date can't be in the future.");
      return;
    }

    setPending(true);
    const result = await addCustomerCharge({
      customerId,
      description,
      amount: parsed,
      chargeDate: date,
      kind: 'other',
    });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(
      result.owedAmount != null
        ? `Added — ${customerName} now owes ${formatGbp(result.owedAmount)}`
        : 'Added',
    );
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add amount owed</DialogTitle>
          <DialogDescription>
            Anything {customerName} owes that isn&apos;t a visit. Payments pay it off like a visit, oldest first.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="charge-description">What for</Label>
            <Input
              id="charge-description"
              placeholder="e.g. Owed from before WorkWise"
              maxLength={120}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="charge-amount">Amount (£)</Label>
            <Input
              id="charge-amount"
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="charge-date">Date</Label>
            <Input
              id="charge-date"
              type="date"
              max={today}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handle()} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Add
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
