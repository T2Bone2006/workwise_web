'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { CalendarIcon, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { formatGbp, parseMoneyInput } from '@/lib/money/pence';
import {
  completeVisit,
  moveRemaining,
  rescheduleVisit,
  skipVisit,
} from '@/lib/actions/rounds/visits';
import {
  SKIP_REASON_LABELS,
  USER_SKIP_REASONS,
  type SkipReason,
} from '@/lib/rounds/skip-reasons';
import type { Ymd } from '@/lib/rounds/dates';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Calendar } from '@/components/ui/calendar';
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

function parseYmd(ymd: string): Date {
  return parseISO(ymd);
}

function formatYmdDisplay(ymd: string): string {
  try {
    return format(parseYmd(ymd), 'EEE d MMM yyyy');
  } catch {
    return ymd;
  }
}

export function CompleteVisitButton({
  jobId,
  quotedAmount,
  customerSendsInvoice,
  customerHasEmail,
  size = 'sm',
}: {
  jobId: string;
  quotedAmount?: number | null;
  customerSendsInvoice: boolean;
  customerHasEmail: boolean;
  size?: 'default' | 'sm' | 'lg' | 'icon';
}) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);

  return (
    <>
      <Button
        size={size}
        className="min-w-0"
        onClick={() => {
          setSession((n) => n + 1);
          setOpen(true);
        }}
      >
        <Check className="mr-1 size-4 sm:mr-1.5" />
        Done
      </Button>
      <CompleteVisitDialog
        key={session}
        jobId={jobId}
        quotedAmount={quotedAmount ?? null}
        customerSendsInvoice={customerSendsInvoice}
        customerHasEmail={customerHasEmail}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}

