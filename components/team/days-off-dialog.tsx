'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { removeDayOffAction } from '@/lib/actions/team';
import { addDayOffAndMaybePushBack } from '@/lib/actions/team-days-off';
import type { LanePerson } from '@/lib/rounds/lanes';
import { formatOffRange, groupOffWarnings, type OffWarning } from '@/lib/team/off-warning';
import { OffFixActions } from './days-off-warning';
import { DIALOG_SHEET } from './team-ui';

export type ExistingDayOff = { id: string; workerId: string; from: string; to: string; note: string | null };

/**
 * Mark someone off for some days. You, or any lead (helpers have no visits, so they aren't listed). If they still have
 * stops on those days the dialog carries straight on to fixing it; nothing moves until you choose.
 */
export function DaysOffDialog({
  people,
  existing,
  today,
  initialWorkerId,
  onClose,
}: {
  people: ReadonlyArray<LanePerson>;
  existing: ReadonlyArray<ExistingDayOff>;
  today: string;
  initialWorkerId?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const owner = people.find((p) => p.isOwner) ?? null;
  const [workerId, setWorkerId] = useState(initialWorkerId ?? people.find((p) => !p.isOwner)?.workerId ?? owner?.workerId ?? '');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fix, setFix] = useState<OffWarning | null>(null);

  const person = people.find((p) => p.workerId === workerId) ?? null;
  const name = person ? (person.isOwner ? 'You' : person.name) : 'They';
  const mine = existing.filter((d) => d.workerId === workerId).sort((a, b) => a.from.localeCompare(b.from));

  const save = async () => {
    if (pending || !person) return;
    setPending(true);
    setError(null);
    const result = await addDayOffAndMaybePushBack({ workerId, from, to, note });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const range = formatOffRange(from, to);
    const warning = groupOffWarnings(result.stops, owner?.workerId ?? null).find((w) => w.workerId === workerId) ?? null;
    if (warning) {
      setFix(warning);
      router.refresh();
      return;
    }
    floatingMessage({
      title: result.alreadySaved ? `${name} ${person.isOwner ? 'are' : 'is'} already off ${range}` : `${name} ${person.isOwner ? 'are' : 'is'} off ${range}`,
      body: 'No stops affected',
      tone: 'success',
    });
    onClose();
    router.refresh();
  };

  const remove = async (id: string) => {
    if (pending) return;
    setPending(true);
    const result = await removeDayOffAction(id);
    setPending(false);
    if (!result.ok) setError(result.error);
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent className={DIALOG_SHEET}>
        {fix ? (
          <>
            <DialogHeader>
              <DialogTitle>Days off saved</DialogTitle>
              <DialogDescription>
                {name} {person?.isOwner ? 'have' : 'has'} {fix.totalStops} {fix.totalStops === 1 ? 'stop' : 'stops'} on those days. Nothing has moved yet.
              </DialogDescription>
            </DialogHeader>
            <OffFixActions
              warning={fix}
              people={people}
              daysOff={[...existing, { id: 'new', workerId, from, to, note }]}
              onDone={() => {
                onClose();
                router.refresh();
              }}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose}>
                Fix it later
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
            className="grid gap-4"
          >
            <DialogHeader>
              <DialogTitle>Days off</DialogTitle>
              <DialogDescription>Mark yourself or a lead off. The calendar warns you about any stops on those days.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label htmlFor="off-person">Who</Label>
              <select
                id="off-person"
                value={workerId}
                onChange={(e) => setWorkerId(e.target.value)}
                className="h-9 rounded-[10px] border border-input bg-card px-3 text-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {people.map((p) => (
                  <option key={p.workerId} value={p.workerId}>
                    {p.isOwner ? 'You' : p.name}
                  </option>
                ))}
              </select>
            </div>

            {mine.length > 0 ? (
              <ul className="grid gap-2" aria-label="Booked days off">
                {mine.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl bg-(--tone-amber-soft) px-3 py-2 text-sm text-(--tone-amber-text)">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{formatOffRange(d.from, d.to)}</span>
                      {d.note ? ` · ${d.note}` : ''}
                    </span>
                    <Button type="button" variant="ghost" size="icon-xs" onClick={() => remove(d.id)} disabled={pending} aria-label={`Remove ${formatOffRange(d.from, d.to)}`}>
                      <X />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="off-from">First day</Label>
                <Input
                  id="off-from"
                  type="date"
                  value={from}
                  min={today}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (to < e.target.value) setTo(e.target.value);
                  }}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="off-to">Last day</Label>
                <Input id="off-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="off-note">Note (optional)</Label>
              <Input id="off-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Holiday" autoComplete="off" />
            </div>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter className="gap-2 sm:gap-2">
              <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
                Close
              </Button>
              <Button type="submit" disabled={pending || !person}>
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                Save days off
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
