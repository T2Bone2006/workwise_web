'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addDayAction } from '@/lib/actions/team-pay';
import { formatDayShort } from './format-range';
import { DIALOG_SHEET } from './team-ui';

/** Add a day someone worked that the app missed (for example they forgot to press Start day). */
export function AddDayDialog({
  personId,
  name,
  dayRatePence,
  today,
  open,
  onOpenChange,
}: {
  personId: string;
  name: string;
  dayRatePence: number;
  today: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState(String(dayRatePence / 100));
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await addDayAction({ personId, date, ratePounds: rate, note });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    floatingMessage({ title: `Added ${formatDayShort(date)} for ${name}`, tone: 'success' });
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className={DIALOG_SHEET}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Add a day for {name}</DialogTitle>
            <DialogDescription>Use this for a day the app missed.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="day-date">Date</Label>
              <Input id="day-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="day-rate">Pay for the day</Label>
              <div className="relative">
                <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                <Input id="day-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="pl-7" />
              </div>
              <p className="text-xs text-muted-foreground">Change it for a half day.</p>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="day-note">Note (optional)</Label>
            <Input id="day-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoComplete="off" />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Add day
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
