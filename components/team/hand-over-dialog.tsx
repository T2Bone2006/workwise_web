'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { handOverAction, undoHandOverAction } from '@/lib/actions/team-cash';
import { formatGbp } from '@/lib/money/pence';
import { DIALOG_SHEET } from './team-ui';

export type HandOverTarget = {
  /** 'all' clears everything the person holds; 'selected' ticks the listed payments. */
  mode: 'all' | 'selected';
  name: string;
  workerId: string | null;
  /** The payments listed on screen (the ones the owner is looking at). */
  paymentIds: string[];
  total: number;
  /** The most recent day any of them was taken (YYYY-MM-DD): the hand-over can't be before it. */
  latestTaken: string;
};

/** Confirm a hand-over: what will be ticked, and the day it was handed over (today unless it was earlier). */
export function HandOverDialog({
  target,
  today,
  onClose,
}: {
  target: HandOverTarget;
  today: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = target.paymentIds.length;

  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await handOverAction(
      target.mode === 'all' && target.workerId
        ? { workerId: target.workerId, handedOverOn: date }
        : { paymentIds: target.paymentIds, handedOverOn: date },
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (result.changed === 0) {
      floatingMessage({ title: 'Nothing to tick', tone: 'success' });
    } else {
      const ids = target.paymentIds;
      floatingMessage({
        title: `Ticked ${result.changed} ${result.changed === 1 ? 'payment' : 'payments'} (${formatGbp(target.total)})`,
        tone: 'success',
        actions: [
          {
            label: 'Undo',
            onClick: async () => {
              for (const paymentId of ids) await undoHandOverAction({ paymentId });
              router.refresh();
            },
          },
        ],
      });
    }
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent className={DIALOG_SHEET}>
        <DialogHeader>
          <DialogTitle>
            {target.name} handed over {formatGbp(target.total)}?
          </DialogTitle>
          <DialogDescription>
            This ticks {count} {count === 1 ? 'payment' : 'payments'} ({formatGbp(target.total)}). The cash then counts in your money, on the day you pick.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor="handed-over-on">Handed over on</Label>
          <Input
            id="handed-over-on"
            type="date"
            className="max-w-48"
            value={date}
            min={target.latestTaken}
            max={today}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={confirm} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
