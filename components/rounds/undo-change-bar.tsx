'use client';

import { useEffect, useState, type JSX } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { tellCustomersAboutChange, undoVisitChange } from '@/lib/actions/rounds/visits';
import { afterAllSms, dayMovedSms, type SmsBrand } from '@/lib/messaging/templates';
import { formatVisitDay } from '@/lib/payments/messages';
import { isValidYmd } from '@/lib/rounds/dates';
import type { VisitChangeSummary } from '@/lib/rounds/visit-changes';
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

/** Only a change you have just made is worth a bar. Older ones stay undoable elsewhere but don't sit here. */
const RECENT_MS = 60 * 60 * 1000;

function dayLabel(ymd: string | null): string | null {
  if (!ymd || !isValidYmd(ymd)) return null;
  return formatVisitDay(ymd);
}

function ago(iso: string): string | null {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function summaryLine(change: VisitChangeSummary): string {
  const n = change.jobCount;
  const noun = n === 1 ? 'visit' : 'stops';
  const told = change.notifiedAt
    ? ` · told ${n} customer${n === 1 ? '' : 's'}`
    : '';
  const when = ago(change.createdAt);
  const tail = `${told}${when ? ` · ${when}` : ''}`;
  if (change.kind === 'skip' || change.kind === 'skip_remaining') {
    return `Skipped ${n} ${noun}${tail}`;
  }
  if (change.kind === 'swap_days') {
    const a = dayLabel(change.fromDate) ?? 'a day';
    const b = dayLabel(change.toDate) ?? 'a day';
    return `Swapped ${a} and ${b} · ${n} ${noun}${tail}`;
  }
  const to = dayLabel(change.toDate);
  const where = to ? ` to ${to}` : '';
  return `Moved ${n} ${noun}${where}${tail}`;
}

export function UndoChangeBar(props: {
  change: VisitChangeSummary | null;
  brand: SmsBrand;
}): JSX.Element | null {
  const { change, brand } = props;
  const router = useRouter();
  const [dismissedId, setDismissedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [tell, setTell] = useState(true);
  const [pending, setPending] = useState(false);
  const [tellOpen, setTellOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  if (!change || dismissedId === change.id) return null;
  if (now - new Date(change.createdAt).getTime() > RECENT_MS) return null;

  const canTell =
    change.notifiedAt == null &&
    (change.kind === 'reschedule' || change.kind === 'move_remaining' || change.kind === 'swap_days');

  const sendTell = async () => {
    setPending(true);
    const result = await tellCustomersAboutChange({ changeId: change.id });
    setPending(false);
    setTellOpen(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    const told = result.notified.texted + result.notified.emailed + result.notified.held;
    toast.success(result.alreadyTold ? 'Already told' : `Told ${told}`);
    router.refresh();
  };

  const restoredDay = dayLabel(change.fromDate) ?? dayLabel(change.toDate) ?? 'that day';

  const undo = async () => {
    setPending(true);
    const result = await undoVisitChange({
      changeId: change.id,
      notifyCustomers: change.notifiedAt ? tell : false,
    });
    setPending(false);
    if (!result.success) {
      toast.error(result.error);
      if (result.error === 'Already undone' || result.error === 'Too old to undo') {
        setDismissedId(change.id);
        setOpen(false);
      }
      return;
    }
    const left =
      result.leftAlone > 0
        ? ` · ${result.leftAlone} was already done, left as it is`
        : '';
    toast.success(`Put back ${result.restored}${left}`);
    setOpen(false);
    setDismissedId(change.id);
    router.refresh();
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/40 px-3 py-2 text-sm">
        <p className="text-foreground">{summaryLine(change)}</p>
        <div className="flex items-center gap-2">
          {canTell ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setTellOpen(true)}>
              Tell them
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Undo
          </Button>
        </div>
      </div>
      <Dialog open={tellOpen} onOpenChange={(next) => !pending && setTellOpen(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tell them?</DialogTitle>
          </DialogHeader>
          {change.toDate ? (
            <ChangePreview
              text={dayMovedSms({
                brand,
                fromDay: dayLabel(change.fromDate) ?? dayLabel(change.toDate) ?? 'that day',
                toDay: dayLabel(change.toDate) ?? 'that day',
              })}
            />
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setTellOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void sendTell()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) setTell(true);
          setOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Put them back?</DialogTitle>
            <DialogDescription>
              {change.jobCount === 1
                ? 'This visit goes back to how it was.'
                : 'These visits go back to how they were. Any already done stay done.'}
            </DialogDescription>
          </DialogHeader>
          {change.notifiedAt ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="undo-tell">Tell the customers who were told</Label>
                <Switch
                  id="undo-tell"
                  checked={tell}
                  onCheckedChange={setTell}
                  disabled={pending}
                />
              </div>
              {tell ? <ChangePreview text={afterAllSms({ brand, day: restoredDay })} /> : null}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void undo()} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Put them back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
