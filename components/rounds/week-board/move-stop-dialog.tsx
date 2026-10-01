'use client';

import { useEffect, useState, type JSX } from 'react';
import { format } from 'date-fns';
import { CalendarIcon, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { moveStopToDay, tellCustomersAboutChange } from '@/lib/actions/rounds/visits';
import { dayMovedSms, type SmsBrand } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import type { Ymd } from '@/lib/rounds/dates';
import {
  findHouseMatch,
  formatBoardDay,
  type BoardDay,
  type BoardStop,
} from '@/lib/rounds/week-board';
import { cn } from '@/lib/utils';
import { CurrentDayKey, currentDayProps } from '@/components/rounds/current-day-key';
import { ChangePreview } from '@/components/messaging/change-preview';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

/** What a dialog hands back when it has changed something. */
export type BoardChangeResult = {
  /** "Moved Mrs Jones to Thu 8 Oct" */
  text: string;
  changeId: string | null;
  fromDate: Ymd | null;
  toDate: Ymd | null;
  /** Customers were already told (so no Tell them button). */
  told: boolean;
  /** The day to bring into view. */
  revealDate: Ymd;
  /** The jobs that moved, so the board can ring them. */
  jobIds: string[];
};

export function toldText(
  counts: { texted: number; emailed: number; held: number } | null,
  alreadyTold = false,
): string {
  if (alreadyTold) return 'Already told';
  if (!counts) return 'Told';
  return `Told ${counts.texted + counts.emailed + counts.held}`;
}

function toYmd(date: Date): Ymd {
  return format(date, 'yyyy-MM-dd');
}

/** Pick a day for one stop. It goes to the end of that day; drag it for an exact spot. */
export function MoveStopDialog(props: {
  stop: BoardStop | null;
  fromDate: Ymd;
  today: Ymd;
  brand: SmsBrand;
  open: boolean;
  /** The board's version of any day, to tell whether the stop would join a visit there. */
  resolveDay: (date: Ymd) => BoardDay;
  onOpenChange: (open: boolean) => void;
  /** After the server answered: the result, or null if it refused (so the board can reload). */
  onFinished: (result: BoardChangeResult | null) => void;
}): JSX.Element {
  const { stop, fromDate, today } = props;
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [notify, setNotify] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (props.open) {
      setToDate(undefined);
      setNotify(false);
    }
  }, [props.open, stop?.id]);

  const submit = async () => {
    if (!stop || !toDate || pending) return;
    const target = toYmd(toDate);
    setPending(true);
    try {
      const moved = await moveStopToDay({ jobIds: stop.jobIds, toDate: target });
      if (!moved.success) {
        toast.error(moved.error);
        props.onFinished(null);
        return;
      }
      const joins = findHouseMatch(props.resolveDay(target), stop) !== null;
      let text = joins
        ? `Added to ${stop.name}'s visit on ${formatBoardDay(target)}`
        : `Moved ${stop.name} to ${formatBoardDay(target)}`;
      let told = false;
      if (notify && moved.changeId) {
        const result = await tellCustomersAboutChange({ changeId: moved.changeId });
        if (result.success) {
          told = true;
          text += ` · ${toldText(result.notified, result.alreadyTold)}`;
        } else {
          text += " · couldn't tell them";
        }
      }
      if (!moved.orderSaved) text += ' · put at the end of the day';
      props.onFinished({
        text,
        changeId: moved.changeId,
        fromDate,
        toDate: target,
        told,
        revealDate: target,
        jobIds: stop.jobIds,
      });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={(next) => !pending && props.onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{stop ? `Move ${stop.name}` : 'Move'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label>Move to</Label>
          <Popover open={calOpen} onOpenChange={setCalOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className={cn('w-full justify-start gap-2 font-normal', !toDate && 'text-muted-foreground')}
              >
                <CalendarIcon className="size-4" />
                {toDate ? format(toDate, 'EEE d MMM yyyy') : 'Pick a date'}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={toDate}
                disabled={(d) => toYmd(d) < today || toYmd(d) === fromDate}
                {...currentDayProps(fromDate, today)}
                onSelect={(d) => {
                  setToDate(d);
                  setCalOpen(false);
                }}
              />
              <CurrentDayKey current={fromDate} />
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="move-stop-notify">Let customers know</Label>
            <Switch id="move-stop-notify" checked={notify} onCheckedChange={setNotify} disabled={pending} />
          </div>
          {notify && toDate ? (
            <ChangePreview
              text={dayMovedSms({
                brand: props.brand,
                fromDay: formatVisitDay(fromDate),
                toDay: formatVisitDay(toYmd(toDate)),
              })}
            />
          ) : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={pending || !toDate}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
