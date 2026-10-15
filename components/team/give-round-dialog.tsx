'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { undoVisitChange } from '@/lib/actions/rounds/visits';
import { giveRoundAction } from '@/lib/actions/team-assign';
import type { LanePerson } from '@/lib/rounds/lanes';
import { formatOffRange, type OffWarning } from '@/lib/team/off-warning';
import { cn } from '@/lib/utils';
import { DIALOG_SHEET } from './team-ui';

export type OffRange = { workerId: string; from: string; to: string };

/**
 * Hand a day's round to someone else. Choose the day (or all the affected days), then who: anyone who isn't off that
 * day. Nothing moves until Give round. Helpers have no login or lane, so they are never offered.
 */
export function GiveRoundDialog({
  warning,
  people,
  daysOff,
  onClose,
}: {
  warning: OffWarning;
  people: ReadonlyArray<LanePerson>;
  daysOff: ReadonlyArray<OffRange>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [date, setDate] = useState(warning.days[0]!.date);
  const [allDays, setAllDays] = useState(false);
  const [toId, setToId] = useState<string>('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenDays = useMemo(() => (allDays ? warning.days : warning.days.filter((d) => d.date === date)), [allDays, date, warning.days]);
  const offOn = (workerId: string, ymd: string) => daysOff.some((d) => d.workerId === workerId && d.from <= ymd && ymd <= d.to);
  const candidates = people.filter((p) => p.workerId !== warning.workerId);
  const target = candidates.find((p) => p.workerId === toId) ?? null;
  const owner = warning.isOwner;
  const possessive = owner ? 'your' : `${warning.name}'s`;
  const targetName = target ? (target.isOwner ? 'You' : target.name) : '';

  const give = async () => {
    if (pending || !target) return;
    setPending(true);
    setError(null);
    const changeIds: string[] = [];
    let moved = 0;
    for (const d of chosenDays) {
      const result = await giveRoundAction({ date: d.date, fromWorkerId: warning.workerId, toWorkerId: target.workerId });
      if (!result.success) {
        setPending(false);
        setError(result.error);
        router.refresh();
        return;
      }
      moved += result.moved;
      if (result.changeId) changeIds.push(result.changeId);
    }
    setPending(false);
    if (moved === 0) {
      setError('Nothing to give: those visits were already done or moved.');
      router.refresh();
      return;
    }
    const weekday = (ymd: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
    floatingMessage({
      title:
        chosenDays.length === 1
          ? `Gave ${possessive} ${weekday(chosenDays[0]!.date)} round to ${targetName} (${moved} ${moved === 1 ? 'stop' : 'stops'})`
          : `Gave ${possessive} rounds on ${chosenDays.length} days to ${targetName} (${moved} stops)`,
      tone: 'success',
      actions: changeIds.length
        ? [
            {
              label: 'Undo',
              onClick: async () => {
                for (const changeId of changeIds.reverse()) await undoVisitChange({ changeId, notifyCustomers: false });
                router.refresh();
              },
            },
          ]
        : undefined,
    });
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent className={DIALOG_SHEET}>
        <DialogHeader>
          <DialogTitle>Give {possessive} round to…</DialogTitle>
          <DialogDescription>{warning.text}</DialogDescription>
        </DialogHeader>

        {warning.days.length > 1 ? (
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Which day</legend>
            <div className="flex flex-wrap gap-2">
              {warning.days.map((d) => (
                <button
                  key={d.date}
                  type="button"
                  disabled={allDays}
                  aria-pressed={!allDays && date === d.date}
                  onClick={() => setDate(d.date)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-sm font-medium transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50',
                    !allDays && date === d.date ? 'border-transparent bg-(--tone-rounds-solid) text-white' : 'border-border bg-card',
                  )}
                >
                  {formatOffRange(d.date, d.date)} · {d.visitCount}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={allDays} onCheckedChange={(v) => setAllDays(v === true)} />
              Do all affected days
            </label>
          </fieldset>
        ) : null}

        <fieldset className="grid gap-1.5">
          <legend className="mb-1 text-sm font-medium">Give it to</legend>
          {candidates.length === 0 ? <p className="text-sm text-muted-foreground">There&apos;s nobody else to give it to. Add a lead on the Team page.</p> : null}
          {candidates.map((p) => {
            const off = chosenDays.some((d) => offOn(p.workerId, d.date));
            const label = p.isOwner ? 'You' : p.name;
            return (
              <label
                key={p.workerId}
                className={cn(
                  'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors',
                  toId === p.workerId ? 'border-(--tone-rounds-solid) bg-(--tone-rounds-soft)' : 'border-border',
                  off && 'cursor-not-allowed opacity-50',
                )}
              >
                <input type="radio" name="give-to" className="size-4 accent-(--tone-rounds-solid)" disabled={off} checked={toId === p.workerId} onChange={() => setToId(p.workerId)} />
                <span className="flex-1 font-medium">{label}</span>
                {off ? <span className="text-xs text-(--tone-amber-text)">Off</span> : null}
              </label>
            );
          })}
        </fieldset>

        {target ? (
          <ul className="rounded-xl bg-muted/60 px-3 py-2.5 text-sm tabular-nums">
            {chosenDays.map((d) => (
              <li key={d.date}>
                {formatOffRange(d.date, d.date)}: {d.visitCount} {d.visitCount === 1 ? 'stop' : 'stops'} → {targetName}
              </li>
            ))}
          </ul>
        ) : null}
        <Label className="sr-only" htmlFor="give-round-status">Status</Label>
        {error ? (
          <p id="give-round-status" role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={give} disabled={pending || !target}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            Give round
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
