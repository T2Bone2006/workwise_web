'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { editDayAction } from '@/lib/actions/team-pay';
import type { DayRow } from '@/lib/team/pay';
import { formatDayShort } from './format-range';
import { DIALOG_SHEET } from './team-ui';

/** Change what a day was worth (a half day, say) or its note. The date and who worked don't change. */
export function EditDayDialog({
  day,
  name,
  open,
  onOpenChange,
}: {
  day: DayRow;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [rate, setRate] = useState(String(day.ratePence / 100));
  const [note, setNote] = useState(day.note ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await editDayAction({ id: day.id, ratePounds: rate, note });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    floatingMessage({ title: `Updated ${formatDayShort(day.date)} for ${name}`, tone: 'success' });
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
            <DialogTitle>
              {formatDayShort(day.date)} for {name}
            </DialogTitle>
            <DialogDescription>Change the pay for the day, for example to a half day.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-day-rate">Pay for the day</Label>
            <div className="relative max-w-40">
              <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-sm text-muted-foreground">£</span>
              <Input id="edit-day-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="pl-7" autoFocus />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-day-note">Note (optional)</Label>
            <Input id="edit-day-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} autoComplete="off" />
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
              Save day
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
