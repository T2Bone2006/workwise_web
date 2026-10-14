'use client';

import type { CSSProperties, JSX, ReactNode } from 'react';
import { Check, ChevronDown, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatGbp } from '@/lib/money/pence';
import type { LanePerson } from '@/lib/rounds/lanes';
import type { Tone } from '@/components/look/tones';
import { PersonChipButton } from '@/components/team/assignee-chip';
import type { RoundTag } from '@/lib/rounds/round-groups';
import { cn } from '@/lib/utils';

/** A faint tint and outline in the round's own colour. Never the only clue: the round's name is always written. */
function tint(colour: string, strength: number): string {
  return `color-mix(in srgb, ${colour} ${strength}%, transparent)`;
}

export function roundBoxStyle(colour: string): CSSProperties {
  return {
    borderColor: tint(colour, 28),
    borderTopColor: colour,
    borderTopWidth: 3,
    backgroundColor: tint(colour, 7),
  };
}

/**
 * One round's houses on one day, drawn together: a solid box in the round's colour with a coloured top edge, the round's
 * name, who is doing it, how many houses and the money. `who` is the person chip (it changes who does the round),
 * `grip` the drag handle where dragging is on (the Week board), `actions` the ⋯ menu, `children` the house cards.
 */
export function RoundGroup({
  round,
  houses,
  amount,
  who,
  grip,
  actions,
  highlight = false,
  lifted = false,
  children,
}: {
  round: RoundTag;
  houses: number;
  amount: number;
  who?: ReactNode;
  grip?: ReactNode;
  actions?: ReactNode;
  /** Something is held over this group (a drop would land on its day). */
  highlight?: boolean;
  /** This group is the one in the air. */
  lifted?: boolean;
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label={`${round.name}: ${houses} ${houses === 1 ? 'house' : 'houses'}`}
      data-round-id={round.id}
      style={roundBoxStyle(round.colour)}
      className={cn('space-y-2 rounded-2xl border p-2 transition-opacity', lifted && 'opacity-40', highlight && 'ring-1 ring-primary/30')}
    >
      <div className="px-0.5">
        <div className="flex items-center gap-1">
          {grip}
          <p className="min-w-0 flex-1 truncate text-[13px] leading-5 font-semibold text-foreground">{round.name}</p>
          {actions}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {who}
          <span className="text-xs tabular-nums text-muted-foreground">
            {houses} {houses === 1 ? 'house' : 'houses'} · {formatGbp(amount)}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

/** The ⋯ menu on a round group: move all its houses to another day. */
export function RoundGroupMenu({ roundName, canMove, onMove }: { roundName: string; canMove: boolean; onMove: () => void }): JSX.Element | null {
  if (!canMove) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label={`Options for ${roundName}`}>
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onMove}>Move whole round to another day…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Who is doing this round, and the way to change it: "Just this day" gives that day's houses to someone; "Every time"
 * makes them the round's usual person, so its upcoming visits follow. People who are off that day are still offered
 * (the caller asks before giving). Helpers never appear: they have no login or column.
 */
export function RoundPersonMenu({
  name,
  colour,
  extra = 0,
  people,
  currentWorkerId,
  usualWorkerId,
  off,
  disabled,
  onThisDay,
  onEveryTime,
}: {
  /** The person doing most of it: "Dave" or "You". */
  name: string;
  colour: Tone;
  /** How many other people have the rest that day. */
  extra?: number;
  people: ReadonlyArray<LanePerson>;
  /** The person doing most of it that day. */
  currentWorkerId: string | null;
  /** The round's usual person (the owner when it has none). */
  usualWorkerId: string | null;
  off?: ReadonlySet<string>;
  disabled?: boolean;
  onThisDay: (person: LanePerson) => void;
  onEveryTime: (person: LanePerson) => void;
}): JSX.Element {
  const nameOf = (p: LanePerson) => (p.isOwner ? 'You' : p.name);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PersonChipButton
          name={name}
          colour={colour}
          count={extra > 0 ? `+${extra}` : undefined}
          disabled={disabled}
          aria-label={`Who does it: ${name}${extra > 0 ? ` and ${extra} more` : ''}. Change`}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel>Just this day</DropdownMenuLabel>
        {people.map((p) => (
          <DropdownMenuItem key={`day-${p.workerId}`} onSelect={() => onThisDay(p)}>
            <span className="min-w-0 flex-1 truncate">{nameOf(p)}</span>
            {off?.has(p.workerId) ? <span className="text-xs text-(--tone-amber-text)">Off</span> : null}
            <Check className={cn('size-4', p.workerId === currentWorkerId ? 'opacity-100' : 'opacity-0')} aria-hidden />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Every time (usual person)</DropdownMenuLabel>
        {people.map((p) => (
          <DropdownMenuItem key={`usual-${p.workerId}`} onSelect={() => onEveryTime(p)}>
            <span className="min-w-0 flex-1 truncate">{nameOf(p)}</span>
            <Check className={cn('size-4', p.workerId === usualWorkerId ? 'opacity-100' : 'opacity-0')} aria-hidden />
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
