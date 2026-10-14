'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addHelperAction } from '@/lib/actions/team';
import { DEFAULT_USUAL_DAYS } from '@/lib/team/types';
import { DIALOG_SHEET } from './team-ui';
import { UsualDaysPicker } from './usual-days-picker';

/** Add a helper: a name you pay by the day. No login, no email, no price. */
export function AddHelperDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [days, setDays] = useState<number[]>([...DEFAULT_USUAL_DAYS]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setRate('');
    setDays([...DEFAULT_USUAL_DAYS]);
    setError(null);
  };
  const close = (next: boolean) => {
    if (pending) return;
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async () => {
    if (pending) return;
    if (rate.trim() === '') {
      setError('Enter a day rate.');
      return;
    }
    setPending(true);
    setError(null);
    const result = await addHelperAction({ name, dayRatePounds: rate, usualDays: days });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    floatingMessage({ title: `${name.trim()} added to your team`, tone: 'success' });
    reset();
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={DIALOG_SHEET}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Add a helper</DialogTitle>
            <DialogDescription>
              A helper is a name on your team. They don&apos;t log in, they cost nothing a month, and you can pay them by the day.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="helper-name">Name</Label>
            <Input id="helper-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="helper-rate">Day rate</Label>
            <div className="relative max-w-40">
              <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-sm text-muted-foreground">£</span>
              <Input id="helper-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="pl-7" placeholder="90" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Usual days</Label>
            <UsualDaysPicker value={days} onChange={setDays} disabled={pending} />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="ghost" onClick={() => close(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Add helper
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
