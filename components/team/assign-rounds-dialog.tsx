'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { floatingMessage } from '@/components/look';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { setUsualLeadAction } from '@/lib/actions/team-assign';
import type { TeamPagePerson, TeamPageRound } from '@/lib/data/team-page-core';
import { DIALOG_SHEET } from './team-ui';

/**
 * Pick the rounds a lead usually does. Ticking a round makes them its usual lead, so its upcoming visits go to them;
 * unticking hands it back to you. A round someone else has says so, and ticking it takes it from them. You can still
 * give any single day to someone else from the calendar.
 */
export function AssignRoundsDialog({
  person,
  rounds,
  leadNames,
  onClose,
}: {
  person: TeamPagePerson;
  rounds: TeamPageRound[];
  /** worker id → first name, for "with Lee". */
  leadNames: Record<string, string>;
  onClose: () => void;
}) {
  const router = useRouter();
  const workerId = person.workerId;
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(rounds.filter((r) => r.usualLeadWorkerId === workerId).map((r) => r.id)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const first = person.name.trim().split(/\s+/)[0] ?? person.name;

  if (!workerId) return null;

  const was = (r: TeamPageRound) => r.usualLeadWorkerId === workerId;
  const changes = rounds.filter((r) => chosen.has(r.id) !== was(r));

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    if (pending || changes.length === 0) return;
    setPending(true);
    setError(null);
    for (const r of changes) {
      const result = await setUsualLeadAction({ roundId: r.id, workerId: chosen.has(r.id) ? workerId : null });
      if (!result.success) {
        setPending(false);
        setError(result.error);
        router.refresh();
        return;
      }
    }
    setPending(false);
    const added = changes.filter((r) => chosen.has(r.id)).length;
    floatingMessage({
      title: added > 0 ? `${first} now does ${chosen.size} ${chosen.size === 1 ? 'round' : 'rounds'}` : `${first} no longer has those rounds`,
      tone: 'success',
    });
    onClose();
    router.refresh();
  };

  return (
    <Dialog open onOpenChange={(open) => (!open && !pending ? onClose() : undefined)}>
      <DialogContent className={DIALOG_SHEET}>
        <DialogHeader>
          <DialogTitle>{first}&apos;s rounds</DialogTitle>
          <DialogDescription>
            Tick the rounds {first} usually does. Their upcoming visits go to {first}, and new visits on those rounds follow.
          </DialogDescription>
        </DialogHeader>

        {rounds.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            You haven&apos;t made any rounds yet. Draw one on the map, then come back to give it to {first}.
          </p>
        ) : (
          <ul className="grid max-h-[50vh] gap-1.5 overflow-y-auto">
            {rounds.map((r) => {
              const other = r.usualLeadWorkerId && r.usualLeadWorkerId !== workerId ? (leadNames[r.usualLeadWorkerId] ?? 'someone else') : null;
              return (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-sm has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50">
                    <Checkbox checked={chosen.has(r.id)} onCheckedChange={() => toggle(r.id)} />
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: r.colour }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{r.name}</span>
                    {other ? (
                      <span className="shrink-0 text-xs text-muted-foreground">{chosen.has(r.id) ? `from ${other}` : `with ${other}`}</span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={pending || changes.length === 0}>
            {pending ? <Loader2 className="mr-1.5 size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
