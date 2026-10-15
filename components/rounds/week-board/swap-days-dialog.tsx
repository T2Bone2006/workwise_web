'use client';

import { useEffect, useRef, useState, type JSX } from 'react';
import { format, parseISO } from 'date-fns';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { swapDays } from '@/lib/actions/rounds/visits';
import { dayMovedSms, type SmsBrand } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import type { Ymd } from '@/lib/rounds/dates';
import { canSwap, formatBoardDay, swapSummary, type BoardDay } from '@/lib/rounds/week-board';
import { cn } from '@/lib/utils';
import { CurrentDayKey, currentDayProps } from '@/components/rounds/current-day-key';
import { ChangePreview } from '@/components/messaging/change-preview';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { toldText, type BoardChangeResult } from './move-stop-dialog';

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

/** Swap one day with another: pick the other day, read the line, confirm. */
export function SwapDaysDialog(props: {
  day: BoardDay | null;
  /** The other day, already picked: the dialog opens ready to confirm. */
  initialTarget?: Ymd | null;
  today: Ymd;
  brand: SmsBrand;
  open: boolean;
  /** The board's version of any day, even one outside the weeks on screen. */
  resolveDay: (date: Ymd) => BoardDay;
  onOpenChange: (open: boolean) => void;
  /** After the server answered: the result, or null if it refused or went part-way (so the board can reload). */
  onFinished: (result: BoardChangeResult | null) => void;
}): JSX.Element {
  const { day, today } = props;
  const [target, setTarget] = useState<Ymd | null>(null);
  const [notify, setNotify] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [pending, setPending] = useState(false);
  // One key per confirm: a retry from this dialog reuses it, so a swap that already went
  // through answers "already done" instead of swapping the days back.
  const keyRef = useRef<string>('');

  useEffect(() => {
    if (props.open) {
      setTarget(props.initialTarget ?? null);
      setNotify(false);
      keyRef.current = crypto.randomUUID();
    }
  }, [props.open, props.initialTarget, day?.date]);

  const other = target ? props.resolveDay(target) : null;
  const allowed = day && other ? canSwap(day, other) : false;

  const submit = async () => {
    if (!day || !target || !allowed || pending) return;
    setPending(true);
    try {
      const result = await swapDays({
        dayA: day.date,
        dayB: target,
        clientKey: keyRef.current,
        notifyCustomers: notify,
      });
      if (!result.success) {
        toast.error(result.error);
        props.onFinished(null);
        return;
      }
      const told = notify && !result.alreadyDone;
      let text = `Swapped ${formatBoardDay(day.date)} and ${formatBoardDay(target)}`;
      if (told) text += ` · ${toldText(result.notified ?? null)}`;
      if (!result.orderSaved) text += ' · order not saved';
      props.onFinished({
        text,
        changeId: result.changeId,
        fromDate: day.date,
        toDate: target,
        told,
        revealDate: target,
        jobIds: [...day.stops, ...(other?.stops ?? [])].filter((s) => s.movable).flatMap((s) => s.jobIds),
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(next) => !pending && props.onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{day ? `Swap ${formatBoardDay(day.date)} with…` : 'Swap days'}</DialogTitle>
          <DialogDescription>
            Done and skipped visits stay where they are. You can undo it afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Other day</Label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn('w-full justify-start gap-2 font-normal', !target && 'text-muted-foreground')}
              >
                <CalendarIcon className="size-4" />
                {target ? format(parseISO(target), 'EEE d MMM yyyy') : 'Pick a day'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={target ? parseISO(target) : undefined}
                disabled={(d) => toYmd(d) < today || toYmd(d) === day?.date}
                {...currentDayProps(day?.date, today)}
                onSelect={(d) => {
                  if (!d) return;
                  setTarget(toYmd(d));
                  keyRef.current = crypto.randomUUID();
                  setCalOpen(false);
                }}
              />
              <CurrentDayKey current={day?.date} label="Swapping" />
            </PopoverContent>
          </Popover>
        </div>
        {day && other ? (
          <p className="text-sm font-medium text-foreground">
            {allowed ? swapSummary(day, other) : 'There is nothing to swap between those two days.'}
          </p>
        ) : null}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="swap-days-notify">Let customers know</Label>
            <Switch id="swap-days-notify" checked={notify} onCheckedChange={setNotify} disabled={pending} />
          </div>
          {notify && day && target ? (
            <ChangePreview
              text={dayMovedSms({
                brand: props.brand,
                fromDay: formatVisitDay(day.date),
                toDay: formatVisitDay(target),
              })}
            />
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || !allowed}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Swap
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
