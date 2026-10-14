'use client';

import { ArrowRightLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import type { LanePerson } from '@/lib/rounds/lanes';

/**
 * "Give to…": the way to hand a visit to someone without dragging (keyboard, touch, or a long day on a small screen).
 * Lists the owner and each lead who isn't already doing it. Helpers never appear: they have no lane.
 */
export function GiveToMenu({
  people,
  currentWorkerId,
  off,
  disabled,
  onGive,
}: {
  people: ReadonlyArray<LanePerson>;
  currentWorkerId: string | null;
  /** People who are off on this visit's day: still offered, the owner is asked to confirm. */
  off: ReadonlySet<string>;
  disabled?: boolean;
  onGive: (person: LanePerson) => void;
}) {
  const options = people.filter((p) => p.workerId !== currentWorkerId);
  if (options.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label="Give to…" title="Give to…">
          <ArrowRightLeft />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Give to</DropdownMenuLabel>
        {options.map((p) => (
          <DropdownMenuItem key={p.workerId} onSelect={() => onGive(p)}>
            {p.isOwner ? 'You' : p.name}
            {off.has(p.workerId) ? <span className="ml-auto text-xs text-(--tone-amber-text)">Off</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
