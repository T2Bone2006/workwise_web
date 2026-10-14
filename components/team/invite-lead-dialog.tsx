'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { inviteLeadAction } from '@/lib/actions/team';
import { TEAM_HELPERS_FREE, TEAM_YEARLY_ACTIVE, TEAM_YEARLY_OFFER } from '@/lib/billing/rounds-team-core';
import { DEFAULT_USUAL_DAYS } from '@/lib/team/types';
import { DIALOG_SHEET, perLeadLabel } from './team-ui';
import { UsualDaysPicker } from './usual-days-picker';

type Confirm = { perLeadPence: number; interval: 'month' | 'year'; sentence: string };

/**
 * Add a lead: the details first, then the price the server returns, which the owner agrees to once. Nothing is
 * created and nobody is charged until the second button.
 */
export function InviteLeadDialog({
  open,
  onOpenChange,
  canAdd,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canAdd: boolean;
  reason: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [rate, setRate] = useState('');
  const [days, setDays] = useState<number[]>([...DEFAULT_USUAL_DAYS]);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setEmail('');
    setPhone('');
    setRate('');
    setDays([...DEFAULT_USUAL_DAYS]);
    setConfirm(null);
    setError(null);
    setPending(false);
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
    const result = await inviteLeadAction({
      name,
      email,
      phone,
      dayRatePounds: rate,
      usualDays: days,
      ...(confirm ? { confirmedPriceCents: confirm.perLeadPence } : {}),
    });
    setPending(false);
    if (result.ok) {
      floatingMessage({ title: `Invite sent to ${email.trim().toLowerCase()}`, tone: 'success' });
      reset();
      onOpenChange(false);
      router.refresh();
      return;
    }
    if ('needsConfirm' in result) {
      setConfirm(result.needsConfirm);
      return;
    }
    setConfirm(null);
    setError(result.error);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className={DIALOG_SHEET}>
        {confirm ? (
          <>
            <DialogHeader>
              <DialogTitle>Add {name.trim() || 'this lead'} for {perLeadLabel(confirm.perLeadPence, confirm.interval)}?</DialogTitle>
              <DialogDescription>{confirm.sentence}</DialogDescription>
            </DialogHeader>
            <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
              {confirm.interval === 'year' ? TEAM_YEARLY_ACTIVE : TEAM_YEARLY_OFFER}
            </p>
            <p className="text-sm text-muted-foreground">
              We email {email.trim().toLowerCase()} an invite. {TEAM_HELPERS_FREE}
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirm(null)} disabled={pending}>
                Back
              </Button>
              <Button type="button" onClick={submit} disabled={pending}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Add and charge {perLeadLabel(confirm.perLeadPence, confirm.interval)}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>Add a lead</DialogTitle>
              <DialogDescription>
                A lead logs in on their phone and runs a round. You&apos;ll see the price before anything is charged.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-name">Name</Label>
              <Input id="lead-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" maxLength={80} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="lead-email">Email</Label>
                <Input id="lead-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="lead-phone">Mobile</Label>
                <Input id="lead-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="off" placeholder="07…" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="lead-rate">Day rate</Label>
              <div className="relative max-w-40">
                <span className="pointer-events-none absolute top-1/2 left-3 z-10 -translate-y-1/2 text-sm text-muted-foreground">£</span>
                <Input id="lead-rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} className="pl-7" placeholder="120" />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Usual days</Label>
              <UsualDaysPicker value={days} onChange={setDays} disabled={pending} />
            </div>
            {!canAdd && reason ? <p className="text-sm text-(--tone-amber-text)">{reason}</p> : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={() => close(false)} disabled={pending}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !canAdd}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Continue
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
