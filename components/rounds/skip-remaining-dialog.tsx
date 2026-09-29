'use client';

import { useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { skipRemaining } from '@/lib/actions/rounds/visits';
import { daySkippedSms, type SmsBrand } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd, type Ymd } from '@/lib/rounds/dates';
import { ChangePreview } from '@/components/messaging/change-preview';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

function toldLine(
  notify: boolean,
  notified?: { texted: number; emailed: number; held: number },
): string {
  if (!notify || !notified) return 'not told';
  const told = notified.texted + notified.emailed + notified.held;
  if (told < 1) return 'not told';
  return `told ${told} customer${told === 1 ? '' : 's'}`;
}

export function SkipRemainingDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  remainingCount: number;
  brand: SmsBrand;
}): JSX.Element {
  const { open, onOpenChange, date, remainingCount, brand } = props;
  const router = useRouter();
  const [notify, setNotify] = useState(true);
  const [pending, setPending] = useState(false);
  const day = isValidYmd(date) ? formatVisitDay(date) : date;

  const confirm = async () => {
    setPending(true);
    const result = await skipRemaining({ date: date as Ymd, notifyCustomers: notify });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(`Skipped ${result.skipped} · ${toldLine(notify, result.notified)}`);
    setNotify(true);
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setNotify(true);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Skip the rest of {day}?</DialogTitle>
          <DialogDescription>
            {remainingCount} stop{remainingCount === 1 ? '' : 's'} not done yet will be skipped.
            Their next visits stay where they are.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="skip-remaining-notify">Let customers know</Label>
            <Switch
              id="skip-remaining-notify"
              checked={notify}
              onCheckedChange={setNotify}
              disabled={pending}
            />
          </div>
          {notify ? (
            <ChangePreview
              text={daySkippedSms({ brand, day, nextDay: '<their next visit>' })}
            />
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Skip the rest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
