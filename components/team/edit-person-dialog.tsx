'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { renamePersonAction, setDayRateAction, setUsualDaysAction } from '@/lib/actions/team';
import type { TeamPagePerson } from '@/lib/data/team-page-core';
import { DIALOG_SHEET } from './team-ui';
import { UsualDaysPicker } from './usual-days-picker';

function sameDays(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((d, i) => d === b[i]);
}

/** Change a person's name, day rate and usual days. Only what changed is sent. Mount with key={person.id}. */
export function EditPersonDialog({
  person,
  open,
  onOpenChange,
}: {
  person: TeamPagePerson;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(person.name);
  const [rate, setRate] = useState(String(person.dayRatePence / 100));
  const [days, setDays] = useState<number[]>([...person.usualDays].sort((a, b) => a - b));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (pending) return;
    setPending(true);
    setError(null);

    const steps: Array<() => Promise<{ ok: boolean; error?: string }>> = [];
    if (name.trim() !== person.name) steps.push(() => renamePersonAction(person.id, name));
    if (Math.round(Number(rate) * 100) !== person.dayRatePence) {
      steps.push(() => setDayRateAction({ personId: person.id, dayRatePounds: rate }));
    }
    if (!sameDays(days, [...person.usualDays].sort((a, b) => a - b))) {
      steps.push(() => setUsualDaysAction({ personId: person.id, usualDays: days }));
    }

    for (const step of steps) {
      const result = await step();
      if (!result.ok) {
        setPending(false);
        setError(result.error ?? 'Could not save that. Try again.');
        router.refresh();
        return;
      }
    }
    setPending(false);
    if (steps.length > 0) floatingMessage({ title: `${name.trim()} updated`, tone: 'success' });
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className={DIALOG_SHEET}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>Edit {person.name}</DialogTitle>
            <DialogDescription>
              A new day rate applies from the next day worked. Days already worked keep the rate they were recorded at.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoComplete="off" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="edit-rate">Day rate</Label>
            <div className="relative max-w-40">
              <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-sm text-muted-foreground">£</span>
              <Input id="edit-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="pl-7" />
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
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
