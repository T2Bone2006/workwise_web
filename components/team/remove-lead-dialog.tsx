'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { endHelperAction, removeLeadAction } from '@/lib/actions/team';
import type { TeamPagePerson } from '@/lib/data/team-page-core';
import { formatGbp } from '@/lib/money/pence';
import { DIALOG_SHEET, perLeadLabel } from './team-ui';

/** Remove a lead (cut off straight away) or a helper (stops being offered). Says plainly what happens. */
export function RemoveLeadDialog({
  person,
  perLeadPence,
  interval,
  open,
  onOpenChange,
}: {
  person: TeamPagePerson;
  perLeadPence: number;
  interval: 'month' | 'year' | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isLead = person.kind === 'lead';
  const held = person.heldCashPence;

  const remove = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    if (isLead) {
      const result = await removeLeadAction(person.id);
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      floatingMessage({
        title: `${person.name} removed`,
        body:
          result.visitsReturned > 0
            ? `${result.visitsReturned} upcoming ${result.visitsReturned === 1 ? 'visit is' : 'visits are'} back with you`
            : undefined,
        tone: 'success',
      });
    } else {
      const result = await endHelperAction(person.id);
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      floatingMessage({ title: `${person.name} removed`, tone: 'success' });
    }
    onOpenChange(false);
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogContent className={DIALOG_SHEET}>
        <DialogHeader>
          <DialogTitle>Remove {person.name}?</DialogTitle>
          <DialogDescription>
            {isLead
              ? `${person.name} is logged out straight away. Their upcoming visits come back to you. The ${perLeadLabel(perLeadPence, interval)} stops. Their past days and pay stay on record.`
              : `${person.name} stays in your pay records. They won't appear in Who's with you.`}
          </DialogDescription>
        </DialogHeader>
        {isLead && held > 0 ? (
          <p className="rounded-xl bg-(--tone-rose-soft) px-3 py-2.5 text-sm text-(--tone-rose-text)">
            {person.name} still has {formatGbp(held / 100)} of yours. It stays on your hand-in list.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={pending}>
            Keep {person.name}
          </Button>
          <Button type="button" variant="destructive" onClick={remove} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Remove {person.name}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