export function CompleteVisitDialog({
  jobId,
  quotedAmount,
  customerSendsInvoice,
  customerHasEmail,
  open,
  onOpenChange,
}: {
  jobId: string;
  quotedAmount: number | null;
  customerSendsInvoice: boolean;
  customerHasEmail: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [method, setMethod] = useState<'cash' | 'cheque' | null>(null);
  const [amount, setAmount] = useState('');
  const [sendInvoice, setSendInvoice] = useState(customerSendsInvoice);
  const [pending, setPending] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);

  const parsedAmount = method ? parseMoneyInput(amount) : null;
  const creditHint =
    parsedAmount != null && quotedAmount != null && parsedAmount > quotedAmount
      ? parsedAmount - quotedAmount
      : null;

  const selectMethod = (next: 'cash' | 'cheque') => {
    if (method === next) {
      setMethod(null);
      setAmount('');
      setAmountError(null);
      return;
    }
    setMethod(next);
    setAmount(quotedAmount != null ? String(quotedAmount) : '');
    setAmountError(null);
  };

  const handle = async () => {
    let payment: { method: 'cash' | 'cheque'; amount: number } | null = null;
    if (method) {
      const parsed = parseMoneyInput(amount);
      if (parsed == null || parsed <= 0) {
        setAmountError('Enter an amount');
        return;
      }
      payment = { method, amount: parsed };
    }

    setPending(true);
    const result = await completeVisit({
      jobId,
      finalAmount: quotedAmount ?? null,
      payment,
      sendInvoice,
    });
    setPending(false);
    if (result.success) {
      if (result.alreadyCompleted) {
        toast.success('Already done');
      } else if (payment) {
        toast.success(`Marked done · ${formatGbp(payment.amount)} ${payment.method} recorded`);
      } else {
        toast.success('Marked done');
      }
      onOpenChange(false);
      router.refresh();
      return;
    }
    toast.error(result.error);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as done</DialogTitle>
          <DialogDescription>{formatGbp(quotedAmount)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">Paid today?</p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={method === 'cash' ? 'default' : 'outline'}
                onClick={() => selectMethod('cash')}
              >
                Cash
              </Button>
              <Button
                type="button"
                variant={method === 'cheque' ? 'default' : 'outline'}
                onClick={() => selectMethod('cheque')}
              >
                Cheque
              </Button>
            </div>
            {method ? (
              <div className="space-y-1">
                <Label htmlFor={`done-amount-${jobId}`}>Amount</Label>
                <Input
                  id={`done-amount-${jobId}`}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setAmountError(null);
                  }}
                />
                {amountError ? (
                  <p className="text-sm text-destructive">{amountError}</p>
                ) : null}
                {creditHint != null ? (
                  <p className="text-sm text-muted-foreground">
                    {formatGbp(creditHint)} will be credit for next time.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={`send-invoice-${jobId}`}>Send invoice</Label>
              <Switch
                id={`send-invoice-${jobId}`}
                checked={sendInvoice}
                onCheckedChange={setSendInvoice}
              />
            </div>
            <p className="text-sm text-muted-foreground">Remembered for this customer.</p>
          </div>
          {customerHasEmail ? null : (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              No email for this customer — they won&apos;t get the visit-done message.
            </p>
          )}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void handle()} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Mark done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SkipVisitDialog({
  jobId,
  open,
  onOpenChange,
}: {
  jobId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<(typeof USER_SKIP_REASONS)[number]>('no_access');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    const result = await skipVisit({ jobId, reason, note });
    setPending(false);
    if (result.success) {
      toast.success('Visit skipped');
      onOpenChange(false);
      setNote('');
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Skip this visit</DialogTitle>
          <DialogDescription>
            One house this cycle only. If the rest of the day is hopeless, use
            Move remaining on the day plan instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid gap-2">
            {USER_SKIP_REASONS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setReason(value)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                  reason === value
                    ? 'border-emerald-400/50 bg-emerald-500/10'
                    : 'border-border/80 hover:bg-muted/40',
                )}
              >
                {SKIP_REASON_LABELS[value as SkipReason]}
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="skip-note">Note (optional)</Label>
            <Textarea
              id="skip-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              maxLength={300}
              className="resize-none"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handle()} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Skip visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RescheduleVisitDialog({
  jobId,
  initialDate,
  initialTime,
  open,
  onOpenChange,
}: {
  jobId: string;
  initialDate?: string | null;
  initialTime?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState<Date | undefined>(
    initialDate ? parseYmd(initialDate) : undefined,
  );
  const [time, setTime] = useState(initialTime?.slice(0, 5) ?? '');
  const [calOpen, setCalOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handle = async () => {
    if (!date) {
      toast.error('Pick a date');
      return;
    }
    setPending(true);
    const result = await rescheduleVisit({
      jobId,
      scheduledDate: toYmd(date),
      scheduledTime: time || '',
    });
    setPending(false);
    if (result.success) {
      toast.success('Visit moved');
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule visit</DialogTitle>
          <DialogDescription>
            Moves this one house. Later visits on a fixed agreement stay put.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Popover open={calOpen} onOpenChange={setCalOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn(
                    'w-full justify-start gap-2 font-normal',
                    !date && 'text-muted-foreground',
                  )}
                >
                  <CalendarIcon className="size-4" />
                  {date ? format(date, 'EEE d MMM yyyy') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    setDate(d);
                    setCalOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reschedule-time">Time (optional)</Label>
            <Input
              id="reschedule-time"
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handle()} disabled={pending || !date}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveRemainingDialog({
  fromDate,
  leftoverCount,
  open,
  onOpenChange,
}: {
  fromDate: Ymd;
  leftoverCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [calOpen, setCalOpen] = useState(false);
  const [pending, setPending] = useState(false);

  const handle = async () => {
    if (!toDate) {
      toast.error('Pick a target date');
      return;
    }
    const target = toYmd(toDate);
    if (target === fromDate) {
      toast.error('Pick a different day');
      return;
    }
    setPending(true);
    const result = await moveRemaining({
      fromDate,
      toDate: target,
      scheduledTime: '',
    });
    setPending(false);
    if (result.success) {
      toast.success(
        `${result.moved} stop${result.moved === 1 ? '' : 's'} moved to ${formatYmdDisplay(target)}`,
      );
      onOpenChange(false);
      setToDate(undefined);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move remaining</DialogTitle>
          <DialogDescription>
            {leftoverCount} stop{leftoverCount === 1 ? '' : 's'} not yet done on{' '}
            {formatYmdDisplay(fromDate)} will move to the date you pick. Done
            stays done. Next cycle stays put.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Move to</Label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn(
                  'w-full justify-start gap-2 font-normal',
                  !toDate && 'text-muted-foreground',
                )}
              >
                <CalendarIcon className="size-4" />
                {toDate ? format(toDate, 'EEE d MMM yyyy') : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toDate}
                onSelect={(d) => {
                  setToDate(d);
                  setCalOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handle()} disabled={pending || !toDate}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Move {leftoverCount} stop{leftoverCount === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Per-stop action cluster: Done + Skip + Reschedule triggers. */
export function VisitActionButtons({
  jobId,
  status,
  quotedAmount,
  scheduledDate,
  scheduledTime,
  customerSendsInvoice,
  customerHasEmail,
}: {
  jobId: string;
  status: string;
  quotedAmount?: number | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  customerSendsInvoice: boolean;
  customerHasEmail: boolean;
}) {
  const [skipOpen, setSkipOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);

  const actionable = [
    'assigned',
    'accepted',
    'en_route',
    'arrived',
    'in_progress',
    'paused',
  ].includes(status);

  if (!actionable) return null;

  return (
    <>
      <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:flex-wrap">
        <CompleteVisitButton
          jobId={jobId}
          quotedAmount={quotedAmount}
          customerSendsInvoice={customerSendsInvoice}
          customerHasEmail={customerHasEmail}
        />
        <Button
          variant="outline"
          size="sm"
          className="min-w-0"
          onClick={() => setSkipOpen(true)}
        >
          Skip
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="min-w-0 px-2 sm:px-3"
          onClick={() => setRescheduleOpen(true)}
        >
          <span className="sm:hidden">Move</span>
          <span className="hidden sm:inline">Reschedule</span>
        </Button>
      </div>
      <SkipVisitDialog
        jobId={jobId}
        open={skipOpen}
        onOpenChange={setSkipOpen}
      />
      <RescheduleVisitDialog
        jobId={jobId}
        initialDate={scheduledDate}
        initialTime={scheduledTime}
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
      />
    </>
  );
}
