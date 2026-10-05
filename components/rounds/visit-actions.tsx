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
import { dayMovedSms, daySkippedSms, type SmsBrand } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';
import { CurrentDayKey, currentDayProps } from '@/components/rounds/current-day-key';
import { ChangePreview } from '@/components/messaging/change-preview';
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

function smsDay(ymd: string): string {
  return isValidYmd(ymd) ? formatVisitDay(ymd) : ymd;
}

function toldLine(
  notify: boolean,
  notified?: { texted: number; emailed: number; held: number },
): string {
  if (!notify || !notified) return 'not told';
  const told = notified.texted + notified.emailed + notified.held;
  if (told < 1) return 'not told';
  return `told ${told} customer${told === 1 ? '' : 's'}`;
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
      const notRecorded =
        payment && !result.paymentRecorded
          ? ` ${formatGbp(payment.amount)} was not recorded — if you took it, use Mark as paid on the customer's page.`
          : '';
      if (result.skippedElsewhere) {
        toast.warning(`This visit was skipped, so it wasn't marked done.${notRecorded}`);
      } else if (result.alreadyCompleted) {
        if (notRecorded) toast.warning(`Already done.${notRecorded}`);
        else toast.success('Already done');
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
            <p className="rounded-md border border-(--tone-amber-line) bg-(--tone-amber-soft) px-3 py-2 text-sm text-(--tone-amber-text)">
              No email — they&apos;ll get a text instead if they have a mobile and texts are left.
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
  scheduledDate,
  brand,
  open,
  onOpenChange,
}: {
  jobId: string;
  scheduledDate?: string | null;
  brand: SmsBrand;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState<(typeof USER_SKIP_REASONS)[number]>('no_access');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(false);
  const [pending, setPending] = useState(false);
  const day = scheduledDate ? smsDay(scheduledDate) : 'that day';

  const handle = async () => {
    setPending(true);
    const result = await skipVisit({ jobId, reason, note, notifyCustomer: notify });
    setPending(false);
    if (result.success) {
      toast.success(notify ? `Visit skipped · ${toldLine(true, result.notified)}` : 'Visit skipped');
      onOpenChange(false);
      setNote('');
      setNotify(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setNotify(false);
        onOpenChange(next);
      }}
    >
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
                    ? 'border-(--tone-emerald-line) bg-(--tone-emerald-soft)'
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
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`skip-notify-${jobId}`}>Let the customer know</Label>
            <Switch
              id={`skip-notify-${jobId}`}
              checked={notify}
              onCheckedChange={setNotify}
              disabled={pending}
            />
          </div>
          {notify ? (
            <ChangePreview text={daySkippedSms({ brand, day, nextDay: null })} />
          ) : null}
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
  brand,
  open,
  onOpenChange,
}: {
  jobId: string;
  initialDate?: string | null;
  initialTime?: string | null;
  brand: SmsBrand;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState<Date | undefined>(
    initialDate ? parseYmd(initialDate) : undefined,
  );
  const [time, setTime] = useState(initialTime?.slice(0, 5) ?? '');
  const [notify, setNotify] = useState(false);
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
      notifyCustomer: notify,
    });
    setPending(false);
    if (result.success) {
      toast.success(notify ? `Visit moved · ${toldLine(true, result.notified)}` : 'Visit moved');
      setNotify(false);
      onOpenChange(false);
      router.refresh();
    } else {
      toast.error(result.error);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setNotify(false);
        onOpenChange(next);
      }}
    >
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
                  {...currentDayProps(initialDate)}
                  onSelect={(d) => {
                    setDate(d);
                    setCalOpen(false);
                  }}
                />
                <CurrentDayKey current={initialDate} />
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
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor={`reschedule-notify-${jobId}`}>Let the customer know</Label>
            <Switch
              id={`reschedule-notify-${jobId}`}
              checked={notify}
              onCheckedChange={setNotify}
              disabled={pending}
            />
          </div>
          {notify && date && initialDate ? (
            <ChangePreview
              text={dayMovedSms({
                brand,
                fromDay: smsDay(initialDate),
                toDay: smsDay(toYmd(date)),
              })}
            />
          ) : null}
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
  brand,
  open,
  onOpenChange,
}: {
  fromDate: Ymd;
  leftoverCount: number;
  brand: SmsBrand;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [notify, setNotify] = useState(true);
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
      notifyCustomers: notify,
    });
    setPending(false);
    if (result.success) {
      toast.success(`Moved ${result.moved} · ${toldLine(notify, result.notified)}`);
      onOpenChange(false);
      setToDate(undefined);
      router.refresh();
    } else {
      toast.error(result.error);
    }
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
                {...currentDayProps(fromDate)}
                onSelect={(d) => {
                  setToDate(d);
                  setCalOpen(false);
                }}
              />
              <CurrentDayKey current={fromDate} label="Moving from" />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="move-remaining-notify">Let customers know</Label>
            <Switch
              id="move-remaining-notify"
              checked={notify}
              onCheckedChange={setNotify}
              disabled={pending}
            />
          </div>
          {notify && toDate ? (
            <ChangePreview
              text={dayMovedSms({
                brand,
                fromDay: smsDay(fromDate),
                toDay: smsDay(toYmd(toDate)),
              })}
            />
          ) : null}
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
  brand,
}: {
  jobId: string;
  status: string;
  quotedAmount?: number | null;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  customerSendsInvoice: boolean;
  customerHasEmail: boolean;
  brand: SmsBrand;
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
        scheduledDate={scheduledDate}
        brand={brand}
        open={skipOpen}
        onOpenChange={setSkipOpen}
      />
      <RescheduleVisitDialog
        jobId={jobId}
        initialDate={scheduledDate}
        initialTime={scheduledTime}
        brand={brand}
        open={rescheduleOpen}
        onOpenChange={setRescheduleOpen}
      />
    </>
  );
}
